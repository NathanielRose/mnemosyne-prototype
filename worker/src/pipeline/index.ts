import fs from "node:fs";
import type { Job } from "bullmq";
import { downloadRecording } from "./download.js";
import {
  getInsightsByRecordingId,
  getRecordingBySid,
  getTranscriptByRecordingId,
  insertInsights,
  insertTranscript,
  markCompleted,
  markFailed,
  markRecordingDownloaded,
  updateCallLanguageDetected,
  updateCallPostProcessing,
  upsertCallAndRecording,
} from "./db.js";
import { generatePlaceholderInsights } from "./insights.js";
import { transcribeWhisper } from "./transcribe.js";
import { completeStep, failStep, finishRun, startRun, startStep } from "./track.js";

function errorToString(err: unknown) {
  if (err instanceof Error) return err.stack || err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function normalizeLanguage(lang: string) {
  const l = (lang || "").toLowerCase();
  if (l.startsWith("en")) return "English";
  if (l.startsWith("el") || l.startsWith("gr") || l.includes("greek")) return "Greek";
  return "English";
}

function formatDetectedLanguage(lang: string) {
  const raw = (lang || "").trim();
  if (!raw) return "unknown";
  if (raw.length <= 3) return raw.toUpperCase();
  return raw[0]!.toUpperCase() + raw.slice(1).toLowerCase();
}

export async function runPipeline(job: Job) {
  const data: any = job.data ?? {};
  const callSid = typeof data.callSid === "string" ? data.callSid : "";
  const recordingSid = typeof data.recordingSid === "string" ? data.recordingSid : "";
  const recordingUrl = typeof data.recordingUrl === "string" && data.recordingUrl.length > 0 ? data.recordingUrl : undefined;

  const jobId = job.id != null ? String(job.id) : null;
  const attempt = (job.attemptsMade ?? 0) + 1;

  if (!callSid) throw new Error("Job payload missing callSid.");
  if (!recordingSid) throw new Error("Job payload missing recordingSid.");

  const { runId } = await startRun({ recordingSid, jobId, attempt });

  const logBase = { jobId, runId, callSid, recordingSid, attempt };
  console.log("[pipeline] run started", logBase);

  const { callId, recordingId } = await upsertCallAndRecording({
    callSid,
    recordingSid,
    recordingUrl,
    fromNumber: typeof data.fromNumber === "string" ? data.fromNumber : undefined,
    toNumber: typeof data.toNumber === "string" ? data.toNumber : undefined,
    durationSec: typeof data.durationSec === "number" ? data.durationSec : undefined,
    receivedAtIso: typeof data.receivedAt === "string" ? data.receivedAt : undefined,
  });

  try {
    // STEP: download_recording
    {
      const { stepId, alreadyCompleted } = await startStep({
        runId,
        step: "download_recording",
      });

      try {
        const recording = await getRecordingBySid(recordingSid);
        if (recording?.localPath && recording.downloadedAt && fs.existsSync(recording.localPath)) {
          if (!alreadyCompleted) {
            await completeStep({
              stepId,
              meta: { skipped: true, reason: "already_downloaded", localPath: recording.localPath },
            });
          }
        } else {
          if (!recordingUrl) throw new Error("recordingUrl is required to download media.");
          const accountSid =
            (typeof data.accountSid === "string" && data.accountSid.length > 0
              ? data.accountSid
              : process.env.TWILIO_ACCOUNT_SID) ?? "";
          const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";

          if (!accountSid) throw new Error("TWILIO_ACCOUNT_SID (or job.accountSid) is required to download media.");
          if (!authToken) throw new Error("TWILIO_AUTH_TOKEN is required to download media.");

          const dl = await downloadRecording({
            recordingUrl,
            accountSid,
            authToken,
            recordingSid,
          });

          await markRecordingDownloaded({
            recordingId,
            localPath: dl.localPath,
            downloadedAt: new Date(),
          });

          await completeStep({
            stepId,
            meta: { skipped: false, localPath: dl.localPath, bytesWritten: dl.bytesWritten, format: dl.format },
          });
        }
      } catch (err) {
        await failStep({ stepId, error: err });
        throw err;
      }
    }

    const recordingAfterDownload = await getRecordingBySid(recordingSid);
    const localPath = recordingAfterDownload?.localPath ?? null;
    if (!localPath) throw new Error("download_recording did not produce a localPath.");

    // STEP: transcribe_whisper
    let transcriptText = "";
    let transcriptLang = "English";
    let transcriptDetectedLanguage = "unknown";
    let transcriptEnglishText = "";
    {
      const { stepId, alreadyCompleted } = await startStep({
        runId,
        step: "transcribe_whisper",
      });

      try {
        const existing = await getTranscriptByRecordingId(recordingId);
        if (existing?.id) {
          transcriptText = existing.content ?? "";
          if (!alreadyCompleted) {
            await completeStep({ stepId, meta: { skipped: true, reason: "already_transcribed", transcriptId: existing.id } });
          }
        } else {
          const tr = await transcribeWhisper({ localPath });
          transcriptText = tr.text;
          transcriptDetectedLanguage = formatDetectedLanguage(tr.language);
          transcriptLang = normalizeLanguage(tr.language);
          transcriptEnglishText = tr.englishText ?? "";

          const transcriptId = await insertTranscript({
            callId,
            recordingId,
            content: transcriptText,
            language: transcriptLang,
            detectedLanguage: transcriptDetectedLanguage,
            contentEn: transcriptEnglishText,
            rawJson: tr.rawResponse,
            rawJsonEn: tr.rawTranslation,
          });

          await updateCallLanguageDetected({
            callId,
            language: transcriptLang,
            detectedLanguage: transcriptDetectedLanguage,
          });

          await completeStep({
            stepId,
            meta: {
              skipped: false,
              transcriptId,
              chars: transcriptText.length,
              language: transcriptLang,
              detectedLanguage: transcriptDetectedLanguage,
              englishChars: transcriptEnglishText.length,
            },
          });
        }
      } catch (err) {
        await failStep({ stepId, error: err });
        throw err;
      }
    }

    // STEP: analyze_llm (placeholder insights)
    let insightsSummary = "";
    {
      const { stepId, alreadyCompleted } = await startStep({
        runId,
        step: "analyze_llm",
      });

      try {
        const existing = await getInsightsByRecordingId(recordingId);
        if (existing?.id) {
          if (!alreadyCompleted) {
            await completeStep({ stepId, meta: { skipped: true, reason: "already_analyzed", insightsId: existing.id } });
          }
        } else {
          const insightsSourceText = transcriptEnglishText?.trim().length
            ? transcriptEnglishText
            : transcriptText;

          const data = generatePlaceholderInsights({ transcriptText: insightsSourceText, language: transcriptLang });
          insightsSummary = typeof data.summary === "string" ? data.summary : "";
          const insightsId = await insertInsights({ recordingId, data });
          await completeStep({ stepId, meta: { skipped: false, insightsId } });
        }
      } catch (err) {
        await failStep({ stepId, error: err });
        throw err;
      }
    }

    // STEP: persist_db
    {
      const { stepId, alreadyCompleted } = await startStep({
        runId,
        step: "persist_db",
      });

      try {
        if (!alreadyCompleted) {
          await updateCallPostProcessing({
            callId,
            transcriptText: transcriptEnglishText?.trim().length ? transcriptEnglishText : transcriptText,
            summary: insightsSummary,
            detectedLanguage: transcriptDetectedLanguage,
            language: transcriptLang,
          });
          await markCompleted({ callId, recordingId });
          await completeStep({ stepId, meta: { skipped: false } });
        }
      } catch (err) {
        await failStep({ stepId, error: err });
        throw err;
      }
    }

    await finishRun({ runId, status: "completed" });
    console.log("[pipeline] run completed", { ...logBase, callId, recordingId });
    return { ok: true, runId, callId, recordingId };
  } catch (err) {
    const msg = errorToString(err);
    await markFailed({ callId, recordingId, error: msg });
    await finishRun({ runId, status: "failed" });
    console.error("[pipeline] run failed", { ...logBase, error: msg });
    throw err;
  }
}

