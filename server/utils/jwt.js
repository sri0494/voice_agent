import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

export function signToken(payload) {
  if (!SECRET) throw new Error("JWT_SECRET is not configured");
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

export function verifyToken(token) {
  if (!SECRET) throw new Error("JWT_SECRET is not configured");
  return jwt.verify(token, SECRET);
}
