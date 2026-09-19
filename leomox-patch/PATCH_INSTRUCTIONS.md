# LeoMox Patch: Conversation Intelligence + Survey Engine

This patch is additive only — it does not modify or delete anything in your
existing working app. Follow these steps in order.

## 1. Run the database migration

Paste `db/migrations/003_conversation_intelligence_surveys.sql` into Neon's
SQL Editor and run it. Safe to re-run; only adds columns/tables.

## 2. Copy new files into your repo

Copy these files into the matching paths in your existing `leomox` project
(create the folders if they don't exist):

```
server/services/conversation/relevanceEngine.js
server/services/conversation/conversationOrchestrator.js
server/routes/conversation.js
server/routes/surveys.js
server/routes/agentSteering.js
src/pages/Surveys.jsx
src/pages/SurveyDetail.jsx
src/pages/ai-engine/AgentSteering.jsx
src/pages/ai-engine/ConversationTestPanel.jsx
```

## 3. Register the new backend routes

Open `server/index.js`. Add these three import lines near your other route imports:

```js
import conversationRoutes from "./routes/conversation.js";
import surveyRoutes from "./routes/surveys.js";
import agentSteeringRoutes from "./routes/agentSteering.js";
```

Add these three lines near your other `app.use("/api/...")` lines:

```js
app.use("/api/conversation", conversationRoutes);
app.use("/api/surveys", surveyRoutes);
app.use("/api/agent-steering", agentSteeringRoutes);
```

## 4. Add the new frontend API functions

Open `src/services/api.js` and add this block anywhere after the existing exports:

```js
// ---------- Surveys ----------
export const getSurveys = () => request("/surveys");
export const getSurvey = (id) => request(`/surveys/${id}`);
export const createSurvey = (data) => request("/surveys", { method: "POST", body: data });
export const updateSurvey = (id, data) => request(`/surveys/${id}`, { method: "PUT", body: data });
export const deleteSurvey = (id) => request(`/surveys/${id}`, { method: "DELETE" });
export const addSurveyQuestion = (surveyId, data) => request(`/surveys/${surveyId}/questions`, { method: "POST", body: data });
export const deleteSurveyQuestion = (questionId) => request(`/surveys/questions/${questionId}`, { method: "DELETE" });
export const submitSurveyResponse = (surveyId, data) => request(`/surveys/${surveyId}/responses`, { method: "POST", body: data });
export const getSurveyResults = (surveyId) => request(`/surveys/${surveyId}/results`);

// ---------- Conversation Intelligence ----------
export const processConversation = (agentId, customerText, conversationHistory, callId) =>
  request("/conversation/process", { method: "POST", body: { agentId, customerText, conversationHistory, callId } });
export const getConversationSession = (sessionId) => request(`/conversation/sessions/${sessionId}`);
export const getCallConversationSession = (callId) => request(`/conversation/calls/${callId}/session`);

// ---------- Agent Steering / Objective Config ----------
export const getAgentSteering = (agentId) => request(`/agent-steering/${agentId}`);
export const updateAgentSteering = (agentId, data) => request(`/agent-steering/${agentId}`, { method: "PUT", body: data });
```

## 5. Add the new frontend routes

Open `src/App.jsx`. Add these imports near your other page imports:

```js
import Surveys from "./pages/Surveys.jsx";
import SurveyDetail from "./pages/SurveyDetail.jsx";
import AgentSteering from "./pages/ai-engine/AgentSteering.jsx";
import ConversationTestPanel from "./pages/ai-engine/ConversationTestPanel.jsx";
```

Add these routes inside your existing `<Route element={<ProtectedRoute>...}>` block,
anywhere alongside your other `/ai-engine/agents/...` routes:

```jsx
<Route path="/surveys" element={<Surveys />} />
<Route path="/surveys/:id" element={<SurveyDetail />} />
<Route path="/ai-engine/agents/:id/steering" element={<AgentSteering />} />
<Route path="/ai-engine/agents/:id/test" element={<ConversationTestPanel />} />
```

## 6. Add a sidebar link (optional but recommended)

Open `src/components/Sidebar.jsx`. Add a Surveys entry to your `NAV` array,
e.g. right after Knowledge Base:

```js
{ to: "/surveys", label: "Surveys", icon: "📋" },
```

## 7. Link into it from your existing Agent Detail page (optional)

To make the new Steering config and Testing Playground reachable from the UI,
open `src/pages/ai-engine/AgentDetail.jsx` and add these two links wherever
convenient (e.g. near the top of the page, next to the agent name):

```jsx
<Link to={`/ai-engine/agents/${id}/steering`} className="btn btn-sm">Conversation Settings</Link>
<Link to={`/ai-engine/agents/${id}/test`} className="btn btn-sm">Test Playground</Link>
```

(Make sure `Link` is already imported from `react-router-dom` in that file —
it should be, since it's used elsewhere on the page already.)

## 8. Commit, push, redeploy

```bash
git add .
git commit -m "Add conversation intelligence engine, survey engine, agent steering config"
git push
```

Render redeploys automatically.

---

## What this patch gives you

- **`POST /api/conversation/process`** — the real orchestration endpoint from
  the spec: classifies every customer utterance (relevance / sentiment /
  entities), decides next_action, tracks objective progress, retrieves from
  your knowledge base, and generates a response — all logged to
  `conversation_sessions` / `conversation_events` as structured data, not
  just a transcript line.
- **Survey Engine** — build multi-question surveys with types (rating,
  yes/no, multiple choice, free text), record responses, see per-question
  results (avg score, sentiment split).
- **Agent Steering config UI** — set primary objective, allowed/restricted
  topics, off-topic handling strategy, knowledge-only mode, confidence
  threshold.
- **Conversation Testing Playground** — type test messages, see the full
  intelligence breakdown live (relevance, sentiment, confidence, next
  action, objective progress, extracted entities).

## Honest limitations of this patch

- **`relevanceEngine.js` is a keyword-heuristic classifier, not a real NLU
  model.** It's clearly commented as such in the file. It's good enough to
  wire and test the full pipeline shape, but for production-quality
  relevance/intent detection you'll want to replace `classify()` with a
  real LLM call once you connect a real `AI_PROVIDER` — the return shape is
  already fixed, so nothing else needs to change.
- **AI Insights (auto-mined complaint patterns across many calls) is not
  built** — the `ai_insights` table exists (from the migration) ready to
  receive data, but the mining logic needs a real LLM doing batch analysis
  over call transcripts, which isn't meaningful to fake.
- **Multi-tenant organizations** are still not implemented — as discussed,
  that's a dedicated migration of its own against your live data, not
  something to bolt on inside this patch.
- **CSV/Excel/PDF report export** is not built yet.
