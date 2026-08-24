import { Router } from "express";
import bcrypt from "bcryptjs";
import { query } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { ApiError } from "../middleware/errorHandler.js";

const router = Router();
const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN"];

router.use(requireAuth);

router.get("/", requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, email, phone, agent_id, role, status, last_login_at, created_at
       FROM users ORDER BY created_at DESC`
    );
    res.json({ success: true, data: rows, message: "Success" });
  } catch (err) { next(err); }
});

router.post("/", requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { name, email, phone, agentId, role, password } = req.body;
    if (!name || !email || !password) throw new ApiError(400, "Name, email, and password are required");

    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO users (name, email, phone, agent_id, role, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, phone, agent_id, role, status, created_at`,
      [name, email.toLowerCase().trim(), phone || null, agentId || null, role || "AGENT", passwordHash]
    );
    res.status(201).json({ success: true, data: rows[0], message: "User created" });
  } catch (err) {
    if (err.code === "23505") return next(new ApiError(409, "A user with this email already exists"));
    next(err);
  }
});

router.put("/:id", requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { name, phone, agentId, role, status } = req.body;
    const { rows } = await query(
      `UPDATE users SET
        name = COALESCE($2, name),
        phone = COALESCE($3, phone),
        agent_id = COALESCE($4, agent_id),
        role = COALESCE($5, role),
        status = COALESCE($6, status),
        updated_at = now()
       WHERE id = $1
       RETURNING id, name, email, phone, agent_id, role, status`,
      [req.params.id, name, phone, agentId, role, status]
    );
    if (!rows[0]) throw new ApiError(404, "User not found");
    res.json({ success: true, data: rows[0], message: "User updated" });
  } catch (err) { next(err); }
});

router.post("/:id/disable", requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE users SET status = 'DISABLED', updated_at = now() WHERE id = $1 RETURNING id, status`,
      [req.params.id]
    );
    if (!rows[0]) throw new ApiError(404, "User not found");
    res.json({ success: true, data: rows[0], message: "User disabled" });
  } catch (err) { next(err); }
});

router.post("/:id/reset-password", requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) throw new ApiError(400, "Password must be at least 8 characters");
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const { rows } = await query(
      `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1 RETURNING id`,
      [req.params.id, passwordHash]
    );
    if (!rows[0]) throw new ApiError(404, "User not found");
    res.json({ success: true, data: null, message: "Password reset" });
  } catch (err) { next(err); }
});

export default router;
