import { Router } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { ApiError } from "../middleware/errorHandler.js";

const router = Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "text/csv" && !file.originalname.endsWith(".csv")) {
      return cb(new ApiError(400, "Only CSV files are allowed"));
    }
    cb(null, true);
  },
});

const PHONE_RE = /^[6-9]\d{9}$|^\+91[6-9]\d{9}$/; // basic Indian mobile validation

router.get("/", async (req, res, next) => {
  try {
    const { campaignId } = req.query;
    const { rows } = campaignId
      ? await query(`SELECT * FROM contacts WHERE campaign_id = $1 ORDER BY created_at DESC`, [campaignId])
      : await query(`SELECT * FROM contacts ORDER BY created_at DESC LIMIT 500`);
    res.json({ success: true, data: rows, message: "Success" });
  } catch (err) { next(err); }
});

router.post("/", async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.phone) throw new ApiError(400, "Phone is required");
    if (!PHONE_RE.test(b.phone)) throw new ApiError(400, "Invalid Indian phone number format");
    const { rows } = await query(
      `INSERT INTO contacts (campaign_id, name, phone, email, language) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [b.campaignId || null, b.name || null, b.phone, b.email || null, b.language || "English"]
    );
    res.status(201).json({ success: true, data: rows[0], message: "Contact created" });
  } catch (err) { next(err); }
});

router.post("/upload-csv", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) throw new ApiError(400, "CSV file is required");
    const { campaignId } = req.body;
    const records = parse(req.file.buffer.toString("utf-8"), { columns: true, skip_empty_lines: true, trim: true });

    let inserted = 0;
    const skipped = [];
    for (const r of records) {
      const phone = (r.phone || r.Phone || "").replace(/\s+/g, "");
      if (!PHONE_RE.test(phone)) {
        skipped.push({ row: r, reason: "invalid phone" });
        continue;
      }
      await query(
        `INSERT INTO contacts (campaign_id, name, phone, email, language) VALUES ($1,$2,$3,$4,$5)`,
        [campaignId || null, r.name || r.Name || null, phone, r.email || r.Email || null, r.language || r.Language || "English"]
      );
      inserted++;
    }
    res.status(201).json({
      success: true,
      data: { inserted, skippedCount: skipped.length, skipped: skipped.slice(0, 20) },
      message: `${inserted} contacts imported`,
    });
  } catch (err) { next(err); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const { rowCount } = await query(`DELETE FROM contacts WHERE id = $1`, [req.params.id]);
    if (!rowCount) throw new ApiError(404, "Contact not found");
    res.json({ success: true, data: null, message: "Contact deleted" });
  } catch (err) { next(err); }
});

export default router;
