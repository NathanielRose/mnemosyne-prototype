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
    "",
    "TAG MODEL (two tiers):",
    "1. `tags` — TOP-LEVEL categories. Closed vocabulary, pick one or more from:",
    "   Reservations, Special Requests, Inquiries, Miscellaneous.",
    "   Definitions:",
    "   - Reservations: the call resulted in a room booking being made, confirmed, or modified.",
    "   - Special Requests: an EXISTING reservation is asking for something before arrival (early check-in, crib, allergy, airport pickup, etc.) or a fee-adjacent ask.",
    "   - Inquiries: caller asks for information (availability, price, amenities, dates) but does NOT book.",
    "   - Miscellaneous: call is unrelated to reservations/inquiries (sales pitch, wrong number, vendor outreach, etc.).",
    "   A call can carry multiple top-level tags (e.g. Reservations + Special Requests).",
    "2. `detail_tags` — free-form, short (1-3 words) descriptive labels shown only in the call detail view.",
    "   Examples: \"late check-in\", \"parking\", \"breakfast included\", \"vegetarian\", \"pet-friendly\", \"wedding block\", \"airport transfer\".",
    "   Emit 0-6 detail tags. Keep them lowercase, noun-phrase-style.",
    "",
    "SUMMARY GUIDANCE (prose, not structured fields):",
    "`summary_detailed` MUST adapt to the top-level tags:",
    "- If tags include Reservations: mention caller name (or 'unknown'), room type + how many rooms and for how many guests, dates (check-in/check-out), and price if stated.",
    "- If tags include Special Requests: describe the request(s) clearly and any fees discussed.",
    "- If tags include Inquiries: mention caller name (or 'unknown'), room type asked about, dates they asked about, and price they were quoted or asked for.",
    "- If tags include Miscellaneous: one sentence describing the topic (who called, what they wanted).",
    "If multiple tags apply, cover each in its own sentence.",
    "`summary_short` stays one line, max ~20 words.",
    "",
    "Return only JSON matching the requested schema.",
  ].join(" ");
}

export function buildAnalysisPrompt(input: PromptInput) {
  return {
    system: buildAnalysisSystemPrompt(),
    user: [
      "Analyze this phone call transcript and produce SUGGESTED (not confirmed) outputs.",
      "Use evidence quotes exactly as text snippets from the transcript.",
      "Top-level `tags` must be from: Reservations, Special Requests, Inquiries, Miscellaneous. Output at least one.",
      "`detail_tags` are free-form lowercase phrases; emit 0-6.",
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
          detail_tags: [{ tag: "short free-form phrase", confidence: 0.0 }],
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
