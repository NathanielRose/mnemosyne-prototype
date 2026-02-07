import "dotenv/config";
import { Worker } from "bullmq";
import { Redis } from "ioredis";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("REDIS_URL is required for the worker.");
}

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

const worker = new Worker(
  "recording_jobs",
  async (job) => {
    console.log("[worker] job received", {
      id: job.id,
      name: job.name,
      attemptsMade: job.attemptsMade,
      data: job.data,
    });

    // Phase 1: do nothing except log
    return { ok: true };
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

