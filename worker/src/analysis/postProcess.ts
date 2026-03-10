import type { AnalysisOutput } from "./schema.js";
import { CALL_CATEGORY_TAGS, type CallCategoryTag } from "./schema.js";

type PostProcessInput = {
  transcriptOriginal: string;
  transcriptUserLang: string;
};

function hasEvidenceInTranscript(quotes: string[], text: string) {
  const normalized = text || "";
  return quotes.some((q) => {
    const t = (q || "").trim();
    return t.length > 0 && normalized.includes(t);
  });
}

export function postProcess(output: AnalysisOutput, input: PostProcessInput): AnalysisOutput {
  const combined = `${input.transcriptOriginal || ""}\n${input.transcriptUserLang || ""}`;

  const tasks: AnalysisOutput["tasks"] = output.tasks.map((task): AnalysisOutput["tasks"][number] => {
    const evidenceOk =
      Array.isArray(task.evidence_quotes) &&
      task.evidence_quotes.length > 0 &&
      hasEvidenceInTranscript(task.evidence_quotes, combined);
    if (evidenceOk) return task;
    return {
      ...task,
      status: "info_needed",
      confidence: Math.min(task.confidence, 0.4),
    };
  });

  const participants: AnalysisOutput["participants"] = output.participants.map(
    (p): AnalysisOutput["participants"][number] => {
    const evidenceOk =
      Array.isArray(p.evidence_quotes) &&
      p.evidence_quotes.length > 0 &&
      hasEvidenceInTranscript(p.evidence_quotes, combined);
    if (!p.name) return p;
    if (evidenceOk) return p;
    return {
      ...p,
      name: null,
      confidence: Math.min(p.confidence, 0.35),
    };
  });

  const normalizedTagsMap = new Map<CallCategoryTag, number>();
  output.tags.forEach((tag) => {
    if (!CALL_CATEGORY_TAGS.includes(tag.tag)) return;
    const key = tag.tag as CallCategoryTag;
    const prev = normalizedTagsMap.get(key) ?? 0;
    normalizedTagsMap.set(key, Math.max(prev, tag.confidence));
  });
  const tags: AnalysisOutput["tags"] = Array.from(normalizedTagsMap.entries())
    .map(([tag, confidence]) => ({ tag, confidence }))
    .sort((a, b) => b.confidence - a.confidence);
  if (tags.length === 0) {
    tags.push({ tag: "Miscellaneous", confidence: 0.55 });
  }

  return {
    ...output,
    tasks,
    tags,
    participants,
  };
}

