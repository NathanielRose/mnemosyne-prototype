import "dotenv/config";
import { Client } from "pg";

type CallOutcome = "Booked" | "Needs follow-up" | "No answer" | "Inquiry";
type CallPriority = "Low" | "Medium" | "High";
type CallLanguage = "Greek" | "English";

type ReservationDraft = {
  guestName: string;
  phone: string;
  email: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  roomType: "Single" | "Double" | "Triple" | "Suite";
  rateType: "Standard" | "Non-refundable" | "Half-board";
  notes: string;
  status: "Draft" | "Pending confirmation" | "Confirmed";
};

type CallSeed = {
  id: string;
  when: string;
  iso: string;
  from: string;
  durationSec: number;
  language: CallLanguage;
  outcome: CallOutcome;
  priority: CallPriority;
  summary: string;
  transcriptPreview: string;
  extracted?: Partial<ReservationDraft>;
  requiresAction: boolean;
  tag?: string;
  rateEUR?: number;
};

const mockCalls: CallSeed[] = [
  {
    id: "CA_001",
    when: "Today 09:12",
    iso: "2026-01-28T09:12:00",
    from: "+30 694 123 4567",
    durationSec: 318,
    language: "Greek",
    outcome: "Needs follow-up",
    priority: "High",
    summary:
      "Couple requesting Double room, Feb 3–6. Asked about parking + late check-in. Wants email confirmation.",
    transcriptPreview:
      "...θέλουμε ένα δίκλινο από 3 έως 6 Φεβρουαρίου... υπάρχει πάρκινγκ;...",
    extracted: {
      guestName: "(unknown)",
      checkIn: "2026-02-03",
      checkOut: "2026-02-06",
      adults: 2,
      children: 0,
      roomType: "Double",
      rateType: "Standard",
      status: "Draft",
      notes: "Asked about parking + late check-in. Send confirmation email.",
    },
    requiresAction: true,
  },
  {
    id: "CA_002",
    when: "Today 08:04",
    iso: "2026-01-28T08:04:00",
    from: "+44 7700 900 123",
    durationSec: 142,
    language: "English",
    outcome: "Inquiry",
    priority: "Medium",
    summary: "Asked about restaurant hours and whether vegetarian options are available.",
    transcriptPreview: "...what time does the restaurant open... vegetarian options...",
    requiresAction: false,
  },
  {
    id: "CA_003",
    when: "Yesterday 19:31",
    iso: "2026-01-27T19:31:00",
    from: "+30 210 555 0101",
    durationSec: 401,
    language: "Greek",
    outcome: "Booked",
    priority: "Low",
    rateEUR: 180,
    summary: "Confirmed Triple room, Jan 30–Feb 1. €180/night. Payment on arrival.",
    transcriptPreview:
      "...κλείνουμε τρίκλινο... από 30 Ιανουαρίου μέχρι 1 Φεβρουαρίου...",
    requiresAction: false,
  },
  {
    id: "CA_004",
    when: "Yesterday 14:09",
    iso: "2026-01-27T14:09:00",
    from: "+1 424 245 5769",
    durationSec: 56,
    language: "English",
    outcome: "No answer",
    priority: "Low",
    summary: "Missed call. No voicemail.",
    transcriptPreview: "(no transcript)",
    requiresAction: true,
  },
  {
    id: "CA_005",
    when: "Mon 12:22",
    iso: "2026-01-26T12:22:00",
    from: "+30 697 222 9911",
    durationSec: 233,
    language: "Greek",
    outcome: "Inquiry",
    priority: "Medium",
    summary:
      "Family asking for Suite availability Mar 10–14. Wants price and breakfast details.",
    transcriptPreview: "...σουίτα... 10 έως 14 Μαρτίου... τιμή με πρωινό;...",
    requiresAction: false,
  },
  {
    id: "CA_006",
    tag: "Wedding",
    when: "Sun 10:55",
    iso: "2026-01-25T10:55:00",
    from: "+49 1512 3456789",
    durationSec: 188,
    language: "English",
    outcome: "Booked",
    priority: "Low",
    rateEUR: 220,
    summary:
      "Booked Double room, Feb 14–16. €220/night. Confirmed breakfast included.",
    transcriptPreview: "...we'd like to book a double from Feb 14 to Feb 16...",
    requiresAction: false,
  },
];

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed the database.");
}

const client = new Client({ connectionString });

const snippet = (value: string, max = 240) => {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
};

const upsertCallSql = `
  INSERT INTO calls (
    external_id,
    started_at,
    from_number,
    duration_sec,
    language,
    outcome,
    priority,
    summary,
    transcript_preview,
    requires_action,
    tag,
    rate_eur
  )
  VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
  )
  ON CONFLICT (external_id) DO UPDATE SET
    started_at = EXCLUDED.started_at,
    from_number = EXCLUDED.from_number,
    duration_sec = EXCLUDED.duration_sec,
    language = EXCLUDED.language,
    outcome = EXCLUDED.outcome,
    priority = EXCLUDED.priority,
    summary = EXCLUDED.summary,
    transcript_preview = EXCLUDED.transcript_preview,
    requires_action = EXCLUDED.requires_action,
    tag = EXCLUDED.tag,
    rate_eur = EXCLUDED.rate_eur,
    updated_at = now()
  RETURNING id
`;

const upsertRecordingSql = `
  INSERT INTO recordings (call_id, provider, recording_sid, duration_sec, status, url)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (call_id) DO UPDATE SET
    provider = EXCLUDED.provider,
    recording_sid = EXCLUDED.recording_sid,
    duration_sec = EXCLUDED.duration_sec,
    status = EXCLUDED.status,
    url = EXCLUDED.url
`;

const upsertTranscriptSql = `
  INSERT INTO transcripts (call_id, language, content)
  VALUES ($1, $2, $3)
  ON CONFLICT (call_id) DO UPDATE SET
    language = EXCLUDED.language,
    content = EXCLUDED.content
`;

const upsertExtractionSql = `
  INSERT INTO extractions (call_id, source, data)
  VALUES ($1, $2, $3)
  ON CONFLICT (call_id) DO UPDATE SET
    source = EXCLUDED.source,
    data = EXCLUDED.data
`;

const insertNotificationSql = `
  INSERT INTO notifications (call_id, type, status, message)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (call_id, type) DO NOTHING
`;

async function seed() {
  await client.connect();

  for (const call of mockCalls) {
    const fullTranscript = call.transcriptPreview;
    const preview = snippet(fullTranscript);

    const result = await client.query(upsertCallSql, [
      call.id,
      call.iso,
      call.from,
      call.durationSec,
      call.language,
      call.outcome,
      call.priority,
      call.summary,
      preview,
      call.requiresAction,
      call.tag ?? null,
      call.rateEUR ?? null,
    ]);

    const callId = result.rows[0].id as string;

    await client.query(upsertRecordingSql, [
      callId,
      "twilio",
      null,
      call.durationSec,
      "pending",
      null,
    ]);

    await client.query(upsertTranscriptSql, [
      callId,
      call.language,
      fullTranscript,
    ]);

    if (call.extracted) {
      await client.query(upsertExtractionSql, [callId, "llm", call.extracted]);
    }

    if (call.requiresAction) {
      await client.query(insertNotificationSql, [
        callId,
        "action_required",
        "unread",
        `Call ${call.id} requires follow-up`,
      ]);
    }
  }

  await client.end();
}

seed().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
