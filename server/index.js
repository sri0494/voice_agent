import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import { healthCheck } from "./db/pool.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { logger } from "./utils/logger.js";

import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import agentRoutes from "./routes/agents.js";
import campaignRoutes from "./routes/campaigns.js";
import contactRoutes from "./routes/contacts.js";
import customerRoutes from "./routes/customers.js";
import callRoutes from "./routes/calls.js";
import knowledgeBaseRoutes from "./routes/knowledgeBases.js";
import documentRoutes from "./routes/documents.js";
import ragRoutes from "./routes/rag.js";
import telephonyRoutes from "./routes/telephony.js";
import contactRequestRoutes from "./routes/contactRequests.js";
import analyticsRoutes from "./routes/analytics.js";
import integrationRoutes from "./routes/integrations.js";
import businessIntegrationRoutes from "./routes/businessIntegrations.js";
import phoneNumberRoutes from "./routes/phoneNumbers.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);

// Render (and most PaaS platforms) sit behind a reverse proxy that sets
// X-Forwarded-For. Without this, express-rate-limit can't reliably identify
// clients and throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set("trust proxy", 1);

// --- Security & core middleware ---
app.use(helmet({ contentSecurityPolicy: false })); // CSP relaxed for the bundled SPA; tighten per-deployment as needed
app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: true }));
app.use(compression());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
app.use("/api", apiLimiter);

// --- Health check (checks app + database, per spec) ---
app.get("/api/health", async (req, res) => {
  const dbOk = await healthCheck();
  res.status(dbOk ? 200 : 503).json({ ok: dbOk, database: dbOk ? "connected" : "disconnected" });
});

// --- API routes ---
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/agents", agentRoutes);
app.use("/api/campaigns", campaignRoutes);
app.use("/api/contacts", contactRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/calls", callRoutes);
app.use("/api/knowledge-bases", knowledgeBaseRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/rag", ragRoutes);
app.use("/api/telephony", telephonyRoutes);
app.use("/api/contact-requests", contactRequestRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/integrations", integrationRoutes);
app.use("/api/business-integrations", businessIntegrationRoutes);
app.use("/api/phone-numbers", phoneNumberRoutes);

// --- Serve built frontend in production (single Render web service) ---
const distPath = path.resolve(__dirname, "../dist");
app.use(express.static(distPath));
app.get(/^(?!\/api).*/, (req, res, next) => {
  res.sendFile(path.join(distPath, "index.html"), (err) => {
    if (err) next(); // dist not built yet (e.g. local API-only dev) — fall through to 404
  });
});

app.use("/api", notFoundHandler);
app.use(errorHandler);

// --- WebSocket server for live call updates (Live Calls dashboard) ---
// Avoids continuous polling: clients subscribe to /ws/live-calls and receive
// push updates whenever call status changes. Broadcast hook is exported so
// route handlers (e.g. telephony status webhook) can push updates.
const wss = new WebSocketServer({ server, path: "/ws/live-calls" });
const liveCallClients = new Set();

wss.on("connection", (ws) => {
  liveCallClients.add(ws);
  ws.on("close", () => liveCallClients.delete(ws));
});

export function broadcastLiveCallUpdate(payload) {
  const message = JSON.stringify(payload);
  for (const client of liveCallClients) {
    if (client.readyState === client.OPEN) client.send(message);
  }
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, "0.0.0.0", () => {
  logger.info("server_started", { port: PORT, env: process.env.NODE_ENV || "development" });
});

process.on("SIGTERM", () => {
  logger.info("shutdown", { signal: "SIGTERM" });
  server.close(() => process.exit(0));
});
