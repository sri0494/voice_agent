-- =========================================================
-- LeoMox Migration 002 — Customers, Business Integrations
-- (REST API connectors with encrypted credentials + tool
-- mapping), Phone Numbers.
--
-- Run this AFTER db/schema.sql (or in the SQL Editor on an
-- already-live database — safe to re-run, uses IF NOT EXISTS
-- and never drops existing data/tables).
-- =========================================================

-- =========================================================
-- CUSTOMERS
-- People with an established business relationship, distinct
-- from `contacts` (public/campaign contacts — see section below).
-- =========================================================
CREATE TABLE IF NOT EXISTS customers (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name              TEXT NOT NULL,
  last_name               TEXT,
  mobile                  TEXT NOT NULL,
  alternate_mobile        TEXT,
  email                   TEXT,
  customer_code           TEXT,                 -- external/business "Customer ID"
  address                 TEXT,
  city                    TEXT,
  state                   TEXT,
  country                 TEXT DEFAULT 'India',
  pin_code                TEXT,
  customer_type           TEXT,
  company_name            TEXT,
  customer_category       TEXT,
  assigned_agent_id       UUID REFERENCES agents(id) ON DELETE SET NULL,
  status                  TEXT NOT NULL DEFAULT 'Active'
                            CHECK (status IN ('Active','Inactive','Lead','Blocked','Do Not Call')),
  date_of_birth           DATE,
  preferred_language      TEXT DEFAULT 'English',
  communication_preference TEXT,
  notes                   TEXT,
  tags                    TEXT[] DEFAULT '{}',
  source_contact_id       UUID,                 -- set when converted from a public contact
  created_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers(mobile);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);

-- Extend `contacts` (the existing "Public Contacts" table) with the
-- richer fields this spec asks for, without breaking existing rows.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'India';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS contact_type TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'Manual Entry'
  CHECK (source IN ('Manual Entry','Excel/CSV Import','Website','API','CRM','Campaign','Registration Form','Advertisement','Other Integration'));
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS converted_to_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
-- campaign_id was NOT NULL-by-convention before but nullable in schema; public contacts
-- not tied to any campaign (e.g. general marketing lists) are now explicitly supported.
ALTER TABLE contacts ALTER COLUMN campaign_id DROP NOT NULL;

-- =========================================================
-- BUSINESS INTEGRATIONS (REST API / CRM / ERP / Payment / Calendar / Helpdesk connectors)
-- Distinct from the core infra providers (AI/STT/TTS/Telephony,
-- which stay env-var-configured for security). These are
-- business-system connectors an admin sets up through the UI,
-- so credentials are encrypted at rest with the server's
-- ENCRYPTION_KEY (AES-256-GCM) — never stored or displayed in plaintext.
-- =========================================================
CREATE TABLE IF NOT EXISTS business_integrations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  category          TEXT NOT NULL CHECK (category IN
                      ('CRM','Database','E-commerce','Communication','Payment','Calendar','Helpdesk','Custom API')),
  base_url          TEXT,
  auth_type         TEXT NOT NULL DEFAULT 'NONE'
                      CHECK (auth_type IN ('API_KEY','BEARER_TOKEN','OAUTH2','BASIC_AUTH','NONE')),
  -- Encrypted JSON blob: { apiKey, username, password, token, headers, ... }
  -- Encrypted server-side before insert, decrypted only in-memory when a
  -- function call needs to authenticate against the external API.
  encrypted_credentials TEXT,
  headers           JSONB NOT NULL DEFAULT '{}',   -- non-secret static headers only
  timeout_ms        INTEGER NOT NULL DEFAULT 10000,
  environment       TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('production','sandbox')),
  status            TEXT NOT NULL DEFAULT 'DISCONNECTED' CHECK (status IN ('CONNECTED','DISCONNECTED','ERROR')),
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_integrations_category ON business_integrations(category);

-- Function/tool definitions exposed by an integration (e.g. get_customer, check_stock).
CREATE TABLE IF NOT EXISTS integration_functions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id      UUID NOT NULL REFERENCES business_integrations(id) ON DELETE CASCADE,
  function_name       TEXT NOT NULL,             -- e.g. "get_customer" — must be a valid identifier
  description         TEXT NOT NULL,             -- shown to the LLM as the tool description
  http_method         TEXT NOT NULL DEFAULT 'GET' CHECK (http_method IN ('GET','POST','PUT','PATCH','DELETE')),
  path_template        TEXT NOT NULL,             -- e.g. "/customers/{mobile}"
  input_schema        JSONB NOT NULL DEFAULT '{}', -- JSON-schema-like description of parameters
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (integration_id, function_name)
);
CREATE INDEX IF NOT EXISTS idx_integration_functions_integration ON integration_functions(integration_id);

-- Which functions a given AI agent is allowed to call (explicit allow-list —
-- an agent only ever has access to functions assigned here).
CREATE TABLE IF NOT EXISTS agent_integration_functions (
  agent_id              UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  integration_function_id UUID NOT NULL REFERENCES integration_functions(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, integration_function_id)
);

-- =========================================================
-- PHONE NUMBERS
-- =========================================================
CREATE TABLE IF NOT EXISTS phone_numbers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number            TEXT NOT NULL UNIQUE,
  provider          TEXT,                      -- e.g. "exotel", "knowlarity" — informational; real routing uses TELEPHONY_PROVIDER env var
  agent_id          UUID REFERENCES agents(id) ON DELETE SET NULL,
  inbound_enabled   BOOLEAN NOT NULL DEFAULT true,
  outbound_enabled  BOOLEAN NOT NULL DEFAULT true,
  business_hours    JSONB NOT NULL DEFAULT '{"start":"09:00","end":"19:00","days":["MON","TUE","WED","THU","FRI"]}',
  recording_enabled BOOLEAN NOT NULL DEFAULT true,
  voicemail_enabled BOOLEAN NOT NULL DEFAULT false,
  status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_phone_numbers_agent ON phone_numbers(agent_id);

-- =========================================================
-- CALLS: link to customers, richer summary fields
-- =========================================================
ALTER TABLE calls ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS phone_number_id UUID REFERENCES phone_numbers(id) ON DELETE SET NULL;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_summary TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS follow_up_required BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_calls_customer ON calls(customer_id);

-- =========================================================
-- AI Agent: agent_type field (spec section 8)
-- =========================================================
ALTER TABLE agents ADD COLUMN IF NOT EXISTS agent_type TEXT DEFAULT 'Custom Agent'
  CHECK (agent_type IN ('Customer Support Agent','Sales Agent','Appointment Agent','Survey Agent','Collection Agent','Custom Agent'));
ALTER TABLE agents ADD COLUMN IF NOT EXISTS business_name TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS personality TEXT;
