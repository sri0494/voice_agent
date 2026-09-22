import { Router } from "express";
import crypto from "crypto";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { ApiError } from "../middleware/errorHandler.js";
import { createTelephonyProvider } from "../services/telephony/TelephonyProvider.js";
import { placeOutboundCall } from "../services/telephony/placeCall.js";
import { validateTwilioSignature } from "../utils/twilioSignature.js";
import { logger } from "../utils/logger.js";

const router = Router();
const telephonyProvider = createTelephonyProvider();
const activeProviderName = (process.env.TELEPHONY_PROVIDER || "mock").toLowerCase();

// Validates the inbound webhook signature using the scheme appropriate to
// whichever real provider is active. Mock mode skips validation (nothing
// external is calling these endpoints). Add a branch here for each new
// real provider you implement (each has its own signature scheme).
function validateWebhookSignature(req) {
  if (telephonyProvider.isMock()) return true;
  if (activeProviderName === "twilio") {
    return validateTwilioSignature(req, process.env.TELEPHONY_API_SECRET);
  }
  // Fallback generic HMAC check for future providers configured with
  // TELEPHONY_WEBHOOK_SECRET, until they get their own real validator.
  const secret = process.env.TELEPHONY_WEBHOOK_SECRET;
  const signature = req.headers["x-webhook-signature"];
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(JSON.stringify(req.body)).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// Maps each real provider's own status vocabulary to LeoMox's internal one.
function mapProviderStatus(status) {
  if (activeProviderName === "twilio") {
    const map = {
      queued: "Ringing", ringing: "Ringing", "in-progress": "Connected",
      completed: "Completed", busy: "Failed", failed: "Failed",
      "no-answer": "Missed", canceled: "Failed",
    };
    return map[status] || status;
  }
  return status;
}

// --- Authenticated: place an outbound call for a contact within a campaign ---
router.post("/call", requireAuth, async (req, res, next) => {
  try {
    const { campaignId, contactId } = req.body;
    const { rows: campaignRows } = await query(`SELECT * FROM campaigns WHERE id = $1`, [campaignId]);
    const campaign = campaignRows[0];
    if (!campaign) throw new ApiError(404, "Campaign not found");

    const { call, mock } = await placeOutboundCall({ campaignId, contactId, agentId: campaign.agent_id });

    res.status(201).json({
      success: true,
      data: { ...call, mock },
      message: mock ? "Mock call created — configure TELEPHONY_PROVIDER for real calls" : "Call initiated",
    });
  } catch (err) {
    if (err.message === "Contact not found") return next(new ApiError(404, err.message));
    next(err instanceof ApiError ? err : new ApiError(502, `Telephony error: ${err.message}`));
  }
});

// --- Public webhooks (called by the telephony provider) ---
router.post("/webhook", async (req, res, next) => {
  try {
    if (!validateWebhookSignature(req)) throw new ApiError(401, "Invalid webhook signature");
    logger.info("telephony_webhook", { body: req.body });
    res.json({ success: true, data: null, message: "Webhook received" });
  } catch (err) { next(err); }
});

// Twilio's StatusCallback posts form-encoded fields: CallSid, CallStatus,
// CallDuration (seconds, only present on completion). This handler accepts
// either that shape or the generic providerCallId/status/durationSec shape
// (for future non-Twilio providers), whichever is present.
router.post("/status", async (req, res, next) => {
  try {
    if (!validateWebhookSignature(req)) throw new ApiError(401, "Invalid webhook signature");

    const providerCallId = req.body.CallSid || req.body.providerCallId;
    const rawStatus = req.body.CallStatus || req.body.status;
    const durationSec = req.body.CallDuration || req.body.durationSec || null;
    const status = rawStatus ? mapProviderStatus(rawStatus) : null;

    if (providerCallId && status) {
      const { rows: updatedCalls } = await query(
        `UPDATE calls SET status = $2, duration_sec = COALESCE($3, duration_sec),
          ended_at = CASE WHEN $2 IN ('Completed','Failed','Missed') THEN now() ELSE ended_at END,
          updated_at = now()
         WHERE provider_call_id = $1
         RETURNING id, contact_id`,
        [providerCallId, status, durationSec]
      );
      logger.info("call_status_updated", { providerCallId, status });

      const call = updatedCalls[0];
      if (call?.contact_id && ["Completed", "Failed", "Missed"].includes(status)) {
        await query(
          `UPDATE contacts SET status = $2, last_call_at = now(), outcome = $3 WHERE id = $1`,
          [call.contact_id, status === "Completed" ? "DONE" : "FAILED", status]
        );
      }
    }
    // Twilio expects a 200 with no particular body for status callbacks.
    res.status(200).send("");
  } catch (err) { next(err); }
});

// Twilio's recording callback posts: CallSid, RecordingUrl, RecordingDuration.
router.post("/recording", async (req, res, next) => {
  try {
    if (!validateWebhookSignature(req)) throw new ApiError(401, "Invalid webhook signature");

    const providerCallId = req.body.CallSid || req.body.providerCallId;
    const recordingUrl = req.body.RecordingUrl || req.body.recordingUrl;
    const durationSec = req.body.RecordingDuration || req.body.durationSec || null;

    const { rows } = await query(`SELECT id FROM calls WHERE provider_call_id = $1`, [providerCallId]);
    if (rows[0] && recordingUrl) {
      await query(
        `INSERT INTO call_recordings (call_id, url, duration_sec) VALUES ($1,$2,$3)`,
        [rows[0].id, recordingUrl, durationSec]
      );
    }
    res.status(200).send("");
  } catch (err) { next(err); }
});

export default router;
