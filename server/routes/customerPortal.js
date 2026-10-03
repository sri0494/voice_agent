// Customer Portal API. Mounted at /api/customer.
// SECURITY MODEL: the client comes ONLY from users.client_id (req.portal.clientId).
// Nothing the browser sends (query, body, headers) can change which client's data is read or written.
import { Router } from "express";
import bcrypt from "bcryptjs";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { ApiError } from "../middleware/errorHandler.js";
import { loadPortalUser, requirePermission } from "../middleware/portal.js";
import { signFile } from "../services/recordings.js";
import * as data from "../services/clientData.js";

const router = Router();
router.use(requireAuth, loadPortalUser);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE_RE = /^[6-9]\d{9}$|^\+91[6-9]\d{9}$/;

const uuid = (v, label) => { if (!UUID_RE.test(String(v))) throw new ApiError(400, `Invalid ${label}`); return String(v); };
const optUuid = (v, label) => (v ? uuid(v, label) : null);
const optDate = (v, label) => { if (!v) return null; const t = Date.parse(v); if (Number.isNaN(t)) throw new ApiError(400, `Invalid ${label}`); return new Date(t).toISOString(); };
const page = (req) => ({
  limit: Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200),
  offset: Math.max(parseInt(req.query.offset, 10) || 0, 0),
});

function dbError(err) {
  if (err instanceof ApiError) return err;
  if (err.code === "23503") return new ApiError(409, "This item is still linked to other records (e.g. calls) and cannot be deleted");
  if (err.code === "22P02") return new ApiError(400, "Invalid value or ID format");
  console.error("[portal] DB error", err.code, err.message);
  return err;
}
const wrap = (fn) => (req, res, next) => fn(req, res).catch((e) => next(dbError(e)));
const ok = (res, d, message = "Success", status = 200) => res.status(status).json({ success: true, data: d, message });

// ---- ownership guards: 404 if it doesn't exist, 403 if it belongs to someone else ----
const mine = (req, row) => { if (row.client_id !== req.portal.clientId) throw new ApiError(403, "Forbidden"); return row; };
async function ownedCampaign(req, id) {
  uuid(id, "campaign ID");
  const { rows } = await query(`SELECT * FROM campaigns WHERE id = $1`, [id]);
  if (!rows[0]) throw new ApiError(404, "Campaign not found");
  return mine(req, rows[0]);
}
async function ownedContact(req, id) {
  uuid(id, "contact ID");
  const { rows } = await query(`SELECT ct.*, ca.client_id FROM contacts ct LEFT JOIN campaigns ca ON ca.id = ct.campaign_id WHERE ct.id = $1`, [id]);
  if (!rows[0]) throw new ApiError(404, "Contact not found");
  return mine(req, rows[0]);
}
async function ownedCall(req, id) {
  uuid(id, "call ID");
  const { rows } = await query(
    `SELECT c.*, ca.client_id, ca.name AS campaign_name FROM calls c LEFT JOIN campaigns ca ON ca.id = c.campaign_id WHERE c.id = $1`, [id]);
  if (!rows[0]) throw new ApiError(404, "Call not found");
  return mine(req, rows[0]);
}
async function ownedRecording(req, id) {
  uuid(id, "recording ID");
  const { rows } = await query(
    `SELECT r.id, ca.client_id FROM call_recording_files r
     LEFT JOIN calls c ON c.id = r.call_id LEFT JOIN campaigns ca ON ca.id = c.campaign_id WHERE r.id = $1`, [id]);
  if (!rows[0]) throw new ApiError(404, "Recording not found");
  return mine(req, rows[0]);
}

function buildUpdate(body, map, firstIndex) {
  const sets = [], params = [];
  for (const [key, col] of Object.entries(map)) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    let v = typeof body[key] === "string" ? body[key].trim() : body[key];
    if (v === "") v = null;
    params.push(v);
    sets.push(`${col} = $${firstIndex + params.length - 1}`);
  }
  return { sets, params };
}

// ---------------- profile ----------------
router.get("/me", wrap(async (req, res) => {
  const p = req.portal;
  ok(res, {
    user: { id: p.userId, name: p.name, email: p.email },
    client: { id: p.clientId, name: p.clientName, companyName: p.companyName },
    permissions: [...p.permissions],
  });
}));

router.put("/me/password", wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || String(newPassword).length < 8) throw new ApiError(400, "New password must be at least 8 characters");
  const { rows } = await query(`SELECT password_hash FROM users WHERE id = $1`, [req.portal.userId]);
  if (!rows[0] || !(await bcrypt.compare(String(currentPassword), rows[0].password_hash))) throw new ApiError(400, "Current password is incorrect");
  await query(`UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`, [await bcrypt.hash(String(newPassword), 10), req.portal.userId]);
  ok(res, null, "Password updated");
}));

// ---------------- dashboard (only modules the customer may see) ----------------
router.get("/dashboard", wrap(async (req, res) => {
  ok(res, { clientName: req.portal.companyName || req.portal.clientName, ...(await data.dashboard(req.portal.clientId, req.portal.permissions)) });
}));

// ---------------- campaigns ----------------
const CAMPAIGN_FIELDS = { name: "name", type: "type", description: "description", language: "language", startDate: "start_date", endDate: "end_date" };

router.get("/campaigns", requirePermission("campaigns_view"), wrap(async (req, res) => {
  const { limit, offset } = page(req);
  const { rows } = await query(
    `SELECT ca.id, ca.name, ca.type, ca.description, ca.language, ca.status, ca.start_date, ca.end_date, ca.created_at,
            (SELECT count(*)::int FROM contacts ct WHERE ct.campaign_id = ca.id) AS contacts,
            (SELECT count(*)::int FROM calls c WHERE c.campaign_id = ca.id) AS calls
     FROM campaigns ca WHERE ca.client_id = $1 ORDER BY ca.created_at DESC LIMIT $2 OFFSET $3`,
    [req.portal.clientId, limit, offset]);
  ok(res, rows);
}));

router.get("/campaigns/:id", requirePermission("campaigns_view"), wrap(async (req, res) => {
  const c = await ownedCampaign(req, req.params.id);
  const { client_id, created_by, agent_id, knowledge_base_id, ...safe } = c;
  ok(res, safe);
}));

router.post("/campaigns", requirePermission("campaigns_create"), wrap(async (req, res) => {
  const b = req.body || {};
  if (!String(b.name || "").trim()) throw new ApiError(400, "Campaign name is required");
  const start = optDate(b.startDate, "start date"), end = optDate(b.endDate, "end date");
  // client_id is forced from the login. agent / knowledge base are attached by an admin.
  const { rows } = await query(
    `INSERT INTO campaigns (name, type, description, language, start_date, end_date, client_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, name, type, description, language, status, start_date, end_date, created_at`,
    [String(b.name).trim(), b.type || null, b.description || null, b.language || null, start, end, req.portal.clientId, req.portal.userId]);
  ok(res, rows[0], "Campaign created", 201);
}));

router.put("/campaigns/:id", requirePermission("campaigns_edit"), wrap(async (req, res) => {
  await ownedCampaign(req, req.params.id);
  const b = req.body || {};
  if (Object.prototype.hasOwnProperty.call(b, "name") && !String(b.name || "").trim()) throw new ApiError(400, "Campaign name cannot be empty");
  if (b.startDate) b.startDate = optDate(b.startDate, "start date");
  if (b.endDate) b.endDate = optDate(b.endDate, "end date");
  const { sets, params } = buildUpdate(b, CAMPAIGN_FIELDS, 3);
  if (!sets.length) throw new ApiError(400, "No fields to update");
  const { rows } = await query(
    `UPDATE campaigns SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 AND client_id = $2
     RETURNING id, name, type, description, language, status, start_date, end_date`, [req.params.id, req.portal.clientId, ...params]);
  ok(res, rows[0], "Campaign updated");
}));

router.delete("/campaigns/:id", requirePermission("campaigns_delete"), wrap(async (req, res) => {
  await ownedCampaign(req, req.params.id);
  await query(`DELETE FROM campaigns WHERE id = $1 AND client_id = $2`, [req.params.id, req.portal.clientId]);
  ok(res, null, "Campaign deleted");
}));

// ---------------- contacts / call lists ----------------
const CONTACT_FIELDS = { name: "name", phone: "phone", email: "email", language: "language", city: "city", notes: "notes" };
const checkPhone = (v) => { if (v && !PHONE_RE.test(String(v).replace(/\s+/g, ""))) throw new ApiError(400, "Invalid Indian mobile number format"); };

router.get("/contacts", requirePermission("contacts_view"), wrap(async (req, res) => {
  const { limit, offset } = page(req);
  const campaignId = optUuid(req.query.campaignId, "campaign ID");
  if (campaignId) await ownedCampaign(req, campaignId);
  const { rows } = await query(
    `SELECT ct.id, ct.campaign_id, ca.name AS campaign_name, ct.name, ct.phone, ct.email, ct.language, ct.city, ct.status,
            ct.call_attempts, ct.last_call_at, ct.outcome, ct.notes, ct.created_at
     FROM contacts ct JOIN campaigns ca ON ca.id = ct.campaign_id
     WHERE ca.client_id = $1 AND ($2::uuid IS NULL OR ct.campaign_id = $2::uuid)
     ORDER BY ct.created_at DESC LIMIT $3 OFFSET $4`, [req.portal.clientId, campaignId, limit, offset]);
  ok(res, rows);
}));

router.post("/contacts", requirePermission("contacts_create"), wrap(async (req, res) => {
  const b = req.body || {};
  await ownedCampaign(req, uuid(b.campaignId, "campaign ID"));
  if (!String(b.name || "").trim() || !b.phone) throw new ApiError(400, "Name and phone are required");
  checkPhone(b.phone);
  const { rows } = await query(
    `INSERT INTO contacts (campaign_id, name, phone, email, language, city, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, campaign_id, name, phone, email, language, city, status, notes, created_at`,
    [b.campaignId, String(b.name).trim(), String(b.phone).replace(/\s+/g, ""), b.email || null, b.language || null, b.city || null, b.notes || null]);
  ok(res, rows[0], "Contact added", 201);
}));

router.put("/contacts/:id", requirePermission("contacts_edit"), wrap(async (req, res) => {
  const existing = await ownedContact(req, req.params.id);
  const b = req.body || {};
  if (b.phone) { checkPhone(b.phone); b.phone = String(b.phone).replace(/\s+/g, ""); }
  if (Object.prototype.hasOwnProperty.call(b, "name") && !String(b.name || "").trim()) throw new ApiError(400, "Name cannot be empty");
  const { sets, params } = buildUpdate(b, CONTACT_FIELDS, 2);
  if (!sets.length) throw new ApiError(400, "No fields to update");
  const { rows } = await query(
    `UPDATE contacts SET ${sets.join(", ")}, updated_at = now() WHERE id = $1
     RETURNING id, campaign_id, name, phone, email, language, city, status, notes`, [existing.id, ...params]);
  ok(res, rows[0], "Contact updated");
}));

router.delete("/contacts/:id", requirePermission("contacts_delete"), wrap(async (req, res) => {
  const existing = await ownedContact(req, req.params.id);
  await query(`DELETE FROM contacts WHERE id = $1`, [existing.id]);
  ok(res, null, "Contact deleted");
}));

// ---------------- calls ----------------
const filters = (req) => ({
  status: req.query.status ? String(req.query.status) : null,
  campaignId: optUuid(req.query.campaignId, "campaign ID"),
  from: optDate(req.query.from, "from date"),
  to: optDate(req.query.to, "to date"),
});

router.get("/calls", requirePermission("calls_view"), wrap(async (req, res) => {
  const f = filters(req);
  if (f.campaignId) await ownedCampaign(req, f.campaignId);
  ok(res, await data.listCalls(req.portal.clientId, { ...f, ...page(req) }));
}));

router.get("/calls/:id", requirePermission("calls_view"), wrap(async (req, res) => {
  const c = await ownedCall(req, req.params.id);
  const { client_id, provider_call_id, agent_id, phone_number_id, customer_id, ...safe } = c;
  ok(res, safe);
}));

// ---------------- recordings ----------------
router.get("/recordings", requirePermission("recordings_view"), wrap(async (req, res) => {
  const campaignId = optUuid(req.query.campaignId, "campaign ID");
  if (campaignId) await ownedCampaign(req, campaignId);
  ok(res, await data.listRecordings(req.portal.clientId, { campaignId, ...page(req) }));
}));

router.get("/recordings/:id/url", requirePermission("recordings_view"), wrap(async (req, res) => {
  const rec = await ownedRecording(req, req.params.id);   // ownership verified BEFORE any link is signed
  const view = signFile(rec.id, 300);
  const out = { url: `/api/recordings/${rec.id}/file?exp=${view.exp}&sig=${view.sig}`, expiresIn: 300 };
  if (req.portal.permissions.has("recordings_download")) {
    const dl = signFile(rec.id, 300, "dl");
    out.downloadUrl = `/api/recordings/${rec.id}/file?exp=${dl.exp}&sig=${dl.sig}&dl=1`;
  }
  ok(res, out);
}));

// ---------------- analytics & reports ----------------
router.get("/analytics", requirePermission("analytics_view"), wrap(async (req, res) => {
  ok(res, await data.analytics(req.portal.clientId, { from: optDate(req.query.from, "from date"), to: optDate(req.query.to, "to date") }));
}));

router.get("/reports/summary", requirePermission("reports_view"), wrap(async (req, res) => {
  ok(res, await data.analytics(req.portal.clientId, { from: optDate(req.query.from, "from date"), to: optDate(req.query.to, "to date") }));
}));

const csvCell = (v) => {
  let s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;                       // block spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
router.get("/reports/calls.csv", requirePermission("reports_view"), wrap(async (req, res) => {
  const f = filters(req);
  if (f.campaignId) await ownedCampaign(req, f.campaignId);
  const rows = await data.listCalls(req.portal.clientId, { ...f, limit: 10000, offset: 0 });
  const cols = ["created_at", "campaign_name", "customer_name", "phone", "direction", "language", "status", "sentiment", "intent", "outcome", "duration_sec", "ai_summary"];
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n");
  res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="calls-report.csv"' }).send(csv);
}));

export default router;
