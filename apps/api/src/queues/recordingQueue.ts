import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const RECORDING_QUEUE_NAME = "recording_jobs";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("REDIS_URL is required for BullMQ producer.");
}

// BullMQ recommends ioredis with maxRetriesPerRequest=null
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

export const recordingQueue = new Queue(RECORDING_QUEUE_NAME, { connection });

export type RecordingJobPayload = {
  accountSid: string;
  callSid: string;
  recordingSid: string;
  recordingStatus: string;
  receivedAt: string;
  rawBody?: string;
  publicWebhookUrl: string;
};

export async function enqueueRecordingJob(payload: RecordingJobPayload) {
  try {
    const job = await recordingQueue.add("twilio_recording_completed", payload, {
      jobId: payload.recordingSid,
      attempts: 5,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });

    return { ok: true as const, jobId: job.id };
  } catch (err: any) {
    // BullMQ throws on duplicate jobId. We treat this as idempotent success.
    const msg = String(err?.message ?? err);
    if (msg.toLowerCase().includes("already exists")) {
      return { ok: true as const, jobId: payload.recordingSid, duplicated: true as const };
    }
    throw err;
  }
}

