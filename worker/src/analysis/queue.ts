import { Queue } from "bullmq";

const ANALYSIS_JOB_NAME = "call_analyze_transcript";
const RECORDING_QUEUE = "recording_jobs";

function connectionFromRedisUrl(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port || "6379", 10),
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null as null,
    family: 0 as 0,
  };
}

let queue: Queue | null = null;

function getQueue() {
  if (queue) return queue;
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("REDIS_URL is required to enqueue analysis jobs.");
  queue = new Queue(RECORDING_QUEUE, { connection: connectionFromRedisUrl(redisUrl) });
  return queue;
}

export async function enqueueAnalysisJob(params: {
  callSid: string;
  recordingSid: string;
  callId: string;
}) {
  const q = getQueue();
  const job = await q.add(
    ANALYSIS_JOB_NAME,
    {
      callSid: params.callSid,
      recordingSid: params.recordingSid,
      callId: params.callId,
      enqueuedAt: new Date().toISOString(),
    },
    {
      attempts: 2,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 25,
      removeOnFail: 100,
    }
  );
  return { jobId: job.id != null ? String(job.id) : null };
}

export { ANALYSIS_JOB_NAME, RECORDING_QUEUE };

