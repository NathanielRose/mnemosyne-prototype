export type AnalysisSkipReason = "duration_below_threshold" | "transcript_too_short";

export function evaluateAnalysisGate(params: {
  durationSec: number;
  thresholdSec: number;
  transcriptOriginal: string;
  transcriptUserLang: string;
  minCombinedChars?: number;
}) {
  const minCombinedChars = params.minCombinedChars ?? 200;
  const durationSec = Number.isFinite(params.durationSec) ? Math.max(0, params.durationSec) : 0;
  const thresholdSec = Number.isFinite(params.thresholdSec) ? Math.max(0, params.thresholdSec) : 30;
  const original = (params.transcriptOriginal || "").trim();
  const userLang = (params.transcriptUserLang || "").trim();
  const combinedChars = original.length + userLang.length;

  if (durationSec < thresholdSec) {
    return {
      run: false as const,
      analysisStatus: "skipped_short_call" as const,
      analysisReason: "duration_below_threshold" as const,
      combinedChars,
      thresholdSec,
    };
  }

  if (combinedChars < minCombinedChars) {
    return {
      run: false as const,
      analysisStatus: "skipped_short_call" as const,
      analysisReason: "transcript_too_short" as const,
      combinedChars,
      thresholdSec,
    };
  }

  return {
    run: true as const,
    combinedChars,
    thresholdSec,
  };
}

