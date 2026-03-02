-- LLM post-transcription analysis (suggested-only state).

ALTER TABLE "calls"
  ADD COLUMN IF NOT EXISTS "analysis_status" text,
  ADD COLUMN IF NOT EXISTS "analysis_reason" text,
  ADD COLUMN IF NOT EXISTS "analysis_model" text,
  ADD COLUMN IF NOT EXISTS "analysis_ran_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "analysis_threshold_sec" integer,
  ADD COLUMN IF NOT EXISTS "summary_suggested_short" text,
  ADD COLUMN IF NOT EXISTS "summary_suggested_detailed" text,
  ADD COLUMN IF NOT EXISTS "transcript_hash" text,
  ADD COLUMN IF NOT EXISTS "analysis_raw_output" text,
  ADD COLUMN IF NOT EXISTS "analysis_quality_reliability" text,
  ADD COLUMN IF NOT EXISTS "analysis_quality_hallucination_risk" text,
  ADD COLUMN IF NOT EXISTS "analysis_quality_notes" text;

CREATE TABLE IF NOT EXISTS "call_tasks_suggested" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "call_id" uuid NOT NULL REFERENCES "calls" ("id") ON DELETE CASCADE,
  "state" text NOT NULL DEFAULT 'suggested',
  "title" text NOT NULL,
  "description" text NOT NULL,
  "assignee_suggestion" text,
  "due_at" timestamptz,
  "priority" text NOT NULL DEFAULT 'medium',
  "status" text NOT NULL DEFAULT 'todo',
  "evidence_quotes" jsonb NOT NULL,
  "confidence" numeric(4,3) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "call_tasks_suggested_call_id_idx"
  ON "call_tasks_suggested" ("call_id");

CREATE TABLE IF NOT EXISTS "call_tags_suggested" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "call_id" uuid NOT NULL REFERENCES "calls" ("id") ON DELETE CASCADE,
  "state" text NOT NULL DEFAULT 'suggested',
  "tag" text NOT NULL,
  "confidence" numeric(4,3) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "call_tags_suggested_call_id_idx"
  ON "call_tags_suggested" ("call_id");

CREATE TABLE IF NOT EXISTS "call_participants_suggested" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "call_id" uuid NOT NULL REFERENCES "calls" ("id") ON DELETE CASCADE,
  "state" text NOT NULL DEFAULT 'suggested',
  "name" text,
  "role" text NOT NULL,
  "evidence_quotes" jsonb NOT NULL,
  "confidence" numeric(4,3) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "call_participants_suggested_call_id_idx"
  ON "call_participants_suggested" ("call_id");
