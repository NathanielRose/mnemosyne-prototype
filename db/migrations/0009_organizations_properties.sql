-- 0009: Multi-tenant foundation — organizations and properties.
--
-- A single organization owns one or more properties (hotels). Each property
-- has its own phone number (the Twilio DID that routes to it); incoming calls
-- are attributed to a property by matching calls.to_number against
-- properties.phone_number.

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- 0-based index within the org; the first onboarded property is 0.
  position INTEGER NOT NULL,
  phone_number TEXT NOT NULL,
  address TEXT,
  website_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS properties_phone_number_unique
  ON properties(phone_number);
CREATE UNIQUE INDEX IF NOT EXISTS properties_org_position_unique
  ON properties(organization_id, position);

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id);

CREATE INDEX IF NOT EXISTS calls_property_id_idx ON calls(property_id);

-- Seed the Arxontiko organization.
INSERT INTO organizations (name)
  VALUES ('Arxontiko')
  ON CONFLICT (name) DO NOTHING;

-- Seed Arxontiko Hotel at position 0. Use the most common existing
-- calls.to_number as this property's phone_number so the backfill below
-- attributes pre-existing calls to it. Falls back to a placeholder if no
-- calls have been ingested yet.
INSERT INTO properties (organization_id, name, position, phone_number, address, website_url)
SELECT
  o.id,
  'Arxontiko Hotel — Αρχοντικό Ξενοδοχείο',
  0,
  COALESCE(
    (SELECT to_number
       FROM calls
      WHERE to_number IS NOT NULL
        AND length(btrim(to_number)) > 0
      GROUP BY to_number
      ORDER BY COUNT(*) DESC
      LIMIT 1),
    '+arxontiko-seed-placeholder'
  ),
  'Sachtouri & Filellinon, Myrina, Limnos 81400, Greece',
  'https://www.arxontikohotel.gr/en/experience-archontiko-english/'
  FROM organizations o
 WHERE o.name = 'Arxontiko'
   AND NOT EXISTS (
     SELECT 1 FROM properties p
      WHERE p.organization_id = o.id AND p.position = 0
   );

-- Seed Aesthesis Arxontiko at position 1. The phone number is a placeholder
-- that is guaranteed not to collide with any real to_number seen in calls, so
-- the backfill below does not wrongly attribute old Arxontiko calls here.
INSERT INTO properties (organization_id, name, position, phone_number, address, website_url)
SELECT
  o.id,
  'Aesthesis Arxontiko — Αίσθησις Αρχοντικό',
  1,
  '+aesthesis-arxontiko-seed-placeholder',
  'Αποστολου Καρατζά 19, Myrina, Limnos 81400, Greece',
  'https://www.instagram.com/arxontiko_aesthesis?igshid=YmMyMTA2M2Y%3D'
  FROM organizations o
 WHERE o.name = 'Arxontiko'
   AND NOT EXISTS (
     SELECT 1 FROM properties p
      WHERE p.organization_id = o.id AND p.position = 1
   );

-- Backfill existing calls → property_id by phone_number match.
UPDATE calls
   SET property_id = p.id
  FROM properties p
 WHERE calls.property_id IS NULL
   AND calls.to_number IS NOT NULL
   AND calls.to_number = p.phone_number;

-- Demo calls for Aesthesis Arxontiko so the two property timelines are
-- visibly different in the dashboard POC. Each gets a matching transcript
-- row so it clears the /calls "has transcript" filter.
DO $$
DECLARE
  aesthesis_id UUID;
  aesthesis_phone TEXT;
  c_id UUID;
BEGIN
  SELECT p.id, p.phone_number
    INTO aesthesis_id, aesthesis_phone
    FROM properties p
    JOIN organizations o ON o.id = p.organization_id
   WHERE o.name = 'Arxontiko' AND p.position = 1;

  IF aesthesis_id IS NULL THEN
    RETURN;
  END IF;

  -- Seed 1: Greek, booked.
  INSERT INTO calls (
    external_id, started_at, from_number, caller_name, to_number,
    duration_sec, language, outcome, priority,
    summary, transcript_preview, requires_action, status, property_id
  )
  VALUES (
    'seed-aesthesis-1', now() - INTERVAL '2 days', '+306980000001', 'Maria Papadopoulou', aesthesis_phone,
    125, 'Greek', 'Booked', 'Medium',
    'Booked a 2-night stay for Easter weekend, two adults.',
    'Γεια σας, θα ήθελα να κλείσω ένα δωμάτιο για το Πάσχα…',
    false, 'completed', aesthesis_id
  )
  ON CONFLICT (external_id) DO NOTHING
  RETURNING id INTO c_id;

  IF c_id IS NOT NULL THEN
    INSERT INTO transcripts (call_id, language, content, content_en)
    VALUES (
      c_id, 'Greek',
      'Γεια σας, θα ήθελα να κλείσω ένα δωμάτιο για δύο άτομα για το Πάσχα, από Παρασκευή έως Κυριακή.',
      'Hi, I''d like to book a room for two people over Easter weekend, Friday to Sunday.'
    )
    ON CONFLICT (call_id) DO NOTHING;
  END IF;

  -- Seed 2: English, inquiry.
  INSERT INTO calls (
    external_id, started_at, from_number, caller_name, to_number,
    duration_sec, language, outcome, priority,
    summary, transcript_preview, requires_action, status, property_id
  )
  VALUES (
    'seed-aesthesis-2', now() - INTERVAL '5 days', '+442071838750', 'James Whitfield', aesthesis_phone,
    87, 'English', 'Inquiry', 'Low',
    'Asked about breakfast options and nearby beaches.',
    'Hi, could you tell me what beaches are walkable from the property…',
    false, 'completed', aesthesis_id
  )
  ON CONFLICT (external_id) DO NOTHING
  RETURNING id INTO c_id;

  IF c_id IS NOT NULL THEN
    INSERT INTO transcripts (call_id, language, content, content_en)
    VALUES (
      c_id, 'English',
      'Hi, could you tell me what beaches are walkable from the property and whether breakfast is included in the rate?',
      'Hi, could you tell me what beaches are walkable from the property and whether breakfast is included in the rate?'
    )
    ON CONFLICT (call_id) DO NOTHING;
  END IF;

  -- Seed 3: Greek, needs follow-up (high priority, requires action).
  INSERT INTO calls (
    external_id, started_at, from_number, caller_name, to_number,
    duration_sec, language, outcome, priority,
    summary, transcript_preview, requires_action, status, property_id
  )
  VALUES (
    'seed-aesthesis-3', now() - INTERVAL '6 hours', '+306944444444', 'Eleni Vasiliou', aesthesis_phone,
    214, 'Greek', 'Needs follow-up', 'High',
    'Requests a baby crib and a gluten-free menu — awaiting confirmation.',
    'Γεια σας, χρειαζόμαστε μια κούνια για το μωρό…',
    true, 'completed', aesthesis_id
  )
  ON CONFLICT (external_id) DO NOTHING
  RETURNING id INTO c_id;

  IF c_id IS NOT NULL THEN
    INSERT INTO transcripts (call_id, language, content, content_en)
    VALUES (
      c_id, 'Greek',
      'Γεια σας, χρειαζόμαστε μια κούνια για το μωρό και ειδικό μενού χωρίς γλουτένη. Μπορείτε να μας επιβεβαιώσετε;',
      'Hello, we need a crib for the baby and a gluten-free menu. Can you confirm?'
    )
    ON CONFLICT (call_id) DO NOTHING;
  END IF;
END
$$;
