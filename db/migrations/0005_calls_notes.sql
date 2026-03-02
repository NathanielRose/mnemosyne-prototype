-- Add free-form notes for manually annotated call context.
ALTER TABLE "calls"
  ADD COLUMN IF NOT EXISTS "notes" text;
