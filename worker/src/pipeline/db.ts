import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Minimal table definitions needed by the worker pipeline.
// These map to the canonical DB schema in `/db/schema.ts` + migrations.

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    externalId: text("external_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    fromNumber: text("from_number").notNull(),
    toNumber: text("to_number"),
    durationSec: integer("duration_sec").notNull(),
    language: text("language").notNull(),
    detectedLanguage: text("detected_language"),
    outcome: text("outcome").notNull(),
    priority: text("priority").notNull(),
    summary: text("summary").notNull(),
    transcriptPreview: text("transcript_preview"),
    status: text("status").notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    externalIdUnique: uniqueIndex("calls_external_id_unique").on(t.externalId),
  })
);

export const recordings = pgTable(
  "recordings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    callId: uuid("call_id").notNull(),
    provider: text("provider").notNull(),
    recordingSid: text("recording_sid"),
    durationSec: integer("duration_sec"),
    status: text("status").notNull(),
    url: text("url"),
    localPath: text("local_path"),
    downloadedAt: timestamp("downloaded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    callIdUnique: uniqueIndex("recordings_call_id_unique").on(t.callId),
    recordingSidUnique: uniqueIndex("recordings_recording_sid_unique").on(t.recordingSid),
  })
);

export const transcripts = pgTable(
  "transcripts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    callId: uuid("call_id").notNull(),
    recordingId: uuid("recording_id"),
    language: text("language").notNull(),
    detectedLanguage: text("detected_language"),
    content: text("content").notNull(),
    contentEn: text("content_en"),
    rawJson: jsonb("raw_json"),
    rawJsonEn: jsonb("raw_json_en"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    callIdUnique: uniqueIndex("transcripts_call_id_unique").on(t.callId),
    recordingIdUnique: uniqueIndex("transcripts_recording_id_unique").on(t.recordingId),
  })
);

export const insights = pgTable(
  "insights",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recordingId: uuid("recording_id").notNull(),
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    recordingIdUnique: uniqueIndex("insights_recording_id_unique").on(t.recordingId),
  })
);

export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recordingSid: text("recording_sid").notNull(),
    jobId: text("job_id"),
    status: text("status").notNull(),
    attempt: integer("attempt").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    recordingJobUnique: uniqueIndex("pipeline_runs_recording_job_unique").on(t.recordingSid, t.jobId),
  })
);

export const pipelineSteps = pgTable(
  "pipeline_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id").notNull(),
    step: text("step").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    meta: jsonb("meta"),
    error: text("error"),
  },
  (t) => ({
    runStepUnique: uniqueIndex("pipeline_steps_run_step_unique").on(t.runId, t.step),
  })
);

let _pool: Pool | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for the worker pipeline.");
  _pool = new Pool({ connectionString: url });
  _db = drizzle(_pool);
  return _db;
}

export async function upsertCallAndRecording(payload: {
  callSid: string;
  recordingSid: string;
  recordingUrl?: string;
  fromNumber?: string;
  toNumber?: string;
  durationSec?: number;
  receivedAtIso?: string;
}) {
  const db = getDb();
  const now = payload.receivedAtIso ? new Date(payload.receivedAtIso) : new Date();

  const callRow = await db
    .insert(calls)
    .values({
      externalId: payload.callSid,
      startedAt: now,
      fromNumber: payload.fromNumber ?? "unknown",
      toNumber: payload.toNumber ?? null,
      durationSec: payload.durationSec ?? 0,
      language: "English",
      detectedLanguage: null,
      outcome: "Inquiry",
      priority: "Low",
      summary: "",
      status: "processing",
      error: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: calls.externalId,
      set: {
        status: "processing",
        error: null,
        updatedAt: now,
        fromNumber: payload.fromNumber ?? "unknown",
        toNumber: payload.toNumber ?? null,
        durationSec: payload.durationSec ?? 0,
      },
    })
    .returning({ id: calls.id });

  const callId = callRow[0]!.id;

  const recordingRow = await db
    .insert(recordings)
    .values({
      callId,
      provider: "twilio",
      recordingSid: payload.recordingSid,
      status: "ready",
      url: payload.recordingUrl ?? null,
      localPath: null,
      downloadedAt: null,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: recordings.recordingSid,
      set: {
        callId,
        status: "ready",
        url: payload.recordingUrl ?? null,
      },
    })
    .returning({ id: recordings.id });

  return { callId, recordingId: recordingRow[0]!.id };
}

export async function getRecordingBySid(recordingSid: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: recordings.id,
      callId: recordings.callId,
      recordingSid: recordings.recordingSid,
      url: recordings.url,
      localPath: recordings.localPath,
      downloadedAt: recordings.downloadedAt,
      status: recordings.status,
    })
    .from(recordings)
    .where(eq(recordings.recordingSid, recordingSid))
    .limit(1);
  return rows[0] ?? null;
}

export async function markRecordingDownloaded(params: {
  recordingId: string;
  localPath: string;
  downloadedAt: Date;
}) {
  const db = getDb();
  await db
    .update(recordings)
    .set({
      localPath: params.localPath,
      downloadedAt: params.downloadedAt,
      status: "ready",
    })
    .where(eq(recordings.id, params.recordingId));
}

export async function getTranscriptByRecordingId(recordingId: string) {
  const db = getDb();
  const rows = await db
    .select({ id: transcripts.id, content: transcripts.content })
    .from(transcripts)
    .where(eq(transcripts.recordingId, recordingId))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertTranscript(params: {
  callId: string;
  recordingId: string;
  content: string;
  language: string;
  detectedLanguage?: string;
  contentEn?: string;
  rawJson?: unknown;
  rawJsonEn?: unknown;
}) {
  const db = getDb();
  const now = new Date();

  // Avoid duplicates via UNIQUE indexes (call_id + recording_id). We use
  // `ON CONFLICT DO NOTHING` (no target) to avoid relying on index inference.
  const inserted = await db
    .insert(transcripts)
    .values({
      callId: params.callId,
      recordingId: params.recordingId,
      language: params.language,
      detectedLanguage: params.detectedLanguage ?? null,
      content: params.content,
      contentEn: params.contentEn ?? null,
      rawJson: (params.rawJson ?? null) as any,
      rawJsonEn: (params.rawJsonEn ?? null) as any,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: transcripts.id });

  if (inserted[0]?.id) return inserted[0].id;

  const existing = await getTranscriptByRecordingId(params.recordingId);
  return existing?.id ?? null;
}

export async function getInsightsByRecordingId(recordingId: string) {
  const db = getDb();
  const rows = await db
    .select({ id: insights.id })
    .from(insights)
    .where(eq(insights.recordingId, recordingId))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertInsights(params: { recordingId: string; data: unknown }) {
  const db = getDb();
  const now = new Date();

  const inserted = await db
    .insert(insights)
    .values({
      recordingId: params.recordingId,
      data: params.data as any,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: insights.id });

  if (inserted[0]?.id) return inserted[0].id;

  const existing = await getInsightsByRecordingId(params.recordingId);
  return existing?.id ?? null;
}

export async function markCompleted(params: { callId: string; recordingId: string }) {
  const db = getDb();
  const now = new Date();
  await db.update(calls).set({ status: "completed", error: null, updatedAt: now }).where(eq(calls.id, params.callId));
  await db.update(recordings).set({ status: "processed" }).where(eq(recordings.id, params.recordingId));
}

export async function markFailed(params: { callId: string; recordingId: string; error: string }) {
  const db = getDb();
  const now = new Date();
  await db.update(calls).set({ status: "failed", error: params.error, updatedAt: now }).where(eq(calls.id, params.callId));
  await db.update(recordings).set({ status: "failed" }).where(eq(recordings.id, params.recordingId));
}

export async function updateCallPostProcessing(params: {
  callId: string;
  detectedLanguage?: string;
  language?: string;
  transcriptText?: string;
  summary?: string;
}) {
  const db = getDb();
  const now = new Date();
  const preview =
    typeof params.transcriptText === "string" && params.transcriptText.trim().length > 0
      ? params.transcriptText.trim().slice(0, 280)
      : null;

  await db
    .update(calls)
    .set({
      transcriptPreview: preview,
      summary: params.summary ?? "",
      detectedLanguage: params.detectedLanguage ?? null,
      language: params.language ?? "English",
      updatedAt: now,
    })
    .where(eq(calls.id, params.callId));
}

export async function updateCallLanguageDetected(params: {
  callId: string;
  detectedLanguage?: string;
  language?: string;
}) {
  const db = getDb();
  const now = new Date();
  await db
    .update(calls)
    .set({
      detectedLanguage: params.detectedLanguage ?? null,
      language: params.language ?? "English",
      updatedAt: now,
    })
    .where(eq(calls.id, params.callId));
}

export async function recordingHasDownload(params: { recordingId: string }) {
  const db = getDb();
  const rows = await db
    .select({ localPath: recordings.localPath, downloadedAt: recordings.downloadedAt })
    .from(recordings)
    .where(eq(recordings.id, params.recordingId))
    .limit(1);
  const row = rows[0];
  return Boolean(row?.localPath && row?.downloadedAt);
}

export async function callByExternalId(callSid: string) {
  const db = getDb();
  const rows = await db
    .select({ id: calls.id, externalId: calls.externalId })
    .from(calls)
    .where(eq(calls.externalId, callSid))
    .limit(1);
  return rows[0] ?? null;
}

