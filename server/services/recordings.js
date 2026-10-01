import { Router } from "express";
import multer from "multer";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { ApiError } from "../middleware/errorHandler.js";
import { getStorage } from "../services/storage/index.js";
import { saveRecording, publicRow, signFile, verifyFile, MAX_BYTES } from "../services/recordings.js";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DELETE_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"];

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });
const receive = (req, res, next) =>
  upload.single("audio")(req, res, (err) => {
    if (!err) return next();
    next(err.code === "LIMIT_FILE_SIZE" ? new ApiError(413, "Recording too large") : new ApiError(400, err.message));
  });

async function findRecording(id) {
  if (!UUID_RE.test(id)) throw new ApiError(404, "Recording not found");
  const { rows } = await query(`SELECT * FROM call_recording_files WHERE id = $1`, [id]);
  if (!rows[0]) throw new ApiError(404, "Recording not found");
  return rows[0];
}

// ---- Signed playback (registered BEFORE requireAuth: <audio src> can't send auth headers) ----
router.get("/:id/file", async (req, res, next) => {
  try {
    if (!verifyFile(req.params.id, req.query.exp, req.query.sig)) throw new ApiError(403, "Link expired or invalid");
    const rec = await findRecording(req.params.id);
    const storage = await getStorage();
    if (rec.storage_provider !== storage.name) throw new ApiError(409, `Recording is stored in "${rec.storage_provider}" but the server is using "${storage.name}"`);

    if (storage.supportsPresign) {
      return res.redirect(302, await storage.getSignedUrl(rec.storage_key, { expiresIn: 300, contentType: rec.content_type }));
    }

    // Local disk: stream with Range support so the player can seek.
    const size = await storage.stat(rec.storage_key);
    let start = 0, end = size - 1, status = 200;
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (m && (m[1] || m[2])) {
      if (m[1] === "") { start = Math.max(0, size - Number(m[2])); }
      else { start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), size - 1); }
      if (start > end || start >= size) return res.status(416).set("Content-Range", `bytes */${size}`).end();
      status = 206;
      res.set("Content-Range", `bytes ${start}-${end}/${size}`);
    }
    res.status(status).set({
      "Content-Type": rec.content_type,
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=0",
      "X-Content-Type-Options": "nosniff",
    });
    storage.createReadStream(rec.storage_key, { start, end }).on("error", next).pipe(res);
  } catch (err) { next(err); }
});

router.use(requireAuth);

// Upload a recording (browser recorder or manual file). multipart field: "audio"
router.post("/", receive, async (req, res, next) => {
  try {
    if (!req.file) throw new ApiError(400, 'Audio file is required (form field "audio")');
    const callId = req.body.callId || null;
    if (callId) {
      if (!UUID_RE.test(callId)) throw new ApiError(400, "Invalid call ID");
      const { rows } = await query(`SELECT 1 FROM calls WHERE id = $1`, [callId]);
      if (!rows[0]) throw new ApiError(404, "Call not found");
    }
    const d = Math.round(Number(req.body.durationSec));
    const saved = await saveRecording({
      callId,
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
      durationSec: d > 0 && d < 86400 ? d : null,
      source: req.body.source === "browser" ? "browser" : "upload",
      userId: req.user?.id,
    });
    res.status(201).json({ success: true, data: saved, message: "Recording saved" });
  } catch (err) { next(err); }
});

// List recordings (optionally for one call)
router.get("/", async (req, res, next) => {
  try {
    const { callId } = req.query;
    if (callId && !UUID_RE.test(callId)) throw new ApiError(400, "Invalid call ID");
    const { rows } = await query(
      `SELECT * FROM call_recording_files WHERE ($1::uuid IS NULL OR call_id = $1::uuid)
       ORDER BY created_at DESC LIMIT 200`,
      [callId || null]
    );
    res.json({ success: true, data: rows.map(publicRow), message: "Success" });
  } catch (err) { next(err); }
});

// Short-lived playback URL
router.get("/:id/url", async (req, res, next) => {
  try {
    const rec = await findRecording(req.params.id);
    const { exp, sig } = signFile(rec.id, 300);
    res.json({ success: true, data: { url: `/api/recordings/${rec.id}/file?exp=${exp}&sig=${sig}`, expiresIn: 300 }, message: "Success" });
  } catch (err) { next(err); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    if (!DELETE_ROLES.includes(req.user?.role)) throw new ApiError(403, "Only admins and managers can delete recordings");
    const rec = await findRecording(req.params.id);
    await query(`DELETE FROM call_recording_files WHERE id = $1`, [rec.id]);
    const storage = await getStorage();
    await storage.remove(rec.storage_key).catch((e) => console.error("[recordings] object delete failed", rec.storage_key, e.message));
    res.json({ success: true, data: null, message: "Recording deleted" });
  } catch (err) { next(err); }
});

export default router;
