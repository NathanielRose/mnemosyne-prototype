import fs from "node:fs";
import OpenAI from "openai";

export async function transcribeWhisper(params: { localPath: string; apiKey?: string }) {
  const apiKey = params.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required to transcribe.");

  const client = new OpenAI({ apiKey });

  const res: any = await client.audio.transcriptions.create({
    file: fs.createReadStream(params.localPath),
    model: "whisper-1",
    response_format: "verbose_json",
  });

  const text = typeof res?.text === "string" ? res.text : "";
  const language = typeof res?.language === "string" ? res.language : "unknown";

  const translationRes: any = await client.audio.translations.create({
    file: fs.createReadStream(params.localPath),
    model: "whisper-1",
  });
  const englishText = typeof translationRes?.text === "string" ? translationRes.text : "";

  return {
    text,
    language,
    rawResponse: res,
    englishText,
    rawTranslation: translationRes,
  };
}

