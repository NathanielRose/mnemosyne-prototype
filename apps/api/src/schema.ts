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
