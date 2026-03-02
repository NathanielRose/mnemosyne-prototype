-- Canonical caller naming fields for AI/user confirmation flow.
ALTER TABLE "calls"
  ADD COLUMN IF NOT EXISTS "caller_name" text,
  ADD COLUMN IF NOT EXISTS "caller_name_source" text;

-- Suggested tables already use a flexible text "state" column.
-- We explicitly support values like: suggested | confirmed | dismissed.
