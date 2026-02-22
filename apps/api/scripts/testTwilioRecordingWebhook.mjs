import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { URLSearchParams } from "node:url";

function joinPublicUrl(base, path) {
  return `${String(base).replace(/\/+$/, "")}${path}`;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = "true";
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function randomId(prefix) {
  return `${prefix}${crypto.randomBytes(8).toString("hex")}`;
}

function computeTwilioSignature({ authToken, webhookUrl, params }) {
  const keys = Object.keys(params).sort();
  const data = webhookUrl + keys.map((k) => `${k}${params[k] ?? ""}`).join("");
  return crypto.createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const authToken = args["auth-token"] ?? process.env.TWILIO_AUTH_TOKEN;
  const publicBase = args["public-base"] ?? process.env.PUBLIC_WEBHOOK_URL ?? "http://localhost:8080";
  const apiBase = args["api-base"] ?? "http://localhost:8080";

  if (!authToken) {
    console.error(
      "Missing auth token. Set TWILIO_AUTH_TOKEN or pass --auth-token <token>.\n" +
        "Example: TWILIO_AUTH_TOKEN=test_auth_token node scripts/testTwilioRecordingWebhook.mjs"
    );
    process.exit(2);
  }

  const path = "/webhooks/twilio/recording";
  const webhookUrl = joinPublicUrl(publicBase, path);
  const requestUrl = joinPublicUrl(apiBase, path);

  const params = {
    AccountSid: args["account-sid"] ?? "AC123",
    CallSid: args["call-sid"] ?? "CA456",
    RecordingSid: args["recording-sid"] ?? randomId("RE"),
    RecordingStatus: args["recording-status"] ?? "completed",
    RecordingUrl:
      args["recording-url"] ??
      "https://api.twilio.com/2010-04-01/Accounts/AC123/Recordings/RE123",
    RecordingDuration: args["recording-duration"] ?? "45",
    From: args["from"] ?? "+15551234567",
    To: args["to"] ?? "+15557654321",
    Direction: args["direction"] ?? "inbound",
  };

  const signature = computeTwilioSignature({ authToken, webhookUrl, params });
  const body = new URLSearchParams(params).toString();

  const url = new URL(requestUrl);
  const transport = url.protocol === "https:" ? https : http;

  const options = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    path: url.pathname + url.search,
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "content-length": Buffer.byteLength(body),
      "x-twilio-signature": signature,
    },
  };

  console.log("[test] POST", requestUrl);
  console.log("[test] webhookUrl used for signature:", webhookUrl);
  console.log("[test] x-twilio-signature:", signature);
  console.log("[test] body:", body);

  await new Promise((resolve, reject) => {
    const req = transport.request(options, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        console.log("[test] status:", res.statusCode);
        console.log("[test] response:", data);
        resolve();
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

main().catch((err) => {
  console.error("[test] error:", err);
  process.exit(1);
});

