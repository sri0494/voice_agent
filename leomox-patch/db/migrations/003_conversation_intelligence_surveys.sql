-- =========================================================
-- LeoMox Migration 003 — Conversation Intelligence + Survey Engine
-- Additive only. Safe to run on your live database — never drops
-- existing tables/data. Run in Neon's SQL Editor.
-- =========================================================

-- =========================================================
-- AGENT STEERING / OBJECTIVE CONFIG (spec section 5, 8)
-- =========================================================
ALTER TABLE agents ADD COLUMN IF NOT EXISTS primary_objective TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS allowed_topics TEXT[] DEFAULT '{}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS restricted_topics TEXT[] DEFAULT '{}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS required_information TEXT[] DEFAULT '{}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS off_topic_strategy TEXT NOT NULL DEFAULT 'REDIRECT'
  CHECK (off_topic_strategy IN ('REDIRECT','BRIEF_ANSWER_THEN_REDIRECT','STRICT_KNOWLEDGE_ONLY'));
ALTER TABLE agents ADD COLUMN IF NOT EXISTS max_off_topic_turns INTEGER NOT NULL DEFAULT 2;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS knowledge_only_mode BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS confidence_threshold NUMERIC(3,2) NOT NULL DEFAULT 0.50;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS conversation_style TEXT DEFAULT 'Friendly and professional';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS extraction_fields JSONB NOT NULL DEFAULT '[]';
-- extraction_fields example: [{"key":"budget","label":"Budget","type":"number"},{"key":"product","label":"Product","type":"text"}]

-- Widen agent_type to cover the new verticals from this spec (old values still valid).
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_agent_type_check;
ALTER TABLE agents ADD CONSTRAINT agents_agent_type_check CHECK (agent_type IN
  ('Customer Support Agent','Sales Agent','Appointment Agent','Survey Agent','Collection Agent',
   'Customer Support','Sales','Appointment','Survey','Feedback','Public Perception','Retail','Hospital','Clinic','Custom Agent','Custom'));

-- =========================================================
-- CONVERSATION SESSIONS, MESSAGES, EVENTS
-- Per-turn intelligence output (intent/relevance/sentiment/entities),
-- distinct from the simpler call_messages table already in use for
-- plain transcript display — this stores the full analysis per turn.
-- =========================================================
CREATE TABLE IF NOT EXISTS conversation_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id             UUID REFERENCES calls(id) ON DELETE CASCADE,
  agent_id            UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  objective_progress  INTEGER NOT NULL DEFAULT 0 CHECK (objective_progress BETWEEN 0 AND 100),
  off_topic_turn_count INTEGER NOT NULL DEFAULT 0,
  extracted_data      JSONB NOT NULL DEFAULT '{}',
  status              TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','TRANSFERRED','ABANDONED')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_call ON conversation_sessions(call_id);

CREATE TABLE IF NOT EXISTS conversation_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
  sequence            INTEGER NOT NULL,
  speaker             TEXT NOT NULL CHECK (speaker IN ('AI','CUSTOMER')),
  raw_text            TEXT NOT NULL,
  relevance           TEXT CHECK (relevance IN
                        ('BUSINESS_RELEVANT','PARTIALLY_RELEVANT','INFORMATION_REQUEST','FEEDBACK',
                         'SURVEY_RESPONSE','CLARIFICATION','OFF_TOPIC','UNSAFE','UNKNOWN', NULL)),
  intent              TEXT,
  topic               TEXT,
  sentiment           TEXT CHECK (sentiment IN ('Positive','Negative','Neutral','Mixed', NULL)),
  entities            JSONB DEFAULT '{}',
  confidence          NUMERIC(4,3),
  next_action         TEXT CHECK (next_action IN
                        ('continue','ask_clarification','redirect','transfer','end_call','collect_information','complete_survey', NULL)),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversation_events_session ON conversation_events(session_id);

-- =========================================================
-- SURVEY ENGINE
-- =========================================================
CREATE TABLE IF NOT EXISTS surveys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT,
  agent_id      UUID REFERENCES agents(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Active','Closed')),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS survey_questions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id         UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  sequence          INTEGER NOT NULL,
  question_text     TEXT NOT NULL,
  question_type     TEXT NOT NULL CHECK (question_type IN
                      ('Yes/No','Rating 1-5','Rating 1-10','Multiple Choice','Single Choice',
                       'Free Text','Voice Response','Numeric','Date','Location','Custom')),
  options           JSONB DEFAULT '[]',          -- for Multiple/Single Choice
  condition_rule    JSONB DEFAULT NULL,           -- e.g. {"if_question_id": "...", "equals": "No"} for branching
  required          BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_survey_questions_survey ON survey_questions(survey_id);

CREATE TABLE IF NOT EXISTS survey_responses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id         UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  question_id       UUID NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
  call_id           UUID REFERENCES calls(id) ON DELETE SET NULL,
  contact_id        UUID REFERENCES contacts(id) ON DELETE SET NULL,
  customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  answer_text       TEXT,
  answer_numeric    NUMERIC,
  sentiment         TEXT CHECK (sentiment IN ('Positive','Negative','Neutral', NULL)),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_survey_responses_survey ON survey_responses(survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_question ON survey_responses(question_id);

-- =========================================================
-- AI INSIGHTS (data layer only — mining logic requires a real LLM,
-- see conversationOrchestrator.js notes; this table is ready to receive
-- insights once that's wired up)
-- =========================================================
CREATE TABLE IF NOT EXISTS ai_insights (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL,
  category        TEXT,                -- e.g. "Operational Issue", "Product Issue"
  description     TEXT,
  detected_in_pct NUMERIC(5,2),
  sentiment_lean  TEXT,
  suggested_action TEXT,
  source_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  period_start    TIMESTAMPTZ,
  period_end      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
