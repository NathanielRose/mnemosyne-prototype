import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const RECORDING_QUEUE_NAME = "recording_jobs";

let recordingQueue: Queue | null = null;

export function getRecordingQueue(): Queue | null {
  if (!recordingQueue) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      return null;
    }

    // BullMQ recommends ioredis with maxRetriesPerRequest=null
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    recordingQueue = new Queue(RECORDING_QUEUE_NAME, { connection });
  }

  return recordingQueue;
}

export type RecordingJobPayload = {
  accountSid: string;
  callSid: string;
  recordingSid: string;
  recordingStatus: string;
  receivedAt: string;
  rawBody?: string;
  publicWebhookUrl: string;
  recordingUrl?: string;
  durationSec?: number;
  fromNumber?: string;
  toNumber?: string;
  direction?: string;
};

export type EnqueueRecordingJobResult =
  | { ok: true; jobId: string; duplicated?: true }
  | { ok: false; error: "REDIS_URL_NOT_CONFIGURED" };

export async function enqueueRecordingJob(payload: RecordingJobPayload) {
  const queue = getRecordingQueue();
  if (!queue) {
    return { ok: false as const, error: "REDIS_URL_NOT_CONFIGURED" as const };
  }

  try {
    const job = await queue.add("twilio_recording_completed", payload, {
      jobId: payload.recordingSid,
      attempts: 5,
      backoff: { type: "exponential", delay: 2_000 },
      // Keep the most recent completed jobs visible in Bull Board.
      removeOnComplete: 25,
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

