export function generatePlaceholderInsights(params: { transcriptText: string; language?: string }) {
  const text = (params.transcriptText ?? "").trim();
  const summary = text.length > 0 ? text.slice(0, 200) : "";

  return {
    intent: "unknown",
    summary,
    action_items: [] as string[],
    confidence: 0,
    language: params.language ?? "unknown",
  };
}

