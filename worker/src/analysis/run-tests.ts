import assert from "node:assert/strict";
import { evaluateAnalysisGate } from "./gate.js";
import { postProcess } from "./postProcess.js";
import { resolveAnalysisAfterRepair } from "./repair.js";
import type { AnalysisOutput } from "./schema.js";

function testDurationGate() {
  const result = evaluateAnalysisGate({
    durationSec: 12,
    thresholdSec: 30,
    transcriptOriginal: "hello",
    transcriptUserLang: "hello",
  });
  assert.equal(result.run, false);
  if (!result.run) {
    assert.equal(result.analysisReason, "duration_below_threshold");
  }
}

function testInvalidJsonFailurePath() {
  const result = resolveAnalysisAfterRepair({
    firstRaw: `{"summary_short":"only short"}`,
    repairedRaw: `{"foo":"bar"}`,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.length > 0);
  }
}

function testParticipantEvidenceRule() {
  const input: AnalysisOutput = {
    summary_short: "short",
    summary_detailed: "detailed",
    tasks: [
      {
        title: "Call customer",
        description: "Ask for confirmation",
        assignee_suggestion: null,
        due: null,
        priority: "medium",
        status: "todo",
        evidence_quotes: ["quote not in transcript"],
        confidence: 0.9,
      },
    ],
    tags: [{ tag: "Inquiries", confidence: 0.8 }],
    participants: [
      {
        name: "John Doe",
        role: "caller",
        confidence: 0.95,
        evidence_quotes: ["missing quote"],
      },
    ],
    quality: {
      transcript_reliability: "medium",
      hallucination_risk: "low",
      notes: "",
    },
  };

  const output = postProcess(input, {
    transcriptOriginal: "Hello this is Alice calling about booking.",
    transcriptUserLang: "Hello this is Alice calling about booking.",
  });

  assert.equal(output.participants[0]?.name, null);
  assert.equal(output.tasks[0]?.status, "info_needed");
}

function main() {
  testDurationGate();
  testInvalidJsonFailurePath();
  testParticipantEvidenceRule();
  console.log("[analysis-tests] all tests passed");
}

main();

