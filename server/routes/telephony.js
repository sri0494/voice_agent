import { Router } from "express";
import crypto from "crypto";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { ApiError } from "../middleware/errorHandler.js";
import { createTelephonyProvider } from "../services/telephony/TelephonyProvider.js";
import { logger } from "../utils/logger.js";

const router = Router();
const telephonyProvider = createTelephonyProvider();

// Validates an HMAC signature header if the configured provider supports one.
// Real providers vary (X-Twilio-Signature, X-Exotel-Signature, etc.) — implement
// the provider-specific check here when TELEPHONY_PROVIDER is set to a real value.
function validateWebhookSignature(req) {
  if (telephonyProvider.isMock()) return true; // no signature to validate in mock/dev mode
  const secret = process.env.TELEPHONY_WEBHOOK_SECRET;
  const signature = req.headers["x-webhook-signature"];
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(JSON.stringify(req.body)).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// --- Authenticated: place an outbound call for a contact within a campaign ---
router.post("/call", requireAuth, async (req, res, next) => {
  try {
    const { campaignId, contactId } = req.body;
    const { rows: contactRows } = await query(`SELECT * FROM contacts WHERE id = $1`, [contactId]);
    const contact = contactRows[0];
    if (!contact) throw new ApiError(404, "Contact not found");

    const { rows: campaignRows } = await query(`SELECT * FROM campaigns WHERE id = $1`, [campaignId]);
    const campaign = campaignRows[0];
    if (!campaign) throw new ApiError(404, "Campaign not found");

    const result = await telephonyProvider.makeCall({
      to: contact.phone,
      from: process.env.TELEPHONY_PHONE_NUMBER || "MOCK_NUMBER",
      campaignId,
      agentId: campaign.agent_id,
    });

    const { rows: callRows } = await query(
      `INSERT INTO calls (campaign_id, contact_id, agent_id, direction, phone, language, status, provider_call_id, started_at)
       VALUES ($1,$2,$3,'OUTBOUND',$4,$5,$6,$7, now()) RETURNING *`,
      [campaignId, contactId, campaign.agent_id, contact.phone, contact.language, result.status, result.providerCallId]
    );

    await query(`UPDATE contacts SET status = 'QUEUED', call_attempts = call_attempts + 1 WHERE id = $1`, [contactId]);

    res.status(201).json({
      success: true,
      data: { ...callRows[0], mock: result.mock || false },
      message: result.mock
        ? "Mock call created — configure TELEPHONY_PROVIDER for real calls"
        : "Call initiated",
    });
  } catch (err) { next(err); }
});

// --- Public webhooks (called by the telephony provider) ---
router.post("/webhook", async (req, res, next) => {
  try {
    if (!validateWebhookSignature(req)) throw new ApiError(401, "Invalid webhook signature");
    logger.info("telephony_webhook", { body: req.body });
    // Provider-specific event parsing goes here (call.ringing, call.answered, call.transferred, etc.)
    res.json({ success: true, data: null, message: "Webhook received" });
  } catch (err) { next(err); }
});

router.post("/status", async (req, res, next) => {
  try {
    if (!validateWebhookSignature(req)) throw new ApiError(401, "Invalid webhook signature");
    const { providerCallId, status, durationSec } = req.body;
    if (providerCallId && status) {
      await query(
        `UPDATE calls SET status = $2, duration_sec = COALESCE($3, duration_sec),
          ended_at = CASE WHEN $2 IN ('Completed','Failed','Missed') THEN now() ELSE ended_at END,
          updated_at = now()
         WHERE provider_call_id = $1`,
        [providerCallId, status, durationSec || null]
      );
    }
    res.json({ success: true, data: null, message: "Status updated" });
  } catch (err) { next(err); }
});

router.post("/recording", async (req, res, next) => {
  try {
    if (!validateWebhookSignature(req)) throw new ApiError(401, "Invalid webhook signature");
    const { providerCallId, recordingUrl, durationSec } = req.body;
    const { rows } = await query(`SELECT id FROM calls WHERE provider_call_id = $1`, [providerCallId]);
    if (rows[0]) {
      await query(
        `INSERT INTO call_recordings (call_id, url, duration_sec) VALUES ($1,$2,$3)`,
        [rows[0].id, recordingUrl, durationSec || null]
      );
    }
    res.json({ success: true, data: null, message: "Recording saved" });
  } catch (err) { next(err); }
});

export default router;
