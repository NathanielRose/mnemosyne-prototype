import {
  boolean,
  integer,
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
    toNumber: text("to_number"),
    durationSec: integer("duration_sec").notNull(),
    language: callLanguage("language").notNull(),
    detectedLanguage: text("detected_language"),
    outcome: callOutcome("outcome").notNull(),
    priority: callPriority("priority").notNull(),
    summary: text("summary").notNull(),
    transcriptPreview: text("transcript_preview"),
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
