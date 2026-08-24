import { Router } from "express";
import { query } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// Reports which providers are configured via env vars (never returns secret values).
router.get("/", async (req, res, next) => {
  try {
    const status = (envKey) => (process.env[envKey] && process.env[envKey] !== "mock" ? "CONNECTED" : "DISCONNECTED");
    const builtIn = [
      { name: "AI Provider", type: "AI", envVar: "AI_PROVIDER", status: status("AI_PROVIDER"), value: process.env.AI_PROVIDER || "mock" },
      { name: "Speech to Text", type: "STT", envVar: "STT_PROVIDER", status: status("STT_PROVIDER"), value: process.env.STT_PROVIDER || "mock" },
      { name: "Text to Speech", type: "TTS", envVar: "TTS_PROVIDER", status: status("TTS_PROVIDER"), value: process.env.TTS_PROVIDER || "mock" },
      { name: "Telephony", type: "TELEPHONY", envVar: "TELEPHONY_PROVIDER", status: status("TELEPHONY_PROVIDER"), value: process.env.TELEPHONY_PROVIDER || "mock" },
      { name: "Embeddings", type: "EMBEDDING", envVar: "EMBEDDING_PROVIDER", status: status("EMBEDDING_PROVIDER"), value: process.env.EMBEDDING_PROVIDER || "mock" },
    ];
    const { rows: custom } = await query(`SELECT * FROM integrations ORDER BY created_at DESC`);
    res.json({ success: true, data: { builtIn, custom }, message: "Success" });
  } catch (err) { next(err); }
});

router.post("/", requireRole("SUPER_ADMIN", "ADMIN"), async (req, res, next) => {
  try {
    const { name, type, config } = req.body;
    const { rows } = await query(
      `INSERT INTO integrations (name, type, config) VALUES ($1,$2,$3) RETURNING *`,
      [name, type, JSON.stringify(config || {})]
    );
    res.status(201).json({ success: true, data: rows[0], message: "Integration saved" });
  } catch (err) { next(err); }
});

export default router;
