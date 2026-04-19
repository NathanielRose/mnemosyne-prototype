export type Confidence = number;
export type Reliability = "low" | "medium" | "high";
export const CALL_CATEGORY_TAGS = [
  "Reservations",
  "Special Requests",
  "Inquiries",
  "Miscellaneous",
] as const;
export type CallCategoryTag = (typeof CALL_CATEGORY_TAGS)[number];

export type AnalysisTask = {
  title: string;
  description: string;
  assignee_suggestion: string | null;
  due: string | null;
  priority: "low" | "medium" | "high";
  status: "todo" | "in_progress" | "blocked" | "done" | "info_needed";
  evidence_quotes: string[];
  confidence: Confidence;
};

export type AnalysisTag = {
  tag: CallCategoryTag;
  confidence: Confidence;
};

export type AnalysisDetailTag = {
  tag: string;
  confidence: Confidence;
};

export type AnalysisParticipant = {
  name: string | null;
  role: string;
  confidence: Confidence;
  evidence_quotes: string[];
};

export type AnalysisQuality = {
  transcript_reliability: Reliability;
  hallucination_risk: Reliability;
  notes: string;
};

export type AnalysisOutput = {
  summary_short: string;
  summary_detailed: string;
  tasks: AnalysisTask[];
  tags: AnalysisTag[];
  detail_tags: AnalysisDetailTag[];
  participants: AnalysisParticipant[];
  quality: AnalysisQuality;
};

export const ANALYSIS_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary_short",
    "summary_detailed",
    "tasks",
    "tags",
    "detail_tags",
    "participants",
    "quality",
  ],
  properties: {
    summary_short: { type: "string" },
    summary_detailed: { type: "string" },
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "description",
          "assignee_suggestion",
          "due",
          "priority",
          "status",
          "evidence_quotes",
          "confidence",
        ],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          assignee_suggestion: { type: ["string", "null"] },
          due: { type: ["string", "null"] },
          priority: { type: "string", enum: ["low", "medium", "high"] },
          status: {
            type: "string",
            enum: ["todo", "in_progress", "blocked", "done", "info_needed"],
          },
          evidence_quotes: { type: "array", items: { type: "string" } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    tags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tag", "confidence"],
        properties: {
          tag: { type: "string", enum: [...CALL_CATEGORY_TAGS] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    detail_tags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tag", "confidence"],
        properties: {
          tag: { type: "string", minLength: 1, maxLength: 48 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    participants: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "role", "confidence", "evidence_quotes"],
        properties: {
          name: { type: ["string", "null"] },
          role: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          evidence_quotes: { type: "array", items: { type: "string" } },
        },
      },
    },
    quality: {
      type: "object",
      additionalProperties: false,
      required: ["transcript_reliability", "hallucination_risk", "notes"],
      properties: {
        transcript_reliability: { type: "string", enum: ["low", "medium", "high"] },
        hallucination_risk: { type: "string", enum: ["low", "medium", "high"] },
        notes: { type: "string" },
      },
    },
  },
} as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function onlyKeys(obj: Record<string, unknown>, keys: string[]) {
  return Object.keys(obj).every((k) => keys.includes(k));
}

function inRangeConfidence(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
}

function asStringArray(v: unknown) {
  if (!Array.isArray(v)) return null;
  if (!v.every((x) => typeof x === "string")) return null;
  return v as string[];
}

export function validateAnalysisJson(input: unknown): {
  ok: true;
  value: AnalysisOutput;
} | {
  ok: false;
  errors: string[];
} {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["root must be an object"] };
  if (
    !onlyKeys(input, [
      "summary_short",
      "summary_detailed",
      "tasks",
      "tags",
      "detail_tags",
      "participants",
      "quality",
    ])
  ) {
    errors.push("root contains unexpected properties");
  }

  if (typeof input.summary_short !== "string") errors.push("summary_short must be string");
  if (typeof input.summary_detailed !== "string") errors.push("summary_detailed must be string");

  if (!Array.isArray(input.tasks)) {
    errors.push("tasks must be array");
  }
  if (!Array.isArray(input.tags)) {
    errors.push("tags must be array");
  }
  if (!Array.isArray(input.detail_tags)) {
    errors.push("detail_tags must be array");
  }
  if (!Array.isArray(input.participants)) {
    errors.push("participants must be array");
  }
  if (!isRecord(input.quality)) {
    errors.push("quality must be object");
  }

  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const tags = Array.isArray(input.tags) ? input.tags : [];
  const detailTags = Array.isArray(input.detail_tags) ? input.detail_tags : [];
  const participants = Array.isArray(input.participants) ? input.participants : [];
  const quality = isRecord(input.quality) ? input.quality : {};

  const parsedTasks: AnalysisTask[] = [];
  tasks.forEach((t, i) => {
    if (!isRecord(t)) {
      errors.push(`tasks[${i}] must be object`);
      return;
    }
    if (
      !onlyKeys(t, [
        "title",
        "description",
        "assignee_suggestion",
        "due",
        "priority",
        "status",
        "evidence_quotes",
        "confidence",
      ])
    ) {
      errors.push(`tasks[${i}] has unexpected properties`);
    }
    const evidence = asStringArray(t.evidence_quotes);
    const priority = t.priority;
    const status = t.status;
    if (typeof t.title !== "string") errors.push(`tasks[${i}].title must be string`);
    if (typeof t.description !== "string") errors.push(`tasks[${i}].description must be string`);
    if (!(t.assignee_suggestion === null || typeof t.assignee_suggestion === "string")) {
      errors.push(`tasks[${i}].assignee_suggestion must be string|null`);
    }
    if (!(t.due === null || typeof t.due === "string")) errors.push(`tasks[${i}].due must be string|null`);
    if (!(priority === "low" || priority === "medium" || priority === "high")) {
      errors.push(`tasks[${i}].priority invalid`);
    }
    if (!(status === "todo" || status === "in_progress" || status === "blocked" || status === "done" || status === "info_needed")) {
      errors.push(`tasks[${i}].status invalid`);
    }
    if (!evidence) errors.push(`tasks[${i}].evidence_quotes must be string[]`);
    if (!inRangeConfidence(t.confidence)) errors.push(`tasks[${i}].confidence must be 0..1`);
    if (
      typeof t.title === "string" &&
      typeof t.description === "string" &&
      (t.assignee_suggestion === null || typeof t.assignee_suggestion === "string") &&
      (t.due === null || typeof t.due === "string") &&
      (priority === "low" || priority === "medium" || priority === "high") &&
      (status === "todo" || status === "in_progress" || status === "blocked" || status === "done" || status === "info_needed") &&
      evidence &&
      inRangeConfidence(t.confidence)
    ) {
      parsedTasks.push({
        title: t.title,
        description: t.description,
        assignee_suggestion: t.assignee_suggestion,
        due: t.due,
        priority,
        status,
        evidence_quotes: evidence,
        confidence: t.confidence,
      });
    }
  });

  const parsedTags: AnalysisTag[] = [];
  tags.forEach((t, i) => {
    if (!isRecord(t)) {
      errors.push(`tags[${i}] must be object`);
      return;
    }
    if (!onlyKeys(t, ["tag", "confidence"])) errors.push(`tags[${i}] has unexpected properties`);
    if (typeof t.tag !== "string") errors.push(`tags[${i}].tag must be string`);
    if (typeof t.tag === "string" && !CALL_CATEGORY_TAGS.includes(t.tag as CallCategoryTag)) {
      errors.push(`tags[${i}].tag must be one of: ${CALL_CATEGORY_TAGS.join(", ")}`);
    }
    if (!inRangeConfidence(t.confidence)) errors.push(`tags[${i}].confidence must be 0..1`);
    if (
      typeof t.tag === "string" &&
      CALL_CATEGORY_TAGS.includes(t.tag as CallCategoryTag) &&
      inRangeConfidence(t.confidence)
    ) {
      parsedTags.push({ tag: t.tag as CallCategoryTag, confidence: t.confidence });
    }
  });

  const parsedDetailTags: AnalysisDetailTag[] = [];
  detailTags.forEach((t, i) => {
    if (!isRecord(t)) {
      errors.push(`detail_tags[${i}] must be object`);
      return;
    }
    if (!onlyKeys(t, ["tag", "confidence"])) errors.push(`detail_tags[${i}] has unexpected properties`);
    if (typeof t.tag !== "string" || t.tag.trim().length === 0) {
      errors.push(`detail_tags[${i}].tag must be non-empty string`);
    }
    if (!inRangeConfidence(t.confidence)) errors.push(`detail_tags[${i}].confidence must be 0..1`);
    if (typeof t.tag === "string" && t.tag.trim().length > 0 && inRangeConfidence(t.confidence)) {
      parsedDetailTags.push({ tag: t.tag.trim(), confidence: t.confidence });
    }
  });

  const parsedParticipants: AnalysisParticipant[] = [];
  participants.forEach((p, i) => {
    if (!isRecord(p)) {
      errors.push(`participants[${i}] must be object`);
      return;
    }
    if (!onlyKeys(p, ["name", "role", "confidence", "evidence_quotes"])) {
      errors.push(`participants[${i}] has unexpected properties`);
    }
    const evidence = asStringArray(p.evidence_quotes);
    if (!(p.name === null || typeof p.name === "string")) errors.push(`participants[${i}].name must be string|null`);
    if (typeof p.role !== "string") errors.push(`participants[${i}].role must be string`);
    if (!inRangeConfidence(p.confidence)) errors.push(`participants[${i}].confidence must be 0..1`);
    if (!evidence) errors.push(`participants[${i}].evidence_quotes must be string[]`);
    if (
      (p.name === null || typeof p.name === "string") &&
      typeof p.role === "string" &&
      inRangeConfidence(p.confidence) &&
      evidence
    ) {
      parsedParticipants.push({
        name: p.name,
        role: p.role,
        confidence: p.confidence,
        evidence_quotes: evidence,
      });
    }
  });

  const reliability = quality.transcript_reliability;
  const risk = quality.hallucination_risk;
  if (!(reliability === "low" || reliability === "medium" || reliability === "high")) {
    errors.push("quality.transcript_reliability invalid");
  }
  if (!(risk === "low" || risk === "medium" || risk === "high")) {
    errors.push("quality.hallucination_risk invalid");
  }
  if (typeof quality.notes !== "string") {
    errors.push("quality.notes must be string");
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      summary_short: input.summary_short as string,
      summary_detailed: input.summary_detailed as string,
      tasks: parsedTasks,
      tags: parsedTags,
      detail_tags: parsedDetailTags,
      participants: parsedParticipants,
      quality: {
        transcript_reliability: reliability as Reliability,
        hallucination_risk: risk as Reliability,
        notes: quality.notes as string,
      },
    },
  };
}
