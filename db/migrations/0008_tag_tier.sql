-- Two-tier tag model.
--   tier='top'    -> top-level category chips shown in feed/timeline.
--                    Closed vocab: Reservations | Special Requests | Inquiries | Miscellaneous.
--   tier='detail' -> free-form tags shown only in the call detail panel.
ALTER TABLE "call_tags_suggested"
  ADD COLUMN IF NOT EXISTS "tier" text NOT NULL DEFAULT 'detail';

-- Existing rows predate the detail tier and all use the 4-category enum,
-- so backfill to 'top'.
UPDATE "call_tags_suggested"
   SET tier = 'top'
 WHERE tier = 'detail'
   AND tag IN ('Reservations', 'Special Requests', 'Inquiries', 'Miscellaneous');
