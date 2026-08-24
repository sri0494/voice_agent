import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { ApiError } from "../middleware/errorHandler.js";
import { processDocument, reindexDocument } from "../services/knowledge/ingest.js";
import { searchRelevantChunks } from "../services/knowledge/vectorSearch.js";

const router = Router();
router.use(requireAuth);

const UPLOAD_DIR = path.resolve("uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_TYPES = { "application/pdf": "PDF", "text/plain": "TXT",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "text/csv": "CSV", "text/markdown": "MD" };
const ALLOWED_EXT = { ".pdf": "PDF", ".txt": "TXT", ".docx": "DOCX", ".csv": "CSV", ".md": "MD" };

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname)}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_TYPES[file.mimetype] && !ALLOWED_EXT[ext]) {
      return cb(new ApiError(400, "Unsupported file type. Allowed: PDF, TXT, DOCX, CSV, Markdown"));
    }
    cb(null, true);
  },
});

router.post("/upload", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) throw new ApiError(400, "File is required");
    const { knowledgeBaseId } = req.body;
    if (!knowledgeBaseId) throw new ApiError(400, "knowledgeBaseId is required");

    const ext = path.extname(req.file.originalname).toLowerCase();
    const fileType = ALLOWED_TYPES[req.file.mimetype] || ALLOWED_EXT[ext];

    const { rows } = await query(
      `INSERT INTO knowledge_documents (knowledge_base_id, title, source_type, file_type, file_path, status)
       VALUES ($1,$2,'FILE',$3,$4,'PENDING') RETURNING *`,
      [knowledgeBaseId, req.file.originalname, fileType, req.file.path]
    );

    // Process asynchronously so the upload responds immediately.
    processDocument(rows[0].id).catch(() => {});

    res.status(201).json({ success: true, data: rows[0], message: "Document uploaded, processing started" });
  } catch (err) { next(err); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM knowledge_documents WHERE id = $1`, [req.params.id]);
    if (!rows[0]) throw new ApiError(404, "Document not found");
    res.json({ success: true, data: rows[0], message: "Success" });
  } catch (err) { next(err); }
});

router.post("/:id/reindex", async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT id FROM knowledge_documents WHERE id = $1`, [req.params.id]);
    if (!rows[0]) throw new ApiError(404, "Document not found");
    reindexDocument(req.params.id).catch(() => {});
    res.json({ success: true, data: null, message: "Re-indexing started" });
  } catch (err) { next(err); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT file_path FROM knowledge_documents WHERE id = $1`, [req.params.id]);
    if (!rows[0]) throw new ApiError(404, "Document not found");
    await query(`DELETE FROM knowledge_documents WHERE id = $1`, [req.params.id]);
    if (rows[0].file_path && fs.existsSync(rows[0].file_path)) fs.unlinkSync(rows[0].file_path);
    res.json({ success: true, data: null, message: "Document deleted" });
  } catch (err) { next(err); }
});

// Search documents/chunks within a knowledge base (used by KB search UI).
router.get("/", async (req, res, next) => {
  try {
    const { knowledgeBaseId, q } = req.query;
    if (!knowledgeBaseId) throw new ApiError(400, "knowledgeBaseId is required");

    if (q) {
      const chunks = await searchRelevantChunks(q, [knowledgeBaseId], 10);
      return res.json({ success: true, data: chunks, message: "Success" });
    }
    const { rows } = await query(
      `SELECT * FROM knowledge_documents WHERE knowledge_base_id = $1 ORDER BY created_at DESC`,
      [knowledgeBaseId]
    );
    res.json({ success: true, data: rows, message: "Success" });
  } catch (err) { next(err); }
});

export default router;
