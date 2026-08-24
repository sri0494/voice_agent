import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  // Fail loudly at boot rather than silently later — DATABASE_URL is required.
  console.error("[db] DATABASE_URL is not set. Copy .env.example to .env and configure it.");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on("error", (err) => {
  console.error("[db] Unexpected error on idle client", err);
});

export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV !== "production") {
    console.log("[db]", { text: text.split("\n")[0].slice(0, 80), duration, rows: res.rowCount });
  }
  return res;
}

export async function getClient() {
  return pool.connect();
}

export async function healthCheck() {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
