import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const callOutcome = pgEnum("call_outcome", [
  "Booked",
  "Needs follow-up",
  "No answer",
  "Inquiry",
]);

export const callPriority = pgEnum("call_priority", ["Low", "Medium", "High"]);

export const callLanguage = pgEnum("call_language", ["Greek", "English"]);

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    externalId: text("external_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    fromNumber: text("from_number").notNull(),
    callerName: text("caller_name"),
    callerNameSource: text("caller_name_source"),
    toNumber: text("to_number"),
    durationSec: integer("duration_sec").notNull(),
    language: callLanguage("language").notNull(),
    detectedLanguage: text("detected_language"),
    outcome: callOutcome("outcome").notNull(),
    priority: callPriority("priority").notNull(),
    summary: text("summary").notNull(),
    transcriptPreview: text("transcript_preview"),
    notes: text("notes"),
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
    requiresAction: boolean("requires_action").notNull().default(false),
    tag: text("tag"),
    rateEur: numeric("rate_eur", { precision: 10, scale: 2 }),
    status: text("status").notNull().default("completed"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    externalIdUnique: uniqueIndex("calls_external_id_unique").on(table.externalId),
  })
);

export const transcripts = pgTable(
  "transcripts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    callId: uuid("call_id").notNull(),
    recordingId: uuid("recording_id"),
    language: callLanguage("language").notNull(),
    detectedLanguage: text("detected_language"),
    content: text("content").notNull(),
    contentEn: text("content_en"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    callIdUnique: uniqueIndex("transcripts_call_id_unique").on(table.callId),
  })
);

export const callTasksSuggested = pgTable("call_tasks_suggested", {
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const callTagsSuggested = pgTable("call_tags_suggested", {
  id: uuid("id").defaultRandom().primaryKey(),
  callId: uuid("call_id").notNull(),
  state: text("state").notNull(),
  tier: text("tier").notNull(),
  tag: text("tag").notNull(),
  confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const callParticipantsSuggested = pgTable("call_participants_suggested", {
  id: uuid("id").defaultRandom().primaryKey(),
  callId: uuid("call_id").notNull(),
  state: text("state").notNull(),
  name: text("name"),
  role: text("role").notNull(),
  evidenceQuotes: jsonb("evidence_quotes").notNull(),
  confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
