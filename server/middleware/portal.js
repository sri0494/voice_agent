import jwt from "jsonwebtoken";
import { query } from "../db/pool.js";
import { ApiError } from "./errorHandler.js";

/**
 * Use AFTER requireAuth on every /api/customer route.
 * Loads the logged-in user from the DATABASE (never from the request) and sets req.portal.
 * The client the user belongs to comes only from users.client_id.
 */
export async function loadPortalUser(req, res, next) {
  try {
    if (!req.user?.id) throw new ApiError(401, "Not authenticated");
    const { rows } = await query(
      `SELECT u.id, u.name, u.email, u.role, u.status, u.client_id,
              c.status AS client_status, c.name AS client_name, c.company_name
       FROM users u LEFT JOIN clients c ON c.id = u.client_id
       WHERE u.id = $1`,
      [req.user.id]
    );
    const u = rows[0];
    if (!u) throw new ApiError(401, "Session is no longer valid");
    if (String(u.role).toUpperCase() !== "CUSTOMER") throw new ApiError(403, "This area is for customer accounts only");
    if (!u.client_id) throw new ApiError(403, "This login is not linked to a customer account");
    if (String(u.status).toLowerCase() !== "active") throw new ApiError(403, "This login is inactive");
    if (String(u.client_status).toLowerCase() !== "active") throw new ApiError(403, "This customer account is inactive");
    const { rows: perms } = await query(`SELECT permission FROM client_permissions WHERE client_id = $1`, [u.client_id]);
    req.portal = {
      userId: u.id, name: u.name, email: u.email,
      clientId: u.client_id, clientName: u.client_name, companyName: u.company_name,
      permissions: new Set(perms.map((p) => p.permission)),
    };
    next();
  } catch (err) { next(err); }
}

/** Server-side permission gate. All listed permissions are required. */
export const requirePermission = (...needed) => (req, res, next) => {
  const missing = needed.filter((p) => !req.portal.permissions.has(p));
  if (missing.length) return next(new ApiError(403, "You do not have permission to use this feature"));
  next();
};

/**
 * Safety net for ALL existing admin APIs (they only check "is logged in"):
 * a CUSTOMER token may only reach /api/customer/*, GET /api/auth/me and the signed recording links.
 * Mount ONCE, before every other /api router:   app.use("/api", blockCustomerOutsidePortal);
 */
let warned = false;
export async function blockCustomerOutsidePortal(req, res, next) {
  try {
    const p = req.path;
    if (req.method === "OPTIONS" || p === "/customer" || p.startsWith("/customer/")) return next();
    if (req.method === "GET" && p === "/auth/me") return next();
    if (req.method === "GET" && /^\/recordings\/[^/]+\/file$/.test(p)) return next(); // signed link, no auth header

    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return next(); // requireAuth on the target route will reject it

    let payload;
    try { payload = jwt.verify(token, process.env.JWT_SECRET); } catch { return next(); } // invalid -> requireAuth rejects

    let role = null;
    const id = payload.id ?? payload.userId ?? payload.user_id ?? payload.uid ?? payload.sub ?? payload.user?.id;
    if (id != null) {
      const { rows } = await query(`SELECT role FROM users WHERE id::text = $1`, [String(id)]);
      role = rows[0]?.role ?? null;
    } else if (payload.email) {
      const { rows } = await query(`SELECT role FROM users WHERE lower(email) = lower($1)`, [String(payload.email)]);
      role = rows[0]?.role ?? null;
    } else {
      role = payload.role ?? null;
      if (!warned) { warned = true; console.error("[portal] JWT has no recognisable user id claim; customer blocking relies on role claim only. Review middleware/portal.js"); }
    }
    if (role && String(role).toUpperCase() === "CUSTOMER") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    next();
  } catch (err) { next(err); }
}
