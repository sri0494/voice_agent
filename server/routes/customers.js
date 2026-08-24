import { Router } from "express";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { ApiError } from "../middleware/errorHandler.js";

const router = Router();
router.use(requireAuth);

const PHONE_RE = /^[6-9]\d{9}$|^\+91[6-9]\d{9}$/;

router.get("/", async (req, res, next) => {
  try {
    const { status, q } = req.query;
    const conditions = [];
    const params = [];
    if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
    if (q) {
      params.push(`%${q}%`);
      conditions.push(`(first_name ILIKE $${params.length} OR last_name ILIKE $${params.length} OR mobile ILIKE $${params.length} OR email ILIKE $${params.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await query(
      `SELECT c.*, a.name AS assigned_agent_name FROM customers c
       LEFT JOIN agents a ON a.id = c.assigned_agent_id
       ${where} ORDER BY c.created_at DESC LIMIT 500`,
      params
    );
    res.json({ success: true, data: rows, message: "Success" });
  } catch (err) { next(err); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*, a.name AS assigned_agent_name FROM customers c
       LEFT JOIN agents a ON a.id = c.assigned_agent_id WHERE c.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) throw new ApiError(404, "Customer not found");

    // Full profile: call history, transcripts summary, notes/tags already on the row.
    const { rows: calls } = await query(
      `SELECT id, status, intent, sentiment, outcome, ai_summary, duration_sec, started_at, ended_at
       FROM calls WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.params.id]
    );

    res.json({ success: true, data: { ...rows[0], calls }, message: "Success" });
  } catch (err) { next(err); }
});

router.post("/", async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.firstName || !b.mobile) throw new ApiError(400, "First name and mobile are required");
    if (!PHONE_RE.test(b.mobile)) throw new ApiError(400, "Invalid Indian mobile number format");

    const { rows } = await query(
      `INSERT INTO customers (first_name, last_name, mobile, alternate_mobile, email, customer_code,
                               address, city, state, country, pin_code, customer_type, company_name,
                               customer_category, assigned_agent_id, status, date_of_birth,
                               preferred_language, communication_preference, notes, tags, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING *`,
      [b.firstName, b.lastName || null, b.mobile, b.alternateMobile || null, b.email || null,
       b.customerCode || null, b.address || null, b.city || null, b.state || null, b.country || "India",
       b.pinCode || null, b.customerType || null, b.companyName || null, b.customerCategory || null,
       b.assignedAgentId || null, b.status || "Active", b.dateOfBirth || null,
       b.preferredLanguage || "English", b.communicationPreference || null, b.notes || null,
       b.tags || [], req.user.id]
    );
    res.status(201).json({ success: true, data: rows[0], message: "Customer created" });
  } catch (err) { next(err); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await query(
      `UPDATE customers SET
        first_name = COALESCE($2, first_name), last_name = COALESCE($3, last_name),
        mobile = COALESCE($4, mobile), email = COALESCE($5, email),
        status = COALESCE($6, status), assigned_agent_id = COALESCE($7, assigned_agent_id),
        notes = COALESCE($8, notes), tags = COALESCE($9, tags),
        city = COALESCE($10, city), customer_type = COALESCE($11, customer_type),
        updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id, b.firstName, b.lastName, b.mobile, b.email, b.status, b.assignedAgentId,
       b.notes, b.tags, b.city, b.customerType]
    );
    if (!rows[0]) throw new ApiError(404, "Customer not found");
    res.json({ success: true, data: rows[0], message: "Customer updated" });
  } catch (err) { next(err); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const { rowCount } = await query(`DELETE FROM customers WHERE id = $1`, [req.params.id]);
    if (!rowCount) throw new ApiError(404, "Customer not found");
    res.json({ success: true, data: null, message: "Customer deleted" });
  } catch (err) { next(err); }
});

// Convert a Public Contact into a Customer (spec section 5).
router.post("/convert-from-contact/:contactId", async (req, res, next) => {
  try {
    const { rows: contactRows } = await query(`SELECT * FROM contacts WHERE id = $1`, [req.params.contactId]);
    const contact = contactRows[0];
    if (!contact) throw new ApiError(404, "Contact not found");
    if (contact.converted_to_customer_id) throw new ApiError(409, "Contact already converted to a customer");

    const nameParts = (contact.name || "").trim().split(" ");
    const firstName = nameParts[0] || "Unknown";
    const lastName = nameParts.slice(1).join(" ") || null;

    const { rows: customerRows } = await query(
      `INSERT INTO customers (first_name, last_name, mobile, email, city, state, country,
                               preferred_language, tags, notes, status, source_contact_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Active',$11,$12) RETURNING *`,
      [firstName, lastName, contact.phone, contact.email, contact.city, contact.state,
       contact.country || "India", contact.language, contact.tags || [], contact.notes,
       contact.id, req.user.id]
    );

    await query(`UPDATE contacts SET converted_to_customer_id = $2 WHERE id = $1`, [contact.id, customerRows[0].id]);

    res.status(201).json({ success: true, data: customerRows[0], message: "Contact converted to customer" });
  } catch (err) { next(err); }
});

export default router;
