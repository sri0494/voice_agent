import { Router } from "express";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { ApiError } from "../middleware/errorHandler.js";
import { createTelephonyProvider } from "../services/telephony/TelephonyProvider.js";

const router = Router();
router.use(requireAuth);
const telephonyProvider = createTelephonyProvider();

router.get("/", async (req, res, next) => {
  try {
    const { status, campaignId, agentId, limit = 100 } = req.query;
    const conditions = [];
    const params = [];
    if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
    if (campaignId) { params.push(campaignId); conditions.push(`campaign_id = $${params.length}`); }
    if (agentId) { params.push(agentId); conditions.push(`agent_id = $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(Number(limit));

    const { rows } = await query(
      `SELECT c.*, camp.name AS campaign_name, a.name AS agent_name
       FROM calls c
       LEFT JOIN campaigns camp ON camp.id = c.campaign_id
       LEFT JOIN agents a ON a.id = c.agent_id
       ${where}
       ORDER BY c.created_at DESC LIMIT $${params.length}`,
      params
    );
    res.json({ success: true, data: rows, message: "Success" });
  } catch (err) { next(err); }
});

// Live calls: currently-active call states only.
router.get("/live", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*, camp.name AS campaign_name, a.name AS agent_name
       FROM calls c
       LEFT JOIN campaigns camp ON camp.id = c.campaign_id
       LEFT JOIN agents a ON a.id = c.agent_id
       WHERE c.status IN ('Ringing','Connected','Live','Transferred')
       ORDER BY c.created_at DESC`
    );
    res.json({ success: true, data: rows, message: "Success" });
  } catch (err) { next(err); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*, camp.name AS campaign_name, a.name AS agent_name
       FROM calls c
       LEFT JOIN campaigns camp ON camp.id = c.campaign_id
       LEFT JOIN agents a ON a.id = c.agent_id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) throw new ApiError(404, "Call not found");

    const { rows: messages } = await query(
      `SELECT * FROM call_messages WHERE call_id = $1 ORDER BY sequence ASC`,
      [req.params.id]
    );
    const { rows: recordings } = await query(`SELECT * FROM call_recordings WHERE call_id = $1`, [req.params.id]);

    res.json({ success: true, data: { ...rows[0], messages, recordings }, message: "Success" });
  } catch (err) { next(err); }
});

router.post("/:id/transfer", async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM calls WHERE id = $1`, [req.params.id]);
    const call = rows[0];
    if (!call) throw new ApiError(404, "Call not found");
    if (!call.provider_call_id) throw new ApiError(400, "Call has no active provider session");

    const result = await telephonyProvider.transfer(call.provider_call_id, req.body.toNumber);
    await query(`UPDATE calls SET status = 'Transferred', updated_at = now() WHERE id = $1`, [req.params.id]);
    res.json({ success: true, data: result, message: "Call transfer initiated" });
  } catch (err) { next(err); }
});

router.post("/:id/end", async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM calls WHERE id = $1`, [req.params.id]);
    const call = rows[0];
    if (!call) throw new ApiError(404, "Call not found");

    if (call.provider_call_id) await telephonyProvider.hangup(call.provider_call_id);
    await query(
      `UPDATE calls SET status = 'Completed', ended_at = now(), updated_at = now() WHERE id = $1`,
      [req.params.id]
    );
    res.json({ success: true, data: null, message: "Call ended" });
  } catch (err) { next(err); }
});

export default router;
