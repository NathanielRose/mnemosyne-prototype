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

export const notificationType = pgEnum("notification_type", [
  "action_required",
  "info",
  "warning",
]);

export const notificationStatus = pgEnum("notification_status", [
  "unread",
  "read",
  "archived",
]);

export const recordingStatus = pgEnum("recording_status", [
  "pending",
  "ready",
  "processed",
  "failed",
]);

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    externalId: text("external_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    fromNumber: text("from_number").notNull(),
    durationSec: integer("duration_sec").notNull(),
    language: callLanguage("language").notNull(),
    outcome: callOutcome("outcome").notNull(),
    priority: callPriority("priority").notNull(),
    summary: text("summary").notNull(),
    transcriptPreview: text("transcript_preview"),
    requiresAction: boolean("requires_action").notNull().default(false),
    tag: text("tag"),
    rateEur: numeric("rate_eur", { precision: 10, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    externalIdUnique: uniqueIndex("calls_external_id_unique").on(table.externalId),
  })
);

export const recordings = pgTable(
  "recordings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("twilio"),
    recordingSid: text("recording_sid"),
    durationSec: integer("duration_sec"),
    status: recordingStatus("status").notNull().default("pending"),
    url: text("url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    callIdUnique: uniqueIndex("recordings_call_id_unique").on(table.callId),
    recordingSidUnique: uniqueIndex("recordings_recording_sid_unique").on(
      table.recordingSid
    ),
  })
);

export const transcripts = pgTable(
  "transcripts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    recordingId: uuid("recording_id").references(() => recordings.id, {
      onDelete: "set null",
    }),
    language: callLanguage("language").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    callIdUnique: uniqueIndex("transcripts_call_id_unique").on(table.callId),
  })
);

export const extractions = pgTable(
  "extractions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("llm"),
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    callIdUnique: uniqueIndex("extractions_call_id_unique").on(table.callId),
  })
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    type: notificationType("type").notNull(),
    status: notificationStatus("status").notNull().default("unread"),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => ({
    callTypeUnique: uniqueIndex("notifications_call_type_unique").on(
      table.callId,
      table.type
    ),
  })
);
