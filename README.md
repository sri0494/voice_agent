# LeoMox — AI Voice Platform

LeoMox is a full-stack platform for AI voice agents: outbound campaigns, inbound
support, government/citizen surveys, payment & appointment reminders, grievance
collection, human-agent transfer, RAG-powered knowledge bases, and call analytics.

This repository contains a **complete, runnable scaffold**: React/Vite frontend,
Express/Node backend, PostgreSQL (Neon-ready) schema with pgvector, JWT auth,
a full RAG pipeline, and provider-abstraction interfaces for AI/STT/TTS/Telephony
so you can plug in real vendors without touching application code.

> **Status note:** this was generated in an environment with no internet access,
> so `npm install` / `npm run build` / a live Neon connection could not be executed
> or verified here. Every file was hand-checked for syntax (`node --check` on all
> backend files; consistent imports/routes across the frontend), but you should
> run the steps below yourself before treating this as production-ready.

---

## 1. Architecture

```
React/Vite Frontend (SPA)
        |
        | HTTPS REST API + WebSocket (live calls)
        v
Node.js / Express Backend
        |
        +----------------------+
        |                      |
        v                      v
  Neon PostgreSQL         AI/Voice Provider Interfaces
        |                      |
        |              +-------+-------+-------+
        |              |       |       |       |
        |             STT     LLM     TTS  Telephony
        |
        +-- users, agents, campaigns, contacts
        +-- calls, call_messages, call_recordings
        +-- knowledge_bases, knowledge_documents, knowledge_chunks (pgvector)
        +-- contact_requests, integrations, audit_logs
```

Provider-specific code lives only in `server/services/{ai,speech,telephony,knowledge}/`.
Every provider is selected at runtime via an environment variable
(`AI_PROVIDER`, `STT_PROVIDER`, `TTS_PROVIDER`, `TELEPHONY_PROVIDER`,
`EMBEDDING_PROVIDER`) and defaults to a **mock implementation** so the whole
app — RAG, campaigns, live-call UI — works out of the box with zero external
API keys. Real vendors are added by implementing the abstract class in each
file and adding a `case` in that file's `create*Provider()` factory function.

**LeoMox does not claim to place real phone calls or generate real AI/voice
output unless real providers are configured.** Mock responses are tagged
`mock: true` in API responses so the UI can label them honestly.

---

## 2. Prerequisites

- Node.js 18+
- A [Neon](https://neon.tech) PostgreSQL database (or any Postgres with the
  `pgvector` extension available)
- (Optional for real voice) accounts with an AI/LLM provider, an STT/TTS
  provider, and an India-compliant telephony provider (e.g. Exotel,
  Knowlarity, Ozonetel)

---

## 3. Local Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# edit .env — at minimum set DATABASE_URL and JWT_SECRET

# 3. Create database schema (safe to re-run; never drops data)
npm run db:init

# 4. (Optional, dev only) seed demo data — campaigns, calls, agents, KBs
npm run db:seed
# creates admin@leomox.ai / Leomox@123 — change this password immediately

# 5. Run frontend + backend together in dev mode
npm run dev
# Frontend: http://localhost:5173 (proxies /api and /ws to :10000)
# Backend:  http://localhost:10000
```

## 4. Production Build & Run

```bash
npm install
npm run build      # builds the React app into /dist
npm run db:init    # apply schema to your production DATABASE_URL
npm start          # Express serves both the API and the built frontend on $PORT
```

Health check: `GET /api/health` → `{ "ok": true, "database": "connected" }`

---

## 5. Deploying to Render + Neon

1. Create a Neon Postgres project, copy the **pooled** connection string
   (`...-pooler....neon.tech/...?sslmode=require`).
2. In Render, create a **Web Service** from this repo.
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
   - Environment: set every variable from `.env.example` (`DATABASE_URL`,
     `JWT_SECRET`, provider keys, etc.) in Render's dashboard. **Never** commit
     `.env` or put secret keys in `VITE_*` variables.
3. After the first deploy, run `npm run db:init` against the production
   `DATABASE_URL` (via a Render Shell, or locally with the same connection
   string) to create tables.
4. Do **not** run `npm run db:seed` in production — it refuses to run when
   `NODE_ENV=production` by design.

---

## 6. Connecting Real Providers

Every provider is a drop-in swap. Example for telephony:

```env
TELEPHONY_PROVIDER=exotel
TELEPHONY_API_KEY=...
TELEPHONY_API_SECRET=...
TELEPHONY_PHONE_NUMBER=+91XXXXXXXXXX
TELEPHONY_WEBHOOK_SECRET=...
```

Then implement a class extending `TelephonyProvider` in
`server/services/telephony/TelephonyProvider.js` (there's a commented example
`case` already in `createTelephonyProvider()`) implementing `makeCall`,
`hangup`, `transfer`, `getCallStatus`, `getRecording`. Do the same pattern for
`AIProvider`, `SpeechToTextProvider`, `TextToSpeechProvider`, and
`EmbeddingProvider`. No other file needs to change.

Webhook endpoints are already wired for provider callbacks:
```
POST /api/telephony/webhook
POST /api/telephony/status
POST /api/telephony/recording
```
Signature validation is stubbed in `validateWebhookSignature()` — implement
your provider's specific signature scheme there (most providers use HMAC-SHA256
over the raw payload with a shared secret).

---

## 7. Knowledge Base / RAG Pipeline

```
Upload → Text Extraction → Cleaning → Chunking → Embedding → pgvector storage
                                                                    |
Customer question → Embed question → Cosine similarity search -----+
                                              |
                                    Relevant chunks → LLM context → Answer
```

- Supported formats: PDF, TXT, DOCX, CSV, Markdown (`server/services/knowledge/documentParser.js`)
- Chunking: 1000 chars with 150-char overlap (`chunker.js`)
- Embeddings: pluggable via `EMBEDDING_PROVIDER`; mock provider uses a
  deterministic hash-based vector so the full pipeline is testable without a
  real embedding API key (not semantically meaningful — swap in a real
  provider before relying on retrieval quality)
- Similarity search: pgvector cosine distance (`vectorSearch.js`)
- If no chunk clears the similarity threshold, the agent returns its
  configured **fallback message** rather than guessing — this is enforced in
  `rag.js` and is the core anti-hallucination safeguard for government/pricing
  content.

---

## 8. Default Roles

`SUPER_ADMIN`, `ADMIN`, `MANAGER`, `AGENT`, `VIEWER` — see
`server/middleware/auth.js` (`requireRole`) and `db/schema.sql` for where
role checks are enforced (user management and contact-request triage are
admin/manager-only; everything else requires a valid session).

---

## 9. Project Structure

```
leomox/
├── src/                    # React frontend
│   ├── components/         # Sidebar, Topbar, StatCard, StatusBadge, DataState
│   ├── pages/               # One file per route (see App.jsx for the map)
│   ├── layouts/             # DashboardLayout (sidebar + topbar shell)
│   ├── context/              # AuthContext (session persistence)
│   └── services/api.js      # single place all fetch() calls go through
│
├── server/
│   ├── routes/              # one file per /api/* resource
│   ├── services/
│   │   ├── ai/               # AIProvider + mock
│   │   ├── speech/            # STT / TTS providers + mocks
│   │   ├── telephony/         # TelephonyProvider + mock
│   │   └── knowledge/         # parser, chunker, embeddings, vectorSearch, rag, ingest
│   ├── middleware/           # auth, error handling, rate limiting, logging
│   ├── db/                    # pool, init script, seed script
│   └── index.js               # Express app + WebSocket server
│
├── db/schema.sql            # full Postgres schema (pgvector, indexes, constraints)
├── uploads/                 # local file storage for uploaded KB documents
└── .env.example
```

---

## 10. What's Deliberately Left as a Provider Adapter

Per the safety requirements this project was built to: LeoMox will **not**
claim a voice agent is live/real unless real Telephony + STT + TTS + AI
providers are configured. The mock providers exist so you can develop,
demo, and test the entire product loop — agent config, campaigns, contact
upload, knowledge base, RAG answers, analytics — before connecting a single
paid vendor.
