import "dotenv/config";
import { Queue } from "bullmq";

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

function randomId(prefix: string) {
  return `${prefix}${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`.slice(0, 34);
}

function connectionFromRedisUrl(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port || "6379", 10),
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null,
    family: 0,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const redisUrl = args["redis-url"] ?? process.env.REDIS_URL;
  if (!redisUrl) throw new Error("REDIS_URL (or --redis-url) is required.");

  const queueName = args["queue"] ?? "recording_jobs";
  const jobName = args["name"] ?? "twilio_recording_completed";

  const accountSid = args["account-sid"] ?? process.env.TWILIO_ACCOUNT_SID ?? "AC_TEST";
  const callSid = args["call-sid"] ?? randomId("CA");
  const recordingSid = args["recording-sid"] ?? randomId("RE");
  const jobId = args["job-id"] ?? recordingSid;
  const recordingUrl = args["recording-url"] ?? process.env.RECORDING_URL;
  const fromNumber = args["from"] ?? "+15551234567";
  const toNumber = args["to"] ?? "+15557654321";
  const durationSec = parseInt(args["duration"] ?? "45", 10) || 45;

  const queue = new Queue(queueName, { connection: connectionFromRedisUrl(redisUrl) });

  const payload = {
    accountSid,
    callSid,
    recordingSid,
    recordingStatus: "completed",
    receivedAt: new Date().toISOString(),
    recordingUrl,
    fromNumber,
    toNumber,
    durationSec,
    publicWebhookUrl: args["public-webhook-url"] ?? process.env.PUBLIC_WEBHOOK_URL ?? "http://localhost:8080",
    rawBody: {
      AccountSid: accountSid,
      CallSid: callSid,
      RecordingSid: recordingSid,
      RecordingStatus: "completed",
      RecordingUrl: recordingUrl,
      RecordingDuration: String(durationSec),
      From: fromNumber,
      To: toNumber,
    },
  };

  const job = await queue.add(jobName, payload, {
    jobId,
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 25,
    removeOnFail: 100,
  });

  console.log("[enqueue] job added", {
    queueName,
    jobName,
    id: job.id,
    jobId,
    recordingSid,
    callSid,
    recordingUrl,
    fromNumber,
    toNumber,
    durationSec,
  });
  await queue.close();
}

main().catch((err) => {
  console.error("[enqueue] failed", err);
  process.exitCode = 1;
});

