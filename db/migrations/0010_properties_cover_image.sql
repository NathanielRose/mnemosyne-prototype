-- 0010: Per-property cover image URL used by the dashboard header banner.
-- Served from the web app's public/ folder today; will be swapped for blob
-- storage URLs later without schema changes.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT;

-- Backfill default local URLs for the seeded Arxontiko properties. Idempotent:
-- only sets the value when no URL has been stored yet.
UPDATE properties p
   SET cover_image_url = '/properties/arxontiko-hotel.jpg'
  FROM organizations o
 WHERE p.organization_id = o.id
   AND o.name = 'Arxontiko'
   AND p.position = 0
   AND p.cover_image_url IS NULL;

UPDATE properties p
   SET cover_image_url = '/properties/aesthesis-arxontiko.jpg'
  FROM organizations o
 WHERE p.organization_id = o.id
   AND o.name = 'Arxontiko'
   AND p.position = 1
   AND p.cover_image_url IS NULL;
