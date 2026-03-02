import { analyzeTranscriptWithRepair } from "./client.js";
import {
  getAnalysisContextByCallSid,
  markAnalysisFailed,
  markAnalysisFailedInvalidJson,
  markAnalysisRunning,
  markAnalysisSkipped,
  saveSuggestedAnalysis,
} from "./db.js";
import { evaluateAnalysisGate } from "./gate.js";
import { buildTranscriptHash } from "./hash.js";
import { postProcess } from "./postProcess.js";
import { buildAnalysisPrompt } from "./prompt.js";

function parseThresholdFromEnv() {
  const raw = process.env.LLM_MIN_DURATION_SEC;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  return 30;
}

function errorToString(err: unknown) {
  if (err instanceof Error) return err.stack || err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export async function runCallAnalysisJob(jobData: any) {
  const callSid = typeof jobData?.callSid === "string" ? jobData.callSid : "";
  const recordingSid = typeof jobData?.recordingSid === "string" ? jobData.recordingSid : "";
  if (!callSid) throw new Error("call_analyze_transcript missing callSid");

  const thresholdSec = parseThresholdFromEnv();
  const context = await getAnalysisContextByCallSid(callSid);
  if (!context) {
    throw new Error(`call_analyze_transcript call not found for callSid=${callSid}`);
  }

  try {
    await markAnalysisRunning({ callId: context.callId, thresholdSec });
    const gate = evaluateAnalysisGate({
      durationSec: context.durationSec,
      thresholdSec,
      transcriptOriginal: context.transcriptOriginal,
      transcriptUserLang: context.transcriptUserLang,
    });
    if (!gate.run) {
      await markAnalysisSkipped({
        callId: context.callId,
        reason: gate.analysisReason,
        thresholdSec,
      });
      if (gate.analysisReason === "duration_below_threshold") {
        console.log("[analysis] skipped_short_call", {
          callId: context.callId,
          callSid,
          recordingSid,
          durationSec: context.durationSec,
          thresholdSec,
        });
      } else {
        console.log("[analysis] transcript_too_short", {
          callId: context.callId,
          callSid,
          recordingSid,
          combinedChars: gate.combinedChars,
          minChars: 200,
        });
      }
      return { ok: true, skipped: true, reason: gate.analysisReason };
    }

    const transcriptHash = buildTranscriptHash({
      transcriptOriginal: context.transcriptOriginal,
      transcriptUserLang: context.transcriptUserLang,
    });

    if (context.analysisStatus === "success" && context.transcriptHash === transcriptHash) {
      console.log("[analysis] analysis_success", {
        callId: context.callId,
        callSid,
        recordingSid,
        skipped: true,
        reason: "already_analyzed_same_hash",
      });
      return { ok: true, skipped: true, reason: "already_analyzed_same_hash" };
    }

    const prompt = buildAnalysisPrompt({
      transcriptOriginal: context.transcriptOriginal,
      transcriptUserLang: context.transcriptUserLang,
      metadata: {
        callSid,
        recordingSid,
        durationSec: context.durationSec,
        fromNumber: context.fromNumber,
        toNumber: context.toNumber,
      },
    });

    const llm = await analyzeTranscriptWithRepair({
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
    });

    if (!llm.ok) {
      await markAnalysisFailedInvalidJson({
        callId: context.callId,
        thresholdSec,
        rawOutput: llm.rawOutput,
        repairedRawOutput: llm.repairedRawOutput,
        reasonDetails: llm.errors.join("; "),
      });
      console.error("[analysis] analysis_failed_invalid_json", {
        callId: context.callId,
        callSid,
        recordingSid,
        model: llm.model,
        errors: llm.errors,
      });
      return { ok: false, reason: "failed_invalid_json" };
    }

    const processed = postProcess(llm.analysis, {
      transcriptOriginal: context.transcriptOriginal,
      transcriptUserLang: context.transcriptUserLang,
    });

    await saveSuggestedAnalysis({
      callId: context.callId,
      transcriptHash,
      model: llm.model,
      thresholdSec,
      analysis: processed,
    });

    console.log("[analysis] analysis_success", {
      callId: context.callId,
      callSid,
      recordingSid,
      model: llm.model,
      usage: llm.usage,
      repaired: llm.repaired,
    });
    return { ok: true };
  } catch (err) {
    await markAnalysisFailed({
      callId: context.callId,
      thresholdSec,
      reason: "analysis_runtime_error",
      rawOutput: errorToString(err),
    });
    throw err;
  }
}

