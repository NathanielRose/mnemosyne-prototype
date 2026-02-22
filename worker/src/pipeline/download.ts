import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

function ensureTrailingNoSlash(url: string) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function buildAuthHeader(accountSid: string, authToken: string) {
  const token = Buffer.from(`${accountSid}:${authToken}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

async function fetchToFile(params: {
  url: string;
  destPath: string;
  authHeader: string;
  accept?: string;
}) {
  const res = await fetch(params.url, {
    method: "GET",
    headers: {
      Authorization: params.authHeader,
      "User-Agent": "mnemosyne-worker",
      ...(params.accept ? { Accept: params.accept } : {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(
      `Twilio download failed (${res.status}) for ${params.url}${text ? `: ${text}` : ""}`
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  if (!res.body) throw new Error(`Twilio download response had no body for ${params.url}`);

  fs.mkdirSync(path.dirname(params.destPath), { recursive: true });

  const tmpPath = `${params.destPath}.tmp`;
  const file = fs.createWriteStream(tmpPath);
  try {
    // Convert Web stream -> Node stream for pipeline()
    const body = Readable.fromWeb(res.body as any);
    await pipeline(body, file);
    fs.renameSync(tmpPath, params.destPath);
  } finally {
    try {
      file.close();
    } catch {
      // ignore
    }
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // ignore
      }
    }
  }

  const stat = fs.statSync(params.destPath);
  return { bytesWritten: stat.size };
}

export async function downloadRecording(params: {
  recordingUrl: string;
  accountSid: string;
  authToken: string;
  recordingSid: string;
  recordingsDir?: string;
}) {
  const baseUrl = ensureTrailingNoSlash(params.recordingUrl);
  const recordingsDir = params.recordingsDir ?? "/app/recordings";

  const authHeader = buildAuthHeader(params.accountSid, params.authToken);

  const accountDir = path.join(recordingsDir, params.accountSid);
  const mp3Path = path.join(accountDir, `${params.recordingSid}.mp3`);
  const wavPath = path.join(accountDir, `${params.recordingSid}.wav`);

  const candidates: Array<{
    url: string;
    destPath: string;
    format: "mp3" | "wav";
    accept: string;
  }> = [
    { url: `${baseUrl}.mp3`, destPath: mp3Path, format: "mp3", accept: "audio/mpeg" },
    { url: `${baseUrl}.wav`, destPath: wavPath, format: "wav", accept: "audio/wav" },
    // Some environments require explicit download param.
    { url: `${baseUrl}.mp3?Download=true`, destPath: mp3Path, format: "mp3", accept: "audio/mpeg" },
    { url: `${baseUrl}.wav?Download=true`, destPath: wavPath, format: "wav", accept: "audio/wav" },
    { url: `${baseUrl}?Download=true`, destPath: mp3Path, format: "mp3", accept: "audio/mpeg" },
  ];

  let lastErr: unknown = null;
  for (const c of candidates) {
    try {
      const { bytesWritten } = await fetchToFile({
        url: c.url,
        destPath: c.destPath,
        authHeader,
        accept: c.accept,
      });
      return { localPath: c.destPath, bytesWritten, format: c.format };
    } catch (err: any) {
      // If auth is wrong, stop immediately.
      if (err?.status === 401) throw err;
      lastErr = err;
      // Try next candidate on 403/404/etc.
    }
  }

  throw lastErr ?? new Error("Twilio download failed for all candidate URLs.");
}

