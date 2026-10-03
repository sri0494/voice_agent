# Recorder + object storage: setup

## 1. Install (server only, S3 mode)
    npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
(multer and uuid are already in your package.json.)

## 2. Database (Neon SQL editor)
Run `db/migrations/002_call_recording_files.sql`. Consider appending it to `db/schema.sql` too.

## 3. Register the route (server/index.js)
    import recordingsRouter from "./routes/recordings.js";
    app.use("/api/recordings", recordingsRouter);   // next to your other app.use("/api/...") lines

## 4. Env vars (Render dashboard + .env.example)
    STORAGE_PROVIDER=s3            # "local" only for development
    S3_BUCKET=leomox-recordings
    S3_ACCESS_KEY_ID=...
    S3_SECRET_ACCESS_KEY=...
    S3_REGION=ap-south-1           # Cloudflare R2: auto
    S3_ENDPOINT=                   # AWS: leave empty.  R2: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
    S3_FORCE_PATH_STYLE=false      # true for MinIO
    RECORDING_MAX_MB=50
    RECORDING_URL_ALLOWLIST=       # telephony provider's recording host(s), e.g. recordings.exotel.com
Keep the bucket PRIVATE (no public access). Playback uses 5-minute signed links.

## 5. Frontend API helpers (src/services/api.js)
Add these. Copy the token lookup from your existing request() helper into uploadRecording.
    export const getRecordings = (params = {}) => request(`/recordings?${new URLSearchParams(params)}`);
    export const getRecordingUrl = (id) => request(`/recordings/${id}/url`);
    export const deleteRecording = (id) => request(`/recordings/${id}`, { method: "DELETE" });
    export async function uploadRecording(blob, { callId, durationSec } = {}) {
      const form = new FormData();
      form.append("audio", blob, "recording");
      if (callId) form.append("callId", callId);
      if (durationSec) form.append("durationSec", String(durationSec));
      form.append("source", "browser");
      const token = /* SAME way request() reads the JWT, e.g. localStorage.getItem("...") */ null;
      const res = await fetch("/api/recordings", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},   // do NOT set Content-Type
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || json.error || "Upload failed");
      return json.data;
    }
If request() unwraps `.data` for you (it seems to), `getRecordings` returns an array and `getRecordingUrl` returns `{ url }`.

## 6. Telephony recordings (server/routes/telephony.js, in POST /recording, AFTER signature validation)
    import { ingestRecordingFromUrl } from "../services/recordings.js";
    await ingestRecordingFromUrl({
      callId: call.id,                                   // look the call up from the provider's call SID
      url: req.body.RecordingUrl,                        // field names vary by provider
      durationSec: Number(req.body.RecordingDuration) || null,
    });
This copies the file into YOUR bucket so you don't depend on the provider's retention.

## 7. Copy files
    server/services/storage/index.js  ->  same path
    server/services/recordings.js     ->  same path
    server/routes/recordings.js       ->  same path
    src/components/VoiceRecorder.jsx, RecordingList.jsx  ->  src/components/
    src/pages/CustomerDetail.jsx      ->  src/pages/   (adds a "Recordings" button per call)

---

# Customer Portal (server side)

## A. Database (Neon SQL editor)
Run `db/migrations/003_client_portal.sql` (safe to re-run; it also creates the recording table, so 002 is optional).
If `users.role` has a CHECK constraint, add 'CUSTOMER' to it (query is at the bottom of the migration).
Existing campaigns have no customer yet: they are invisible to customers until an admin assigns them.

## B. Register routes in server/index.js
The blocker MUST come before every other /api router:

    import { blockCustomerOutsidePortal } from "./middleware/portal.js";
    import customerPortalRouter from "./routes/customerPortal.js";
    import clientsRouter from "./routes/clients.js";

    app.use("/api", blockCustomerOutsidePortal);          // first!
    app.use("/api/customer", customerPortalRouter);
    app.use("/api/clients", clientsRouter);
    // ...your existing app.use("/api/...") lines, and recordingsRouter

## C. Copy files
    db/migrations/003_client_portal.sql
    server/middleware/portal.js
    server/services/permissions.js, clientData.js
    server/routes/customerPortal.js, clients.js
    server/services/recordings.js, server/routes/recordings.js, server/services/storage/index.js   (UPDATED: customer folders + download scope)

## D. Quick manual test
1. As admin: POST /api/clients {"name":"ABC Hospital"}
2. POST /api/clients/<id>/login {"email":"abc@hospital.com"}  -> returns a temporary password
3. PUT /api/clients/<id>/permissions {"permissions":["campaigns_view","calls_view","analytics_view"]}
4. POST /api/clients/<id>/campaigns {"campaignIds":["<campaign uuid>"]}
5. Log in as the customer, then GET /api/customer/campaigns, and try an admin URL like /api/customers (must return 403).
