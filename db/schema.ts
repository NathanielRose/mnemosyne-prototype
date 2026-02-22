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
    localPath: text("local_path"),
    downloadedAt: timestamp("downloaded_at", { withTimezone: true }),
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
    detectedLanguage: text("detected_language"),
    content: text("content").notNull(),
    contentEn: text("content_en"),
    rawJson: jsonb("raw_json"),
    rawJsonEn: jsonb("raw_json_en"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    callIdUnique: uniqueIndex("transcripts_call_id_unique").on(table.callId),
    recordingIdUnique: uniqueIndex("transcripts_recording_id_unique").on(table.recordingId),
  })
);

export const insights = pgTable(
  "insights",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recordingId: uuid("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    recordingIdUnique: uniqueIndex("insights_recording_id_unique").on(table.recordingId),
  })
);

export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recordingSid: text("recording_sid").notNull(),
    jobId: text("job_id"),
    status: text("status").notNull().default("started"),
    attempt: integer("attempt").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => ({
    recordingJobUnique: uniqueIndex("pipeline_runs_recording_job_unique").on(
      table.recordingSid,
      table.jobId
    ),
  })
);

export const pipelineSteps = pgTable(
  "pipeline_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: "cascade" }),
    step: text("step").notNull(),
    status: text("status").notNull().default("started"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    meta: jsonb("meta"),
    error: text("error"),
  },
  (table) => ({
    runStepUnique: uniqueIndex("pipeline_steps_run_step_unique").on(table.runId, table.step),
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
