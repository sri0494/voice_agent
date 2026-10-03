import crypto from "node:crypto";
import net from "node:net";
import { v4 as uuid } from "uuid";
import { query } from "../db/pool.js";
import { ApiError } from "../middleware/errorHandler.js";
import { getStorage } from "./storage/index.js";

export const MAX_BYTES = (Number(process.env.RECORDING_MAX_MB) || 50) * 1024 * 1024;

const EXT = {
  "audio/webm": "webm", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp3": "mp3",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
  "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac",
};
const EXT_TO_TYPE = { webm: "audio/webm", ogg: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac" };

export const normalizeType = (t) => String(t || "").split(";")[0].trim().toLowerCase();

export const publicRow = ({ storage_key, storage_provider, original_url, ...rest }) => rest;

// Calls that belong to a customer's campaign are stored under customers/<id>/campaigns/<id>/recordings/.
async function recordingKey(callId, ext) {
  if (callId) {
    try {
      const { rows } = await query(
        `SELECT c.campaign_id, ca.client_id FROM calls c LEFT JOIN campaigns ca ON ca.id = c.campaign_id WHERE c.id = $1`, [callId]);
      const r = rows[0];
      if (r?.client_id && r?.campaign_id) return `customers/${r.client_id}/campaigns/${r.campaign_id}/recordings/${uuid()}.${ext}`;
    } catch { /* client portal migration not applied yet: fall back to the flat path */ }
  }
  const d = new Date();
  return `recordings/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${uuid()}.${ext}`;
}

/** Store a recording buffer in object storage and record it in the DB. */
export async function saveRecording({ callId = null, buffer, contentType, durationSec = null, source = "upload", userId = null, originalUrl = null }) {
  const type = normalizeType(contentType);
  const ext = EXT[type];
  if (!ext) throw new ApiError(415, `Unsupported audio type: ${type || "unknown"}`);
  if (!buffer?.length) throw new ApiError(400, "Empty recording");
  if (buffer.length > MAX_BYTES) throw new ApiError(413, `Recording too large (max ${MAX_BYTES / 1024 / 1024} MB)`);

  const key = await recordingKey(callId, ext);
  const storage = await getStorage();
  await storage.put(key, buffer, type);

  try {
    const { rows } = await query(
      `INSERT INTO call_recording_files
         (call_id, source, storage_provider, storage_key, content_type, size_bytes, duration_sec, original_url, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [callId, source, storage.name, key, type, buffer.length, durationSec, originalUrl, userId ? String(userId) : null]
    );
    return publicRow(rows[0]);
  } catch (err) {
    await storage.remove(key).catch(() => {}); // don't leave orphaned files behind
    throw err;
  }
}

function isPrivateHost(host) {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (net.isIPv4(h)) {
    const [a, b] = h.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (net.isIPv6(h)) return h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80");
  return false;
}

/**
 * Download a recording the telephony provider hosts (from its webhook URL)
 * and copy it into our own storage. Call this from POST /api/telephony/recording
 * AFTER the webhook signature has been validated.
 */
export async function ingestRecordingFromUrl({ callId, url, headers = {}, durationSec = null }) {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new ApiError(400, "Recording URL must use https");
  const allow = (process.env.RECORDING_URL_ALLOWLIST || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const host = u.hostname.toLowerCase();
  if (allow.length ? !allow.some((h) => host === h || host.endsWith(`.${h}`)) : isPrivateHost(host)) {
    throw new ApiError(400, "Recording host not allowed");
  }

  const res = await fetch(url, { headers });
  if (!res.ok) throw new ApiError(502, `Could not download recording (HTTP ${res.status})`);
  const declared = Number(res.headers.get("content-length"));
  if (declared > MAX_BYTES) throw new ApiError(413, "Recording too large");
  const buffer = Buffer.from(await res.arrayBuffer());

  let type = normalizeType(res.headers.get("content-type"));
  if (!EXT[type]) type = EXT_TO_TYPE[u.pathname.split(".").pop().toLowerCase()] || type; // providers often send octet-stream
  return saveRecording({ callId, buffer, contentType: type, durationSec, source: "telephony", originalUrl: url });
}

// ---- Short-lived signed links (for <audio> tags, which can't send an Authorization header) ----
const secret = () => {
  const s = process.env.RECORDING_URL_SECRET || process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET (or RECORDING_URL_SECRET) must be set");
  return s;
};
const mac = (id, exp, scope = "") => crypto.createHmac("sha256", secret()).update(`${id}.${exp}${scope ? `.${scope}` : ""}`).digest("hex");

// scope "dl" = download link (separate signature, so a view link cannot be turned into a download link)
export function signFile(id, ttlSec = 300, scope = "") {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return { exp, sig: mac(id, exp, scope) };
}

export function verifyFile(id, exp, sig, scope = "") {
  if (!exp || !sig || Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const a = Buffer.from(mac(id, exp, scope)), b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
