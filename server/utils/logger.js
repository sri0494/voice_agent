// Minimal structured logger. Never logs secrets, passwords, JWTs, or full phone numbers.
const SENSITIVE_KEYS = ["password", "password_hash", "token", "authorization", "jwt", "secret", "api_key", "apikey"];

function redact(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const clone = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s))) {
      clone[k] = "[REDACTED]";
    } else if (k.toLowerCase() === "phone" && typeof v === "string") {
      clone[k] = v.length > 4 ? `${"*".repeat(v.length - 4)}${v.slice(-4)}` : v;
    } else if (typeof v === "object") {
      clone[k] = redact(v);
    } else {
      clone[k] = v;
    }
  }
  return clone;
}

export const logger = {
  info: (msg, meta = {}) => console.log(JSON.stringify({ level: "info", msg, ...redact(meta), ts: new Date().toISOString() })),
  warn: (msg, meta = {}) => console.warn(JSON.stringify({ level: "warn", msg, ...redact(meta), ts: new Date().toISOString() })),
  error: (msg, meta = {}) => console.error(JSON.stringify({ level: "error", msg, ...redact(meta), ts: new Date().toISOString() })),
};
