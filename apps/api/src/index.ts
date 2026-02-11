import Fastify from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import rawBody from "fastify-raw-body";
import { desc } from "drizzle-orm";
import twilio from "twilio";
import { getDb } from "./db.js";
import { calls } from "./schema.js";
import { enqueueRecordingJob } from "./queues/recordingQueue.js";

const TWILIO_RECORDING_PATH = "/webhooks/twilio/recording";

function joinPublicUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, "")}${path}`;
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

    if (
      typeof accountSid !== "string" ||
      typeof callSid !== "string" ||
      typeof recordingSid !== "string" ||
      typeof recordingStatus !== "string"
    ) {
      return reply.code(400).send({ ok: false });
    }

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
  const { limit } = request.query as { limit?: string };
  const parsed = Number(limit);
  const safeLimit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 50) : 6;

  try {
    const { db } = getDb();
    const rows = await db
      .select()
      .from(calls)
      .orderBy(desc(calls.startedAt))
      .limit(safeLimit);

    reply.send(rows);
  } catch (err: any) {
    request.log.error({ err }, "Database not configured for /calls");
    reply.code(503).send({ ok: false, error: "DATABASE_URL not configured" });
  }
});

const port = Number(process.env.PORT || 8080);
const host = "0.0.0.0";

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
