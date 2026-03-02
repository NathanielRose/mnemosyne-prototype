import { createHash } from "node:crypto";

export function buildTranscriptHash(params: {
  transcriptOriginal: string;
  transcriptUserLang: string;
}) {
  const original = (params.transcriptOriginal || "").trim();
  const userLang = (params.transcriptUserLang || "").trim();
  return createHash("sha256")
    .update(`${original}\n---\n${userLang}`, "utf8")
    .digest("hex");
}

