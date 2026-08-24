import { verifyToken } from "../utils/jwt.js";
import { ApiError } from "./errorHandler.js";

// Verifies the Bearer JWT and attaches { id, email, role } to req.user
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return next(new ApiError(401, "Authentication required"));
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded; // { id, email, role }
    next();
  } catch {
    next(new ApiError(401, "Invalid or expired session"));
  }
}

// Usage: requireRole("SUPER_ADMIN", "ADMIN")
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return next(new ApiError(401, "Authentication required"));
    if (!allowedRoles.includes(req.user.role)) {
      return next(new ApiError(403, "You do not have permission to perform this action"));
    }
    next();
  };
}
