import { Router } from "express";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { ApiError } from "../middleware/errorHandler.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*, a.name AS agent_name,
        (SELECT COUNT(*) FROM contacts WHERE campaign_id = c.id) AS contact_count,
        (SELECT COUNT(*) FROM calls WHERE campaign_id = c.id) AS call_count
       FROM campaigns c
       LEFT JOIN agents a ON a.id = c.agent_id
       ORDER BY c.created_at DESC`
    );
    res.json({ success: true, data: rows, message: "Success" });
  } catch (err) { next(err); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*, a.name AS agent_name FROM campaigns c LEFT JOIN agents a ON a.id = c.agent_id WHERE c.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) throw new ApiError(404, "Campaign not found");

    const { rows: stats } = await query(
      `SELECT status, COUNT(*) AS count FROM calls WHERE campaign_id = $1 GROUP BY status`,
      [req.params.id]
    );
    res.json({ success: true, data: { ...rows[0], callStats: stats }, message: "Success" });
  } catch (err) { next(err); }
});

router.post("/", async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.name || !b.type) throw new ApiError(400, "Campaign name and type are required");
    const { rows } = await query(
      `INSERT INTO campaigns (name, type, description, language, agent_id, knowledge_base_id, status,
                               start_date, end_date, retry_attempts, calling_hours, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [b.name, b.type, b.description || null, b.language || "English", b.agentId || null, b.knowledgeBaseId || null,
       b.status || "Draft", b.startDate || null, b.endDate || null, b.retryAttempts ?? 2,
       JSON.stringify(b.callingHours || { start: "09:00", end: "19:00", days: ["MON","TUE","WED","THU","FRI"] }),
       req.user.id]
    );
    res.status(201).json({ success: true, data: rows[0], message: "Campaign created" });
  } catch (err) { next(err); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await query(
      `UPDATE campaigns SET
        name = COALESCE($2, name), type = COALESCE($3, type), description = COALESCE($4, description),
        language = COALESCE($5, language), agent_id = COALESCE($6, agent_id),
        knowledge_base_id = COALESCE($7, knowledge_base_id), start_date = COALESCE($8, start_date),
        end_date = COALESCE($9, end_date), retry_attempts = COALESCE($10, retry_attempts),
        calling_hours = COALESCE($11, calling_hours), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id, b.name, b.type, b.description, b.language, b.agentId, b.knowledgeBaseId,
       b.startDate, b.endDate, b.retryAttempts, b.callingHours ? JSON.stringify(b.callingHours) : null]
    );
    if (!rows[0]) throw new ApiError(404, "Campaign not found");
    res.json({ success: true, data: rows[0], message: "Campaign updated" });
  } catch (err) { next(err); }
});

async function setStatus(req, res, next, status) {
  try {
    if (status === "Running") {
      const { rows: campaignRows } = await query(`SELECT * FROM campaigns WHERE id = $1`, [req.params.id]);
      const campaign = campaignRows[0];
      if (!campaign) throw new ApiError(404, "Campaign not found");
      if (!campaign.agent_id) {
        throw new ApiError(400, "This campaign has no AI Agent assigned. Edit the campaign and select an agent before starting it.");
      }
      const { rows: contactCountRows } = await query(
        `SELECT COUNT(*) FROM contacts WHERE campaign_id = $1 AND status = 'PENDING'`,
        [req.params.id]
      );
      if (Number(contactCountRows[0].count) === 0) {
        throw new ApiError(400, "This campaign has no pending contacts to call. Upload a contact list first.");
      }
    }

    const { rows } = await query(
      `UPDATE campaigns SET status = $2, updated_at = now() WHERE id = $1 RETURNING id, status`,
      [req.params.id, status]
    );
    if (!rows[0]) throw new ApiError(404, "Campaign not found");
    res.json({ success: true, data: rows[0], message: `Campaign ${status.toLowerCase()}` });
  } catch (err) { next(err); }
}

router.post("/:id/start", (req, res, next) => setStatus(req, res, next, "Running"));
router.post("/:id/pause", (req, res, next) => setStatus(req, res, next, "Paused"));
router.post("/:id/resume", (req, res, next) => setStatus(req, res, next, "Running"));
router.post("/:id/stop", (req, res, next) => setStatus(req, res, next, "Cancelled"));

router.delete("/:id", async (req, res, next) => {
  try {
    const { rowCount } = await query(`DELETE FROM campaigns WHERE id = $1`, [req.params.id]);
    if (!rowCount) throw new ApiError(404, "Campaign not found");
    res.json({ success: true, data: null, message: "Campaign deleted" });
  } catch (err) { next(err); }
});

export default router;
