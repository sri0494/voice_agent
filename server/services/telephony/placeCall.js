// placeCall.js — the single place that actually places an outbound call.
// Used by both the manual "Call" button (server/routes/telephony.js) and
// the automatic campaign dialer (server/services/campaigns/campaignDialer.js),
// so there's exactly one code path to get right rather than two that can drift.
import { query } from "../../db/pool.js";
import { createTelephonyProvider } from "../telephony/TelephonyProvider.js";
import { logger } from "../../utils/logger.js";

const telephonyProvider = createTelephonyProvider();

export async function placeOutboundCall({ campaignId, contactId, agentId }) {
  const { rows: contactRows } = await query(`SELECT * FROM contacts WHERE id = $1`, [contactId]);
  const contact = contactRows[0];
  if (!contact) throw new Error("Contact not found");

  const { rows: callRows } = await query(
    `INSERT INTO calls (campaign_id, contact_id, agent_id, direction, phone, language, status, started_at)
     VALUES ($1,$2,$3,'OUTBOUND',$4,$5,'Ringing', now()) RETURNING *`,
    [campaignId, contactId, agentId, contact.phone, contact.language]
  );
  const call = callRows[0];

  let result;
  try {
    result = await telephonyProvider.makeCall({
      to: contact.phone,
      from: process.env.TELEPHONY_PHONE_NUMBER,
      campaignId,
      agentId,
      callId: call.id,
    });
  } catch (providerErr) {
    await query(`UPDATE calls SET status = 'Failed', updated_at = now() WHERE id = $1`, [call.id]);
    logger.error("call_placement_failed", { callId: call.id, error: providerErr.message });
    throw providerErr;
  }

  const { rows: updatedRows } = await query(
    `UPDATE calls SET status = $2, provider_call_id = $3, updated_at = now() WHERE id = $1 RETURNING *`,
    [call.id, result.status, result.providerCallId]
  );

  await query(`UPDATE contacts SET status = 'QUEUED', call_attempts = call_attempts + 1 WHERE id = $1`, [contactId]);

  return { call: updatedRows[0], mock: result.mock !== false };
}
