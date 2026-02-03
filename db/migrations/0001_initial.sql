-- Initial schema for calls + related entities
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'call_outcome') THEN
    CREATE TYPE call_outcome AS ENUM ('Booked', 'Needs follow-up', 'No answer', 'Inquiry');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'call_priority') THEN
    CREATE TYPE call_priority AS ENUM ('Low', 'Medium', 'High');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'call_language') THEN
    CREATE TYPE call_language AS ENUM ('Greek', 'English');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
    CREATE TYPE notification_type AS ENUM ('action_required', 'info', 'warning');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_status') THEN
    CREATE TYPE notification_status AS ENUM ('unread', 'read', 'archived');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recording_status') THEN
    CREATE TYPE recording_status AS ENUM ('pending', 'ready', 'processed', 'failed');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  from_number TEXT NOT NULL,
  duration_sec INTEGER NOT NULL,
  language call_language NOT NULL,
  outcome call_outcome NOT NULL,
  priority call_priority NOT NULL,
  summary TEXT NOT NULL,
  transcript_preview TEXT,
  requires_action BOOLEAN NOT NULL DEFAULT FALSE,
  tag TEXT,
  rate_eur NUMERIC(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS calls_external_id_unique ON calls(external_id);

CREATE TABLE IF NOT EXISTS recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'twilio',
  recording_sid TEXT,
  duration_sec INTEGER,
  status recording_status NOT NULL DEFAULT 'pending',
  url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS recordings_call_id_unique ON recordings(call_id);
CREATE UNIQUE INDEX IF NOT EXISTS recordings_recording_sid_unique ON recordings(recording_sid);

CREATE TABLE IF NOT EXISTS transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  recording_id UUID REFERENCES recordings(id) ON DELETE SET NULL,
  language call_language NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS transcripts_call_id_unique ON transcripts(call_id);

CREATE TABLE IF NOT EXISTS extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'llm',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS extractions_call_id_unique ON extractions(call_id);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  status notification_status NOT NULL DEFAULT 'unread',
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_call_type_unique ON notifications(call_id, type);
