import { and, eq } from "drizzle-orm";
import { getDb, pipelineRuns, pipelineSteps } from "./db.js";

export type PipelineRunStatus = "started" | "completed" | "failed";
export type PipelineStepName =
  | "download_recording"
  | "transcribe_whisper"
  | "analyze_llm"
  | "persist_db";
export type PipelineStepStatus = "started" | "completed" | "failed";

function errorToString(err: unknown) {
  if (err instanceof Error) return err.stack || err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export async function startRun(params: {
  recordingSid: string;
  jobId: string | null;
  attempt: number;
}) {
  const db = getDb();

  if (params.jobId) {
    const existing = await db
      .select({ id: pipelineRuns.id, attempt: pipelineRuns.attempt })
      .from(pipelineRuns)
      .where(and(eq(pipelineRuns.recordingSid, params.recordingSid), eq(pipelineRuns.jobId, params.jobId)))
      .limit(1);

    if (existing[0]?.id) {
      if (params.attempt > (existing[0].attempt ?? 1)) {
        await db
          .update(pipelineRuns)
          .set({ attempt: params.attempt })
          .where(eq(pipelineRuns.id, existing[0].id));
      }
      return { runId: existing[0].id };
    }
  }

  const inserted = await db
    .insert(pipelineRuns)
    .values({
      recordingSid: params.recordingSid,
      jobId: params.jobId,
      status: "started",
      attempt: params.attempt,
      startedAt: new Date(),
      finishedAt: null,
    })
    .returning({ id: pipelineRuns.id });

  return { runId: inserted[0]!.id };
}

export async function startStep(params: { runId: string; step: PipelineStepName }) {
  const db = getDb();
  const existing = await db
    .select({ id: pipelineSteps.id, status: pipelineSteps.status })
    .from(pipelineSteps)
    .where(and(eq(pipelineSteps.runId, params.runId), eq(pipelineSteps.step, params.step)))
    .limit(1);

  if (existing[0]?.id) {
    if (existing[0].status === "completed") {
      return { stepId: existing[0].id, alreadyCompleted: true as const };
    }

    await db
      .update(pipelineSteps)
      .set({
        status: "started",
        startedAt: new Date(),
        finishedAt: null,
        error: null,
      })
      .where(eq(pipelineSteps.id, existing[0].id));

    return { stepId: existing[0].id, alreadyCompleted: false as const };
  }

  const inserted = await db
    .insert(pipelineSteps)
    .values({
      runId: params.runId,
      step: params.step,
      status: "started",
      startedAt: new Date(),
      finishedAt: null,
      meta: null,
      error: null,
    })
    .returning({ id: pipelineSteps.id });

  return { stepId: inserted[0]!.id, alreadyCompleted: false as const };
}

export async function completeStep(params: { stepId: string; meta?: unknown }) {
  const db = getDb();
  await db
    .update(pipelineSteps)
    .set({
      status: "completed",
      finishedAt: new Date(),
      meta: params.meta ?? null,
      error: null,
    })
    .where(eq(pipelineSteps.id, params.stepId));
}

export async function failStep(params: { stepId: string; error: unknown; meta?: unknown }) {
  const db = getDb();
  await db
    .update(pipelineSteps)
    .set({
      status: "failed",
      finishedAt: new Date(),
      meta: params.meta ?? null,
      error: errorToString(params.error),
    })
    .where(eq(pipelineSteps.id, params.stepId));
}

export async function finishRun(params: { runId: string; status: PipelineRunStatus }) {
  const db = getDb();
  await db
    .update(pipelineRuns)
    .set({
      status: params.status,
      finishedAt: new Date(),
    })
    .where(eq(pipelineRuns.id, params.runId));
}

