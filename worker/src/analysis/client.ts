import OpenAI from "openai";
import { ANALYSIS_OUTPUT_JSON_SCHEMA, type AnalysisOutput } from "./schema.js";
import { resolveAnalysisAfterRepair } from "./repair.js";

function extractTextContent(res: any): string {
  const direct = res?.choices?.[0]?.message?.content;
  if (typeof direct === "string") return direct;
  if (Array.isArray(direct)) {
    const textPart = direct.find((part) => typeof part?.text === "string");
    if (typeof textPart?.text === "string") return textPart.text;
  }
  return "";
}

async function completeJson(params: {
  client: OpenAI;
  model: string;
  system: string;
  user: string;
}) {
  const res: any = await params.client.chat.completions.create({
    model: params.model,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
  });
  const text = extractTextContent(res);
  return {
    rawText: text,
    usage: res?.usage ?? null,
  };
}

export async function analyzeTranscriptWithRepair(params: {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  apiKey?: string;
}) {
  const apiKey = params.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for transcript analysis.");

  const model = params.model ?? process.env.OPENAI_ANALYSIS_MODEL ?? "gpt-4o-mini";
  const client = new OpenAI({ apiKey });

  const first = await completeJson({
    client,
    model,
    system: params.systemPrompt,
    user: params.userPrompt,
  });
  const firstOnly = resolveAnalysisAfterRepair({
    firstRaw: first.rawText,
    repairedRaw: first.rawText,
  });
  if (firstOnly.ok && !firstOnly.repaired) {
    return {
      ok: true as const,
      analysis: firstOnly.analysis,
      model,
      rawOutput: first.rawText,
      usage: first.usage,
      repaired: false,
    };
  }

  const repairSystem = [
    "You are a strict JSON repair assistant.",
    "Return ONLY valid JSON object that matches the provided schema.",
    "Do not add extra properties.",
  ].join(" ");
  const repairUser = [
    "Fix this JSON to match the schema exactly.",
    "If you cannot know values, use null or info_needed safely.",
    "",
    "Schema:",
    JSON.stringify(ANALYSIS_OUTPUT_JSON_SCHEMA, null, 2),
    "",
    "Invalid JSON/output to repair:",
    first.rawText,
  ].join("\n");

  const repaired = await completeJson({
    client,
    model,
    system: repairSystem,
    user: repairUser,
  });
  const resolved = resolveAnalysisAfterRepair({
    firstRaw: first.rawText,
    repairedRaw: repaired.rawText,
  });
  if (resolved.ok) {
    return {
      ok: true as const,
      analysis: resolved.analysis,
      model,
      rawOutput: resolved.repaired ? repaired.rawText : first.rawText,
      usage: repaired.usage,
      repaired: resolved.repaired,
    };
  }

  return {
    ok: false as const,
    model,
    rawOutput: first.rawText,
    repairedRawOutput: repaired.rawText,
    errors: resolved.errors,
    usage: repaired.usage ?? first.usage ?? null,
  };
}

export type AnalysisClientSuccess = {
  ok: true;
  analysis: AnalysisOutput;
  model: string;
  rawOutput: string;
  usage: unknown;
  repaired: boolean;
};

export type AnalysisClientFailure = {
  ok: false;
  model: string;
  rawOutput: string;
  repairedRawOutput: string;
  errors: string[];
  usage: unknown;
};

