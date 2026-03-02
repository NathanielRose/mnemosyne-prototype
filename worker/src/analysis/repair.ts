import { type AnalysisOutput, validateAnalysisJson } from "./schema.js";

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function resolveAnalysisAfterRepair(params: {
  firstRaw: string;
  repairedRaw: string;
}):
  | { ok: true; analysis: AnalysisOutput; repaired: boolean }
  | { ok: false; errors: string[] } {
  const firstParsed = safeJsonParse(params.firstRaw);
  const firstValidation = validateAnalysisJson(firstParsed);
  if (firstValidation.ok) {
    return { ok: true, analysis: firstValidation.value, repaired: false };
  }

  const repairedParsed = safeJsonParse(params.repairedRaw);
  const repairedValidation = validateAnalysisJson(repairedParsed);
  if (repairedValidation.ok) {
    return { ok: true, analysis: repairedValidation.value, repaired: true };
  }

  return {
    ok: false,
    errors: [...firstValidation.errors, ...repairedValidation.errors],
  };
}

