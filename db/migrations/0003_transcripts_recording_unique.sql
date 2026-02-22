-- Ensure ON CONFLICT(recording_id) works by adding a non-partial unique index.
-- Postgres UNIQUE indexes allow multiple NULLs, so no partial predicate is needed.

CREATE UNIQUE INDEX IF NOT EXISTS "transcripts_recording_id_unique_all"
  ON "transcripts" ("recording_id");

