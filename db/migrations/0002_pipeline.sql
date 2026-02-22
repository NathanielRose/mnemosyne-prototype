-- Worker pipeline tables + call/recording/transcript extensions

-- 1) Extend existing tables
ALTER TABLE "calls"
  ADD COLUMN IF NOT EXISTS "to_number" text,
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS "error" text;

ALTER TABLE "recordings"
  ADD COLUMN IF NOT EXISTS "local_path" text,
  ADD COLUMN IF NOT EXISTS "downloaded_at" timestamptz;

ALTER TABLE "transcripts"
  ADD COLUMN IF NOT EXISTS "raw_json" jsonb;

-- One transcript per recording (when recording_id present)
CREATE UNIQUE INDEX IF NOT EXISTS "transcripts_recording_id_unique"
  ON "transcripts" ("recording_id")
  WHERE "recording_id" IS NOT NULL;

-- 2) New tables
CREATE TABLE IF NOT EXISTS "insights" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "recording_id" uuid NOT NULL REFERENCES "recordings" ("id") ON DELETE CASCADE,
  "data" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "insights_recording_id_unique"
  ON "insights" ("recording_id");

CREATE TABLE IF NOT EXISTS "pipeline_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "recording_sid" text NOT NULL,
  "job_id" text,
  "status" text NOT NULL DEFAULT 'started',
  "attempt" integer NOT NULL DEFAULT 1,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_runs_recording_job_unique"
  ON "pipeline_runs" ("recording_sid", "job_id");

CREATE TABLE IF NOT EXISTS "pipeline_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "pipeline_runs" ("id") ON DELETE CASCADE,
  "step" text NOT NULL,
  "status" text NOT NULL DEFAULT 'started',
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz,
  "meta" jsonb,
  "error" text
);

CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_steps_run_step_unique"
  ON "pipeline_steps" ("run_id", "step");

