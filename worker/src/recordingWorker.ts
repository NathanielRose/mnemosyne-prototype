import "dotenv/config";
import { Worker } from "bullmq";
import { runPipeline } from "./pipeline/index.js";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("REDIS_URL is required for the worker.");
}

// Pass connection options (not a Redis instance) to avoid ioredis version mismatch
// between worker deps and BullMQ's bundled ioredis.
const url = new URL(redisUrl);
const connection = {
  host: url.hostname,
  port: parseInt(url.port || "6379", 10),
  username: url.username || undefined,
  password: url.password || undefined,
  maxRetriesPerRequest: null,
  // Railway private network uses IPv6; family: 0 allows both IPv4 and IPv6.
  family: 0,
};

const worker = new Worker(
  "recording_jobs",
  async (job) => {
    const { recordingUrl, recordingSid, callSid } = job.data as any;
    console.log("[worker] job received", {
      id: job.id,
      name: job.name,
      attemptsMade: job.attemptsMade,
      recordingSid,
      callSid,
      recordingUrl,
    });

    return await runPipeline(job);
  },
  {
    connection,
    concurrency: 5,
  }
);

worker.on("completed", (job) => {
  console.log("[worker] job completed", { id: job.id, name: job.name });
});

worker.on("failed", (job, err) => {
  console.error("[worker] job failed", { id: job?.id, name: job?.name, err });
});

console.log("[worker] listening for recording_jobs");

