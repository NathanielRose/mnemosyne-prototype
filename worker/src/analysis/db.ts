import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { jsonb, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import type { AnalysisOutput } from "./schema.js";

const calls = pgTable("calls", {
  id: uuid("id").defaultRandom().primaryKey(),
  externalId: text("external_id").notNull(),
  fromNumber: text("from_number").notNull(),
  toNumber: text("to_number"),
  durationSec: integer("duration_sec").notNull(),
  status: text("status").notNull(),
  analysisStatus: text("analysis_status"),
  analysisReason: text("analysis_reason"),
  analysisModel: text("analysis_model"),
  analysisRanAt: timestamp("analysis_ran_at", { withTimezone: true }),
  analysisThresholdSec: integer("analysis_threshold_sec"),
  summarySuggestedShort: text("summary_suggested_short"),
  summarySuggestedDetailed: text("summary_suggested_detailed"),
  transcriptHash: text("transcript_hash"),
  analysisRawOutput: text("analysis_raw_output"),
  analysisQualityReliability: text("analysis_quality_reliability"),
  analysisQualityHallucinationRisk: text("analysis_quality_hallucination_risk"),
  analysisQualityNotes: text("analysis_quality_notes"),
  tag: text("tag"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

const transcripts = pgTable("transcripts", {
  id: uuid("id").defaultRandom().primaryKey(),
  callId: uuid("call_id").notNull(),
  content: text("content").notNull(),
  contentEn: text("content_en"),
});

const callTasksSuggested = pgTable("call_tasks_suggested", {
  id: uuid("id").defaultRandom().primaryKey(),
  callId: uuid("call_id").notNull(),
  state: text("state").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  assigneeSuggestion: text("assignee_suggestion"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  priority: text("priority").notNull(),
  status: text("status").notNull(),
  evidenceQuotes: jsonb("evidence_quotes").notNull(),
  confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

const callTagsSuggested = pgTable("call_tags_suggested", {
  id: uuid("id").defaultRandom().primaryKey(),
  callId: uuid("call_id").notNull(),
  state: text("state").notNull(),
  tag: text("tag").notNull(),
  confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

const callParticipantsSuggested = pgTable("call_participants_suggested", {
  id: uuid("id").defaultRandom().primaryKey(),
  callId: uuid("call_id").notNull(),
  state: text("state").notNull(),
  name: text("name"),
  role: text("role").notNull(),
  evidenceQuotes: jsonb("evidence_quotes").notNull(),
  confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

let _pool: Pool | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

function getDb() {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for analysis worker.");
  _pool = new Pool({ connectionString: url });
  _db = drizzle(_pool);
  return _db;
}

export type AnalysisContext = {
  callId: string;
  callSid: string;
  fromNumber: string;
  toNumber: string | null;
  durationSec: number;
  callStatus: string;
  analysisStatus: string | null;
  transcriptHash: string | null;
  transcriptOriginal: string;
  transcriptUserLang: string;
};

export async function getAnalysisContextByCallSid(callSid: string): Promise<AnalysisContext | null> {
  const db = getDb();
  const rows = await db
    .select({
      callId: calls.id,
      callSid: calls.externalId,
      fromNumber: calls.fromNumber,
      toNumber: calls.toNumber,
      durationSec: calls.durationSec,
      callStatus: calls.status,
      analysisStatus: calls.analysisStatus,
      transcriptHash: calls.transcriptHash,
      transcriptOriginal: transcripts.content,
      transcriptUserLang: transcripts.contentEn,
    })
    .from(calls)
    .leftJoin(transcripts, eq(transcripts.callId, calls.id))
    .where(eq(calls.externalId, callSid))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    callId: row.callId,
    callSid: row.callSid,
    fromNumber: row.fromNumber,
    toNumber: row.toNumber ?? null,
    durationSec: row.durationSec ?? 0,
    callStatus: row.callStatus,
    analysisStatus: row.analysisStatus ?? null,
    transcriptHash: row.transcriptHash ?? null,
    transcriptOriginal: row.transcriptOriginal ?? "",
    transcriptUserLang: row.transcriptUserLang ?? "",
  };
}

export async function markAnalysisQueued(params: { callSid: string; thresholdSec: number }) {
  const db = getDb();
  await db
    .update(calls)
    .set({
      analysisStatus: "queued",
      analysisReason: null,
      analysisThresholdSec: params.thresholdSec,
      analysisModel: process.env.OPENAI_ANALYSIS_MODEL ?? "gpt-4o-mini",
      updatedAt: new Date(),
    })
    .where(eq(calls.externalId, params.callSid));
}

export async function markAnalysisRunning(params: { callId: string; thresholdSec: number }) {
  const db = getDb();
  await db
    .update(calls)
    .set({
      analysisStatus: "running",
      analysisReason: null,
      analysisThresholdSec: params.thresholdSec,
      analysisModel: process.env.OPENAI_ANALYSIS_MODEL ?? "gpt-4o-mini",
      updatedAt: new Date(),
    })
    .where(eq(calls.id, params.callId));
}

export async function markAnalysisSkipped(params: {
  callId: string;
  reason: "duration_below_threshold" | "transcript_too_short";
  thresholdSec: number;
}) {
  const db = getDb();
  await db
    .update(calls)
    .set({
      analysisStatus: "skipped_short_call",
      analysisReason: params.reason,
      analysisThresholdSec: params.thresholdSec,
      analysisRanAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(calls.id, params.callId));
}

export async function markAnalysisFailedInvalidJson(params: {
  callId: string;
  thresholdSec: number;
  rawOutput: string;
  repairedRawOutput: string;
  reasonDetails: string;
}) {
  const db = getDb();
  await db
    .update(calls)
    .set({
      analysisStatus: "failed_invalid_json",
      analysisReason: "invalid_json_schema",
      analysisThresholdSec: params.thresholdSec,
      analysisRanAt: new Date(),
      analysisRawOutput: [params.rawOutput, params.repairedRawOutput, params.reasonDetails]
        .filter(Boolean)
        .join("\n---\n"),
      updatedAt: new Date(),
    })
    .where(eq(calls.id, params.callId));
}

export async function markAnalysisFailed(params: {
  callId: string;
  thresholdSec: number;
  reason: string;
  rawOutput?: string;
}) {
  const db = getDb();
  await db
    .update(calls)
    .set({
      analysisStatus: "failed",
      analysisReason: params.reason,
      analysisThresholdSec: params.thresholdSec,
      analysisRanAt: new Date(),
      analysisRawOutput: params.rawOutput ?? null,
      updatedAt: new Date(),
    })
    .where(eq(calls.id, params.callId));
}

function toConfidence(v: number) {
  const bounded = Math.max(0, Math.min(1, v));
  return bounded.toFixed(3);
}

function parseOptionalDueDate(value: string | null): Date | null {
  if (!value || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildCanonicalTag(tags: AnalysisOutput["tags"]): string | null {
  if (!Array.isArray(tags) || tags.length === 0) return null;
  const unique = Array.from(new Set(tags.map((t) => t.tag).filter((t) => typeof t === "string" && t.trim().length > 0)));
  if (unique.length === 0) return null;
  return unique.join(", ");
}

export async function saveSuggestedAnalysis(params: {
  callId: string;
  transcriptHash: string;
  model: string;
  thresholdSec: number;
  analysis: AnalysisOutput;
}) {
  const db = getDb();
  const now = new Date();

  await db.delete(callTasksSuggested).where(and(eq(callTasksSuggested.callId, params.callId), eq(callTasksSuggested.state, "suggested")));
  await db.delete(callTagsSuggested).where(and(eq(callTagsSuggested.callId, params.callId), eq(callTagsSuggested.state, "suggested")));
  await db
    .delete(callParticipantsSuggested)
    .where(and(eq(callParticipantsSuggested.callId, params.callId), eq(callParticipantsSuggested.state, "suggested")));

  if (params.analysis.tasks.length > 0) {
    await db.insert(callTasksSuggested).values(
      params.analysis.tasks.map((task) => ({
        callId: params.callId,
        state: "suggested",
        title: task.title,
        description: task.description,
        assigneeSuggestion: task.assignee_suggestion,
        dueAt: parseOptionalDueDate(task.due),
        priority: task.priority,
        status: task.status,
        evidenceQuotes: task.evidence_quotes as any,
        confidence: toConfidence(task.confidence),
        createdAt: now,
      }))
    );
  }

  if (params.analysis.tags.length > 0) {
    await db.insert(callTagsSuggested).values(
      params.analysis.tags.map((tag) => ({
        callId: params.callId,
        state: "suggested",
        tag: tag.tag,
        confidence: toConfidence(tag.confidence),
        createdAt: now,
      }))
    );
  }

  if (params.analysis.participants.length > 0) {
    await db.insert(callParticipantsSuggested).values(
      params.analysis.participants.map((p) => ({
        callId: params.callId,
        state: "suggested",
        name: p.name,
        role: p.role,
        evidenceQuotes: p.evidence_quotes as any,
        confidence: toConfidence(p.confidence),
        createdAt: now,
      }))
    );
  }

  await db
    .update(calls)
    .set({
      analysisStatus: "success",
      analysisReason: null,
      analysisModel: params.model,
      analysisRanAt: now,
      analysisThresholdSec: params.thresholdSec,
      summarySuggestedShort: params.analysis.summary_short,
      summarySuggestedDetailed: params.analysis.summary_detailed,
      tag: buildCanonicalTag(params.analysis.tags),
      transcriptHash: params.transcriptHash,
      analysisRawOutput: null,
      analysisQualityReliability: params.analysis.quality.transcript_reliability,
      analysisQualityHallucinationRisk: params.analysis.quality.hallucination_risk,
      analysisQualityNotes: params.analysis.quality.notes,
      updatedAt: now,
    })
    .where(eq(calls.id, params.callId));
}

