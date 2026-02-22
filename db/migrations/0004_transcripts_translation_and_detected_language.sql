-- Store detected language and English translation alongside original transcript.

ALTER TABLE "calls"
  ADD COLUMN IF NOT EXISTS "detected_language" text;

ALTER TABLE "transcripts"
  ADD COLUMN IF NOT EXISTS "detected_language" text,
  ADD COLUMN IF NOT EXISTS "content_en" text,
  ADD COLUMN IF NOT EXISTS "raw_json_en" jsonb;

