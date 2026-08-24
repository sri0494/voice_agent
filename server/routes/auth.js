import { Router } from "express";
import bcrypt from "bcryptjs";
import { query } from "../db/pool.js";
import { signToken } from "../utils/jwt.js";
import { requireAuth } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { ApiError } from "../middleware/errorHandler.js";
import { logger } from "../utils/logger.js";

const router = Router();

router.post("/login", authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) throw new ApiError(400, "Email and password are required");

    const { rows } = await query(`SELECT * FROM users WHERE email = $1`, [email.toLowerCase().trim()]);
    const user = rows[0];

    if (!user || user.status === "DISABLED") {
      throw new ApiError(401, "Invalid email or password");
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) throw new ApiError(401, "Invalid email or password");

    await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);

    const token = signToken({ id: user.id, email: user.email, role: user.role, name: user.name });

    logger.info("user_login", { userId: user.id });

    res.json({
      success: true,
      data: {
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      },
      message: "Login successful",
    });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", requireAuth, async (req, res) => {
  // JWTs are stateless; logout is handled client-side by discarding the token.
  // If a token-blocklist is needed later, insert into a `revoked_tokens` table here.
  res.json({ success: true, data: null, message: "Logged out" });
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, email, phone, agent_id, role, status, last_login_at, created_at FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows[0]) throw new ApiError(404, "User not found");
    res.json({ success: true, data: rows[0], message: "Success" });
  } catch (err) {
    next(err);
  }
});

router.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      throw new ApiError(400, "New password must be at least 8 characters");
    }

    const { rows } = await query(`SELECT * FROM users WHERE id = $1`, [req.user.id]);
    const user = rows[0];
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) throw new ApiError(401, "Current password is incorrect");

    const newHash = await bcrypt.hash(newPassword, 10);
    await query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [req.user.id, newHash]);

    res.json({ success: true, data: null, message: "Password updated" });
  } catch (err) {
    next(err);
  }
});

export default router;
