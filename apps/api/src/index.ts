import Fastify from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import rawBody from "fastify-raw-body";
import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import fastifyExpress from "@fastify/express";
import twilio from "twilio";
import { getDb } from "./db.js";
import {
  callParticipantsSuggested,
  callTagsSuggested,
  callTasksSuggested,
  calls,
  transcripts,
} from "./schema.js";
import { enqueueRecordingJob, getRecordingQueue } from "./queues/recordingQueue.js";

const TWILIO_RECORDING_PATH = "/webhooks/twilio/recording";
const MAX_CALL_NOTES_LENGTH = 4000;
const CALL_TERMINAL_STATUSES = ["completed", "failed"] as const;
const DELETED_CALL_STATUS = "deleted";

function joinPublicUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, "")}${path}`;
}

function toNumberOrNull(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim().length > 0) {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

const app = Fastify({
  logger: true,
});

await app.register(cors, {
  origin: true,
});

// Capture raw body for Twilio signature verification.
await app.register(rawBody, {
  field: "rawBody",
  global: false,
  encoding: "utf8",
  runFirst: true,
});

// Twilio sends application/x-www-form-urlencoded
await app.register(formbody);

app.get("/health", async () => {
  return { ok: true };
});

// Bull Board (queue UI) - enable explicitly for local testing.
if (process.env.BULLBOARD_ENABLED === "true") {
  await app.register(fastifyExpress);

  const recordingQueue = getRecordingQueue();
  if (!recordingQueue) {
    app.log.warn("Bull Board enabled but REDIS_URL is not configured; skipping UI mount");
  } else {
    const basePath = "/admin/queues";
    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath(basePath);

    createBullBoard({
      queues: [new BullMQAdapter(recordingQueue)],
      serverAdapter,
    });

    // Some Fastify+Express setups will default string responses to `text/plain`,
    // which makes the browser show the HTML source instead of rendering the UI.
    // Force `text/html` only for the entry document path.
    app.use(basePath, (req: any, res: any, next: any) => {
      if (req?.path === "/" || req?.path === "") {
        res.type("html");
      }
      next();
    });

    app.use(basePath, serverAdapter.getRouter());
    app.log.info({ basePath }, "Bull Board mounted");
  }
}

app.post(
  TWILIO_RECORDING_PATH,
  {
    config: {
      rawBody: true,
    },
  },
  async (request, reply) => {
    const signature = request.headers["x-twilio-signature"];
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const publicBase = process.env.PUBLIC_WEBHOOK_URL;

    if (!authToken || !publicBase) {
      request.log.error(
        { hasAuthToken: Boolean(authToken), hasPublicUrl: Boolean(publicBase) },
        "Missing TWILIO_AUTH_TOKEN or PUBLIC_WEBHOOK_URL"
      );
      return reply.code(500).send({ ok: false });
    }

    if (typeof signature !== "string" || !signature) {
      return reply.code(401).send({ ok: false });
    }

    const body = (request.body ?? {}) as Record<string, any>;
    const accountSid = body.AccountSid;
    const callSid = body.CallSid;
    const recordingSid = body.RecordingSid;
    const recordingStatus = body.RecordingStatus;
    const recordingUrl = typeof body.RecordingUrl === "string" ? body.RecordingUrl : undefined;
    const recordingDurationRaw = body.RecordingDuration;
    const fromRaw = body.From ?? body.Caller;
    const toRaw = body.To ?? body.Called;
    const directionRaw = body.Direction;

    if (
      typeof accountSid !== "string" ||
      typeof callSid !== "string" ||
      typeof recordingSid !== "string" ||
      typeof recordingStatus !== "string"
    ) {
      return reply.code(400).send({ ok: false });
    }

    const durationSec =
      typeof recordingDurationRaw === "string" || typeof recordingDurationRaw === "number"
        ? Number(recordingDurationRaw)
        : undefined;
    const safeDurationSec = Number.isFinite(durationSec) ? Math.max(0, Math.floor(durationSec!)) : undefined;

    const fromNumber = typeof fromRaw === "string" && fromRaw.trim().length ? fromRaw.trim() : undefined;
    const toNumber = typeof toRaw === "string" && toRaw.trim().length ? toRaw.trim() : undefined;
    const direction = typeof directionRaw === "string" && directionRaw.trim().length ? directionRaw.trim() : undefined;

    const webhookUrl = joinPublicUrl(publicBase, TWILIO_RECORDING_PATH);

    request.log.info(
      { recordingSid, recordingStatus, callSid },
      "Twilio recording webhook received"
    );

    const isValid = twilio.validateRequest(authToken, signature, webhookUrl, body);
    if (!isValid) {
      request.log.warn({ recordingSid }, "Twilio signature invalid");
      return reply.code(401).send({ ok: false });
    }

    request.log.info({ recordingSid }, "Twilio signature validated");

    if (recordingStatus !== "completed") {
      return reply.code(200).send({ ok: true, ignored: true });
    }

    try {
      const raw = (request as any).rawBody as string | undefined;
      const result = await enqueueRecordingJob({
        accountSid,
        callSid,
        recordingSid,
        recordingStatus,
        receivedAt: new Date().toISOString(),
        rawBody: raw,
        publicWebhookUrl: webhookUrl,
        recordingUrl,
        durationSec: safeDurationSec,
        fromNumber,
        toNumber,
        direction,
      });

      if (!result.ok) {
        request.log.warn(
          { recordingSid, redisConfigured: false },
          "Redis not configured; skipping enqueue"
        );
        return reply.code(503).send({ ok: false, error: "REDIS_URL_NOT_CONFIGURED" });
      }

      request.log.info(
        { jobId: result.jobId, duplicated: result.duplicated ?? false },
        "Recording job enqueued"
      );

      return reply.code(200).send({ ok: true, jobId: result.jobId });
    } catch (err) {
      request.log.error({ err, recordingSid }, "Failed to enqueue recording job");
      return reply.code(500).send({ ok: false });
    }
  }
);

app.get("/calls", async (request, reply) => {
  const { limit, offset } = request.query as { limit?: string; offset?: string };
  const parsedLimit = Number(limit);
  const safeLimit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 6;
  const parsedOffset = Number(offset);
  const safeOffset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

  try {
    const { db } = getDb();
    const rows = await db
      .select({
        call: calls,
        transcriptOriginal: transcripts.content,
        transcriptEnglish: transcripts.contentEn,
      })
      .from(calls)
      .leftJoin(transcripts, eq(transcripts.callId, calls.id))
      .where(
        and(
          inArray(calls.status, [...CALL_TERMINAL_STATUSES]),
          or(isNotNull(transcripts.content), isNotNull(transcripts.contentEn))
        )
      )
      .orderBy(desc(calls.startedAt))
      .limit(safeLimit)
      .offset(safeOffset);

    const callIds = rows.map((r) => r.call.id);
    const topTagRows = callIds.length
      ? await db
          .select({
            callId: callTagsSuggested.callId,
            tag: callTagsSuggested.tag,
            state: callTagsSuggested.state,
          })
          .from(callTagsSuggested)
          .where(
            and(
              inArray(callTagsSuggested.callId, callIds),
              eq(callTagsSuggested.tier, "top"),
              eq(callTagsSuggested.state, "confirmed")
            )
          )
      : [];
    const topTagsByCall = new Map<string, string[]>();
    for (const row of topTagRows) {
      const list = topTagsByCall.get(row.callId) ?? [];
      if (!list.includes(row.tag)) list.push(row.tag);
      topTagsByCall.set(row.callId, list);
    }

    const shaped = rows.map((r) => {
      const transcriptOriginal =
        typeof r.transcriptOriginal === "string" && r.transcriptOriginal.trim().length
          ? r.transcriptOriginal.trim()
          : null;
      const transcriptEnglish =
        typeof r.transcriptEnglish === "string" && r.transcriptEnglish.trim().length
          ? r.transcriptEnglish.trim()
          : null;
      const transcriptPreviewOriginal =
        transcriptOriginal
          ? transcriptOriginal.slice(0, 280)
          : null;
      const transcriptPreviewEn =
        transcriptEnglish
          ? transcriptEnglish.slice(0, 280)
          : null;

      return {
        ...r.call,
        transcriptOriginal,
        transcriptEnglish,
        transcriptPreviewOriginal,
        transcriptPreviewEn,
        topLevelTags: topTagsByCall.get(r.call.id) ?? [],
      };
    });

    reply.send(shaped);
  } catch (err: any) {
    request.log.error({ err }, "Database not configured for /calls");
    reply.code(503).send({ ok: false, error: "DATABASE_URL not configured" });
  }
});

app.get("/calls/deleted", async (request, reply) => {
  const { limit, offset } = request.query as { limit?: string; offset?: string };
  const parsedLimit = Number(limit);
  const safeLimit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 50;
  const parsedOffset = Number(offset);
  const safeOffset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

  try {
    const { db } = getDb();
    const rows = await db
      .select({
        call: calls,
        transcriptOriginal: transcripts.content,
        transcriptEnglish: transcripts.contentEn,
      })
      .from(calls)
      .leftJoin(transcripts, eq(transcripts.callId, calls.id))
      .where(eq(calls.status, DELETED_CALL_STATUS))
      .orderBy(desc(calls.updatedAt), desc(calls.startedAt))
      .limit(safeLimit)
      .offset(safeOffset);

    const shaped = rows.map((r) => {
      const transcriptOriginal =
        typeof r.transcriptOriginal === "string" && r.transcriptOriginal.trim().length
          ? r.transcriptOriginal.trim()
          : null;
      const transcriptEnglish =
        typeof r.transcriptEnglish === "string" && r.transcriptEnglish.trim().length
          ? r.transcriptEnglish.trim()
          : null;
      const transcriptPreviewOriginal = transcriptOriginal ? transcriptOriginal.slice(0, 280) : null;
      const transcriptPreviewEn = transcriptEnglish ? transcriptEnglish.slice(0, 280) : null;

      return {
        ...r.call,
        transcriptOriginal,
        transcriptEnglish,
        transcriptPreviewOriginal,
        transcriptPreviewEn,
      };
    });

    reply.send(shaped);
  } catch (err: any) {
    request.log.error({ err }, "Database not configured for /calls/deleted");
    reply.code(503).send({ ok: false, error: "DATABASE_URL not configured" });
  }
});

app.get("/calls/:externalId/analysis", async (request, reply) => {
  const { externalId } = request.params as { externalId?: string };
  if (typeof externalId !== "string" || !externalId.trim()) {
    return reply.code(400).send({ ok: false, error: "INVALID_EXTERNAL_ID" });
  }

  try {
    const { db } = getDb();
    const callRows = await db
      .select({
        id: calls.id,
        externalId: calls.externalId,
        analysisStatus: calls.analysisStatus,
        analysisReason: calls.analysisReason,
        analysisModel: calls.analysisModel,
        analysisRanAt: calls.analysisRanAt,
        analysisThresholdSec: calls.analysisThresholdSec,
        summarySuggestedShort: calls.summarySuggestedShort,
        summarySuggestedDetailed: calls.summarySuggestedDetailed,
        analysisQualityReliability: calls.analysisQualityReliability,
        analysisQualityHallucinationRisk: calls.analysisQualityHallucinationRisk,
        analysisQualityNotes: calls.analysisQualityNotes,
      })
      .from(calls)
      .where(eq(calls.externalId, externalId.trim()))
      .limit(1);

    const callRow = callRows[0];
    if (!callRow) {
      return reply.code(404).send({ ok: false, error: "CALL_NOT_FOUND" });
    }

    const [tasks, tags, participants] = await Promise.all([
      db
        .select({
          id: callTasksSuggested.id,
          title: callTasksSuggested.title,
          description: callTasksSuggested.description,
          assigneeSuggestion: callTasksSuggested.assigneeSuggestion,
          dueAt: callTasksSuggested.dueAt,
          priority: callTasksSuggested.priority,
          status: callTasksSuggested.status,
          evidenceQuotes: callTasksSuggested.evidenceQuotes,
          confidence: callTasksSuggested.confidence,
        })
        .from(callTasksSuggested)
        .where(and(eq(callTasksSuggested.callId, callRow.id), eq(callTasksSuggested.state, "suggested"))),
      db
        .select({
          id: callTagsSuggested.id,
          tag: callTagsSuggested.tag,
          tier: callTagsSuggested.tier,
          state: callTagsSuggested.state,
          confidence: callTagsSuggested.confidence,
        })
        .from(callTagsSuggested)
        .where(
          and(
            eq(callTagsSuggested.callId, callRow.id),
            inArray(callTagsSuggested.state, ["suggested", "confirmed"])
          )
        ),
      db
        .select({
          id: callParticipantsSuggested.id,
          name: callParticipantsSuggested.name,
          role: callParticipantsSuggested.role,
          confidence: callParticipantsSuggested.confidence,
          evidenceQuotes: callParticipantsSuggested.evidenceQuotes,
        })
        .from(callParticipantsSuggested)
        .where(
          and(
            eq(callParticipantsSuggested.callId, callRow.id),
            eq(callParticipantsSuggested.state, "suggested")
          )
        ),
    ]);

    return reply.send({
      ok: true,
      analysis: {
        callId: callRow.id,
        externalId: callRow.externalId,
        status: callRow.analysisStatus,
        reason: callRow.analysisReason,
        model: callRow.analysisModel,
        ranAt: callRow.analysisRanAt,
        thresholdSec: callRow.analysisThresholdSec,
        summaryShort: callRow.summarySuggestedShort,
        summaryDetailed: callRow.summarySuggestedDetailed,
        quality: {
          transcriptReliability: callRow.analysisQualityReliability,
          hallucinationRisk: callRow.analysisQualityHallucinationRisk,
          notes: callRow.analysisQualityNotes,
        },
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          assigneeSuggestion: t.assigneeSuggestion,
          dueAt: t.dueAt,
          priority: t.priority,
          status: t.status,
          evidenceQuotes: Array.isArray(t.evidenceQuotes) ? t.evidenceQuotes : [],
          confidence: toNumberOrNull(t.confidence),
        })),
        topLevelTags: tags
          .filter((t) => t.tier === "top" && t.state === "confirmed")
          .map((t) => ({ id: t.id, tag: t.tag, confidence: toNumberOrNull(t.confidence) })),
        topLevelTagsSuggested: tags
          .filter((t) => t.tier === "top" && t.state === "suggested")
          .map((t) => ({ id: t.id, tag: t.tag, confidence: toNumberOrNull(t.confidence) })),
        detailTagsSuggested: tags
          .filter((t) => t.tier === "detail" && t.state === "suggested")
          .map((t) => ({ id: t.id, tag: t.tag, confidence: toNumberOrNull(t.confidence) })),
        participants: participants.map((p) => ({
          id: p.id,
          name: p.name,
          role: p.role,
          confidence: toNumberOrNull(p.confidence),
          evidenceQuotes: Array.isArray(p.evidenceQuotes) ? p.evidenceQuotes : [],
        })),
      },
    });
  } catch (err: any) {
    request.log.error({ err, externalId }, "Failed to fetch call analysis");
    return reply.code(503).send({ ok: false, error: "DATABASE_URL not configured" });
  }
});

app.post("/calls/:externalId/analysis/accept", async (request, reply) => {
  const { externalId } = request.params as { externalId?: string };
  const body = (request.body ?? {}) as {
    summaryShort?: unknown;
    summaryDetailed?: unknown;
    taskIds?: unknown;
    tagIds?: unknown;
    participantIds?: unknown;
  };

  if (typeof externalId !== "string" || !externalId.trim()) {
    return reply.code(400).send({ ok: false, error: "INVALID_EXTERNAL_ID" });
  }

  const ensureStringArray = (v: unknown) =>
    Array.isArray(v) && v.every((x) => typeof x === "string");

  if (
    (body.summaryShort !== undefined && typeof body.summaryShort !== "boolean") ||
    (body.summaryDetailed !== undefined && typeof body.summaryDetailed !== "boolean") ||
    (body.taskIds !== undefined && !ensureStringArray(body.taskIds)) ||
    (body.tagIds !== undefined && !ensureStringArray(body.tagIds)) ||
    (body.participantIds !== undefined && !ensureStringArray(body.participantIds))
  ) {
    return reply.code(400).send({ ok: false, error: "INVALID_ACCEPT_PAYLOAD" });
  }

  const acceptSummaryShort = body.summaryShort === true;
  const acceptSummaryDetailed = body.summaryDetailed === true;
  const taskIds = (body.taskIds as string[] | undefined) ?? [];
  const tagIds = (body.tagIds as string[] | undefined) ?? [];
  const participantIds = (body.participantIds as string[] | undefined) ?? [];

  if (!acceptSummaryShort && !acceptSummaryDetailed && !taskIds.length && !tagIds.length && !participantIds.length) {
    return reply.code(400).send({ ok: false, error: "NOTHING_SELECTED" });
  }

  try {
    const { db } = getDb();
    const now = new Date();

    const callRows = await db
      .select({
        id: calls.id,
        externalId: calls.externalId,
        summarySuggestedShort: calls.summarySuggestedShort,
        summarySuggestedDetailed: calls.summarySuggestedDetailed,
        callerName: calls.callerName,
        callerNameSource: calls.callerNameSource,
      })
      .from(calls)
      .where(eq(calls.externalId, externalId.trim()))
      .limit(1);
    const callRow = callRows[0];
    if (!callRow) {
      return reply.code(404).send({ ok: false, error: "CALL_NOT_FOUND" });
    }

    let acceptedTaskCount = 0;
    let acceptedTagCount = 0;
    let acceptedParticipantCount = 0;
    let acceptedTags: Array<{ tag: string; tier: string; confidence: unknown }> = [];
    let acceptedParticipants: Array<{ name: string | null; confidence: unknown }> = [];

    await db.transaction(async (tx) => {
      if (taskIds.length) {
        const accepted = await tx
          .update(callTasksSuggested)
          .set({ state: "confirmed", createdAt: now })
          .where(
            and(
              eq(callTasksSuggested.callId, callRow.id),
              eq(callTasksSuggested.state, "suggested"),
              inArray(callTasksSuggested.id, taskIds)
            )
          )
          .returning({ id: callTasksSuggested.id });
        acceptedTaskCount = accepted.length;
      }

      if (tagIds.length) {
        const accepted = await tx
          .update(callTagsSuggested)
          .set({ state: "confirmed", createdAt: now })
          .where(
            and(
              eq(callTagsSuggested.callId, callRow.id),
              eq(callTagsSuggested.state, "suggested"),
              inArray(callTagsSuggested.id, tagIds)
            )
          )
          .returning({
            id: callTagsSuggested.id,
            tag: callTagsSuggested.tag,
            tier: callTagsSuggested.tier,
            confidence: callTagsSuggested.confidence,
          });
        acceptedTagCount = accepted.length;
        acceptedTags = accepted.map((item) => ({
          tag: item.tag,
          tier: item.tier,
          confidence: item.confidence,
        }));
      }

      if (participantIds.length) {
        const accepted = await tx
          .update(callParticipantsSuggested)
          .set({ state: "confirmed", createdAt: now })
          .where(
            and(
              eq(callParticipantsSuggested.callId, callRow.id),
              eq(callParticipantsSuggested.state, "suggested"),
              inArray(callParticipantsSuggested.id, participantIds)
            )
          )
          .returning({
            id: callParticipantsSuggested.id,
            name: callParticipantsSuggested.name,
            confidence: callParticipantsSuggested.confidence,
          });
        acceptedParticipantCount = accepted.length;
        acceptedParticipants = accepted.map((item) => ({
          name: item.name,
          confidence: item.confidence,
        }));
      }

      const callUpdate: Partial<typeof calls.$inferInsert> = {
        updatedAt: now,
      };

      if (acceptSummaryShort || acceptSummaryDetailed) {
        const nextSummary =
          (acceptSummaryDetailed && callRow.summarySuggestedDetailed?.trim()) ||
          (acceptSummaryShort && callRow.summarySuggestedShort?.trim()) ||
          callRow.summarySuggestedDetailed ||
          callRow.summarySuggestedShort ||
          "";
        callUpdate.summary = nextSummary;
        if (acceptSummaryShort) callUpdate.summarySuggestedShort = null;
        if (acceptSummaryDetailed) callUpdate.summarySuggestedDetailed = null;
      }

      const acceptedTopLevelTags = acceptedTags.filter((t) => t.tier === "top");
      if (acceptedTopLevelTags.length) {
        const sorted = [...acceptedTopLevelTags].sort(
          (a, b) => (toNumberOrNull(b.confidence) ?? 0) - (toNumberOrNull(a.confidence) ?? 0)
        );
        const unique = Array.from(
          new Set(sorted.map((item) => item.tag).filter((item) => typeof item === "string" && item.trim().length > 0))
        );
        callUpdate.tag = unique.length ? unique.join(", ") : null;
      }

      const shouldAutofillCaller =
        !callRow.callerName ||
        callRow.callerNameSource === "ai" ||
        callRow.callerNameSource === "unknown";
      if (shouldAutofillCaller && acceptedParticipants.length) {
        const named = acceptedParticipants.filter((p) => p.name && p.name.trim().length > 0);
        if (named.length) {
          const sortedNamed = [...named].sort(
            (a, b) => (toNumberOrNull(b.confidence) ?? 0) - (toNumberOrNull(a.confidence) ?? 0)
          );
          callUpdate.callerName = sortedNamed[0]?.name ?? null;
          callUpdate.callerNameSource = sortedNamed[0]?.name ? "ai" : callRow.callerNameSource;
        }
      }

      await tx
        .update(calls)
        .set(callUpdate)
        .where(eq(calls.id, callRow.id));
    });

    const refreshed = await db
      .select({
        externalId: calls.externalId,
        summary: calls.summary,
        tag: calls.tag,
        callerName: calls.callerName,
        callerNameSource: calls.callerNameSource,
        updatedAt: calls.updatedAt,
      })
      .from(calls)
      .where(eq(calls.id, callRow.id))
      .limit(1);

    return reply.send({
      ok: true,
      accepted: {
        summaryShort: acceptSummaryShort,
        summaryDetailed: acceptSummaryDetailed,
        taskCount: acceptedTaskCount,
        tagCount: acceptedTagCount,
        participantCount: acceptedParticipantCount,
      },
      call: refreshed[0] ?? null,
    });
  } catch (err: any) {
    request.log.error({ err, externalId }, "Failed to accept analysis suggestions");
    return reply.code(503).send({ ok: false, error: "DATABASE_URL not configured" });
  }
});

app.post("/calls/:externalId/analysis/dismiss", async (request, reply) => {
  const { externalId } = request.params as { externalId?: string };
  const body = (request.body ?? {}) as {
    all?: unknown;
    summaryShort?: unknown;
    summaryDetailed?: unknown;
    taskIds?: unknown;
    tagIds?: unknown;
    participantIds?: unknown;
  };

  if (typeof externalId !== "string" || !externalId.trim()) {
    return reply.code(400).send({ ok: false, error: "INVALID_EXTERNAL_ID" });
  }

  const ensureStringArray = (v: unknown) =>
    Array.isArray(v) && v.every((x) => typeof x === "string");

  if (
    (body.all !== undefined && typeof body.all !== "boolean") ||
    (body.summaryShort !== undefined && typeof body.summaryShort !== "boolean") ||
    (body.summaryDetailed !== undefined && typeof body.summaryDetailed !== "boolean") ||
    (body.taskIds !== undefined && !ensureStringArray(body.taskIds)) ||
    (body.tagIds !== undefined && !ensureStringArray(body.tagIds)) ||
    (body.participantIds !== undefined && !ensureStringArray(body.participantIds))
  ) {
    return reply.code(400).send({ ok: false, error: "INVALID_DISMISS_PAYLOAD" });
  }

  const dismissAll = body.all === true;
  const dismissSummaryShort = body.summaryShort === true;
  const dismissSummaryDetailed = body.summaryDetailed === true;
  const taskIds = (body.taskIds as string[] | undefined) ?? [];
  const tagIds = (body.tagIds as string[] | undefined) ?? [];
  const participantIds = (body.participantIds as string[] | undefined) ?? [];

  if (
    !dismissAll &&
    !dismissSummaryShort &&
    !dismissSummaryDetailed &&
    !taskIds.length &&
    !tagIds.length &&
    !participantIds.length
  ) {
    return reply.code(400).send({ ok: false, error: "NOTHING_SELECTED" });
  }

  try {
    const { db } = getDb();
    const now = new Date();
    const callRows = await db
      .select({ id: calls.id })
      .from(calls)
      .where(eq(calls.externalId, externalId.trim()))
      .limit(1);
    const callRow = callRows[0];
    if (!callRow) return reply.code(404).send({ ok: false, error: "CALL_NOT_FOUND" });

    let dismissedTaskCount = 0;
    let dismissedTagCount = 0;
    let dismissedParticipantCount = 0;

    await db.transaction(async (tx) => {
      if (dismissAll) {
        const dismissedTasks = await tx
          .update(callTasksSuggested)
          .set({ state: "dismissed", createdAt: now })
          .where(and(eq(callTasksSuggested.callId, callRow.id), eq(callTasksSuggested.state, "suggested")))
          .returning({ id: callTasksSuggested.id });
        dismissedTaskCount = dismissedTasks.length;

        const dismissedTags = await tx
          .update(callTagsSuggested)
          .set({ state: "dismissed", createdAt: now })
          .where(and(eq(callTagsSuggested.callId, callRow.id), eq(callTagsSuggested.state, "suggested")))
          .returning({ id: callTagsSuggested.id });
        dismissedTagCount = dismissedTags.length;

        const dismissedParticipants = await tx
          .update(callParticipantsSuggested)
          .set({ state: "dismissed", createdAt: now })
          .where(
            and(
              eq(callParticipantsSuggested.callId, callRow.id),
              eq(callParticipantsSuggested.state, "suggested")
            )
          )
          .returning({ id: callParticipantsSuggested.id });
        dismissedParticipantCount = dismissedParticipants.length;

        await tx
          .update(calls)
          .set({
            summarySuggestedShort: null,
            summarySuggestedDetailed: null,
            updatedAt: now,
          })
          .where(eq(calls.id, callRow.id));
        return;
      }

      if (taskIds.length) {
        const dismissed = await tx
          .update(callTasksSuggested)
          .set({ state: "dismissed", createdAt: now })
          .where(
            and(
              eq(callTasksSuggested.callId, callRow.id),
              eq(callTasksSuggested.state, "suggested"),
              inArray(callTasksSuggested.id, taskIds)
            )
          )
          .returning({ id: callTasksSuggested.id });
        dismissedTaskCount = dismissed.length;
      }

      if (tagIds.length) {
        const dismissed = await tx
          .update(callTagsSuggested)
          .set({ state: "dismissed", createdAt: now })
          .where(
            and(
              eq(callTagsSuggested.callId, callRow.id),
              eq(callTagsSuggested.state, "suggested"),
              inArray(callTagsSuggested.id, tagIds)
            )
          )
          .returning({ id: callTagsSuggested.id });
        dismissedTagCount = dismissed.length;
      }

      if (participantIds.length) {
        const dismissed = await tx
          .update(callParticipantsSuggested)
          .set({ state: "dismissed", createdAt: now })
          .where(
            and(
              eq(callParticipantsSuggested.callId, callRow.id),
              eq(callParticipantsSuggested.state, "suggested"),
              inArray(callParticipantsSuggested.id, participantIds)
            )
          )
          .returning({ id: callParticipantsSuggested.id });
        dismissedParticipantCount = dismissed.length;
      }

      const callUpdate: Partial<typeof calls.$inferInsert> = { updatedAt: now };
      if (dismissSummaryShort) callUpdate.summarySuggestedShort = null;
      if (dismissSummaryDetailed) callUpdate.summarySuggestedDetailed = null;
      if (dismissSummaryShort || dismissSummaryDetailed) {
        await tx.update(calls).set(callUpdate).where(eq(calls.id, callRow.id));
      }
    });

    return reply.send({
      ok: true,
      dismissed: {
        all: dismissAll,
        summaryShort: dismissSummaryShort,
        summaryDetailed: dismissSummaryDetailed,
        taskCount: dismissedTaskCount,
        tagCount: dismissedTagCount,
        participantCount: dismissedParticipantCount,
      },
    });
  } catch (err: any) {
    request.log.error({ err, externalId }, "Failed to dismiss analysis suggestions");
    return reply.code(503).send({ ok: false, error: "DATABASE_URL not configured" });
  }
});

app.patch("/calls/:externalId/caller", async (request, reply) => {
  const { externalId } = request.params as { externalId?: string };
  const body = (request.body ?? {}) as { callerName?: unknown };
  if (typeof externalId !== "string" || !externalId.trim()) {
    return reply.code(400).send({ ok: false, error: "INVALID_EXTERNAL_ID" });
  }
  if (typeof body.callerName !== "string") {
    return reply.code(400).send({ ok: false, error: "INVALID_CALLER_NAME" });
  }
  const normalized = body.callerName.trim();
  if (normalized.length > 160) {
    return reply.code(400).send({ ok: false, error: "CALLER_NAME_TOO_LONG", maxLength: 160 });
  }

  try {
    const { db } = getDb();
    const updated = await db
      .update(calls)
      .set({
        callerName: normalized.length ? normalized : null,
        callerNameSource: normalized.length ? "user" : "unknown",
        updatedAt: new Date(),
      })
      .where(eq(calls.externalId, externalId.trim()))
      .returning({
        externalId: calls.externalId,
        callerName: calls.callerName,
        callerNameSource: calls.callerNameSource,
        updatedAt: calls.updatedAt,
      });
    if (!updated.length) return reply.code(404).send({ ok: false, error: "CALL_NOT_FOUND" });
    return reply.send({ ok: true, call: updated[0] });
  } catch (err: any) {
    request.log.error({ err, externalId }, "Failed to update caller name");
    return reply.code(503).send({ ok: false, error: "DATABASE_URL not configured" });
  }
});

app.get("/tasks", async (request, reply) => {
  const { state, limit } = request.query as { state?: string; limit?: string };
  const safeState = state?.trim() || "confirmed";
  const parsedLimit = Number(limit);
  const safeLimit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 100;
  try {
    const { db } = getDb();
    const rows = await db
      .select({
        id: callTasksSuggested.id,
        callId: calls.id,
        externalId: calls.externalId,
        when: calls.startedAt,
        fromNumber: calls.fromNumber,
        callerName: calls.callerName,
        title: callTasksSuggested.title,
        description: callTasksSuggested.description,
        assigneeSuggestion: callTasksSuggested.assigneeSuggestion,
        dueAt: callTasksSuggested.dueAt,
        priority: callTasksSuggested.priority,
        status: callTasksSuggested.status,
        confidence: callTasksSuggested.confidence,
        evidenceQuotes: callTasksSuggested.evidenceQuotes,
      })
      .from(callTasksSuggested)
      .innerJoin(calls, eq(callTasksSuggested.callId, calls.id))
      .where(eq(callTasksSuggested.state, safeState))
      .orderBy(desc(calls.startedAt))
      .limit(safeLimit);

    return reply.send({
      ok: true,
      state: safeState,
      tasks: rows.map((r) => ({
        id: r.id,
        callId: r.callId,
        externalId: r.externalId,
        when: r.when,
        fromNumber: r.fromNumber,
        callerName: r.callerName,
        title: r.title,
        description: r.description,
        assigneeSuggestion: r.assigneeSuggestion,
        dueAt: r.dueAt,
        priority: r.priority,
        status: r.status,
        confidence: toNumberOrNull(r.confidence),
        evidenceQuotes: Array.isArray(r.evidenceQuotes) ? r.evidenceQuotes : [],
      })),
    });
  } catch (err: any) {
    request.log.error({ err }, "Failed to fetch tasks");
    return reply.code(503).send({ ok: false, error: "DATABASE_URL not configured" });
  }
});

app.patch("/calls/:externalId/notes", async (request, reply) => {
  const { externalId } = request.params as { externalId?: string };
  const body = (request.body ?? {}) as { notes?: unknown };

  if (typeof externalId !== "string" || !externalId.trim()) {
    return reply.code(400).send({ ok: false, error: "INVALID_EXTERNAL_ID" });
  }

  if (typeof body.notes !== "string") {
    return reply.code(400).send({ ok: false, error: "INVALID_NOTES" });
  }

  const normalized = body.notes.trim();
  if (normalized.length > MAX_CALL_NOTES_LENGTH) {
    return reply.code(400).send({
      ok: false,
      error: "NOTES_TOO_LONG",
      maxLength: MAX_CALL_NOTES_LENGTH,
    });
  }

  try {
    const { db } = getDb();
    const updated = await db
      .update(calls)
      .set({
        notes: normalized.length ? normalized : null,
        updatedAt: new Date(),
      })
      .where(eq(calls.externalId, externalId.trim()))
      .returning({
        externalId: calls.externalId,
        notes: calls.notes,
        updatedAt: calls.updatedAt,
      });

    if (!updated.length) {
      return reply.code(404).send({ ok: false, error: "CALL_NOT_FOUND" });
    }

    return reply.send({ ok: true, call: updated[0] });
  } catch (err: any) {
    request.log.error({ err, externalId }, "Failed to update call notes");
    return reply.code(503).send({ ok: false, error: "DATABASE_URL not configured" });
  }
});

app.patch("/calls/:externalId/delete", async (request, reply) => {
  const { externalId } = request.params as { externalId?: string };
  if (typeof externalId !== "string" || !externalId.trim()) {
    return reply.code(400).send({ ok: false, error: "INVALID_EXTERNAL_ID" });
  }
  try {
    const { db } = getDb();
    const updated = await db
      .update(calls)
      .set({
        status: DELETED_CALL_STATUS,
        updatedAt: new Date(),
      })
      .where(eq(calls.externalId, externalId.trim()))
      .returning({
        externalId: calls.externalId,
        status: calls.status,
        updatedAt: calls.updatedAt,
      });
    if (!updated.length) return reply.code(404).send({ ok: false, error: "CALL_NOT_FOUND" });
    return reply.send({ ok: true, call: updated[0] });
  } catch (err: any) {
    request.log.error({ err, externalId }, "Failed to soft-delete call");
    return reply.code(503).send({ ok: false, error: "DATABASE_URL not configured" });
  }
});

const port = Number(process.env.PORT || 8080);
const host = "0.0.0.0";

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
