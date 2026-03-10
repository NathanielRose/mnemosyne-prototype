type PromptInput = {
  transcriptOriginal: string;
  transcriptUserLang: string;
  metadata: {
    callSid: string;
    recordingSid: string;
    durationSec: number;
    fromNumber?: string | null;
    toNumber?: string | null;
  };
};

export function buildAnalysisSystemPrompt() {
  return [
    "You are a call analysis assistant that outputs STRICT JSON only.",
    "Never invent facts. If not explicitly present in transcript, use null or unknown/info_needed.",
    "Do not infer names, due dates, or tasks from context outside transcript.",
    "Every task must include at least one exact evidence quote from transcript.",
    "Every participant with non-null name must include at least one exact evidence quote.",
    "If evidence is missing, set participant name to null and task/participant status to info_needed.",
    "Confidence must be between 0 and 1.",
    "Classify calls into one or more categories ONLY from this list: Reservations, Special Requests, Inquiries, Miscellaneous.",
    "If none is explicit, use Miscellaneous.",
    "Return only JSON matching the requested schema.",
  ].join(" ");
}

export function buildAnalysisPrompt(input: PromptInput) {
  return {
    system: buildAnalysisSystemPrompt(),
    user: [
      "Analyze this phone call transcript and produce SUGGESTED (not confirmed) outputs.",
      "Use evidence quotes exactly as text snippets from the transcript.",
      "For tags, only output values from: Reservations, Special Requests, Inquiries, Miscellaneous.",
      "Output at least one tag.",
      "",
      "Metadata:",
      JSON.stringify(input.metadata, null, 2),
      "",
      "Transcript (original language):",
      input.transcriptOriginal || "(empty)",
      "",
      "Transcript (user language):",
      input.transcriptUserLang || "(empty)",
      "",
      "Required output JSON shape:",
      JSON.stringify(
        {
          summary_short: "string",
          summary_detailed: "string",
          tasks: [
            {
              title: "string",
              description: "string",
              assignee_suggestion: "string|null",
              due: "string|null",
              priority: "low|medium|high",
              status: "todo|in_progress|blocked|done|info_needed",
              evidence_quotes: ["string"],
              confidence: 0.0,
            },
          ],
          tags: [{ tag: "Reservations|Special Requests|Inquiries|Miscellaneous", confidence: 0.0 }],
          participants: [
            {
              name: "string|null",
              role: "string",
              confidence: 0.0,
              evidence_quotes: ["string"],
            },
          ],
          quality: {
            transcript_reliability: "low|medium|high",
            hallucination_risk: "low|medium|high",
            notes: "string",
          },
        },
        null,
        2
      ),
    ].join("\n"),
  };
}

