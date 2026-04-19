# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Four independent npm packages (no root workspace). Each has its own `package.json`, `tsconfig.json`, and Dockerfile:

- `apps/api` — Fastify webhook + REST API (port 8080)
- `apps/web` — Vite + React + Tailwind SPA (shadcn-style components under `src/components/ui`, alias `@/` → `src/`)
- `worker` — BullMQ consumer that runs the call-processing pipeline
- `db` — Drizzle schema, plain-SQL migrations, and a seed script

Nothing runs from the repo root: `cd` into the relevant package before running any `npm` script.

## Common commands

Run everything locally (Postgres + Redis + API + worker + web + pgAdmin):

```bash
docker compose up -d --build
docker compose logs -f api worker
```

Phase-1 / webhook-only stack (Redis + API + worker):

```bash
docker compose up -d --build redis api worker
```

Apply DB migrations against a running `postgres` service:

```bash
docker compose up -d postgres db-migrate
# or, against a local Postgres with DATABASE_URL exported:
cd db && npm install && npm run migrate && npm run seed
```

Dev servers (each package, assumes env vars set in shell or `.env`):

```bash
cd apps/api && npm run dev      # tsx watch src/index.ts
cd apps/web && npm run dev      # vite
cd worker   && npm run dev      # tsx watch src/recordingWorker.ts
```

Production-style builds: `npm run build` then `npm start` in each package. `apps/web` serves `dist/` via `server.js` on `PORT`.

Tests (the only test suite in the repo lives in the worker, covering analysis logic):

```bash
cd worker && npm test                         # runs src/analysis/run-tests.ts
cd worker && npx tsx src/analysis/run-tests.ts   # direct invocation
```

There is no single-test filter; `run-tests.ts` calls each test function sequentially. Add a new test by importing and calling it from `run-tests.ts`.

Manual end-to-end helpers:

```bash
# Enqueue a test job onto recording_jobs (hits worker pipeline):
cd worker && npm run enqueue:test -- --recording-url "<TWILIO_RECORDING_URL>" --account-sid "AC..." [--job-id "<unique>"]

# Simulate a signed Twilio recording-status-callback POST to the API:
cd apps/api && npm run test:twilio-webhook
```

Bull Board UI is mounted at `http://localhost:8080/admin/queues` when the API is started with `BULLBOARD_ENABLED=true` (the default in `docker-compose.yml`).

## Architecture

### End-to-end flow

1. Twilio POSTs a recording-status callback to `apps/api` at `POST /webhooks/twilio/recording`.
2. API verifies the Twilio signature using `TWILIO_AUTH_TOKEN` + `PUBLIC_WEBHOOK_URL + "/webhooks/twilio/recording"` against the **raw** request body (captured via `fastify-raw-body`), and only enqueues when `RecordingStatus === "completed"`.
3. Job is added to the BullMQ queue `recording_jobs` with `jobId = RecordingSid` — duplicate webhooks are absorbed idempotently. Job name: `twilio_recording_completed`.
4. `worker/src/recordingWorker.ts` consumes `recording_jobs`. It dispatches by **job name**: analysis jobs (`ANALYSIS_JOB_NAME` from `src/analysis/queue.ts`) go to `runCallAnalysisJob`; everything else goes to `runPipeline`. This is the critical routing fact — the analysis stage rides the same queue as the ingestion pipeline.
5. `runPipeline` (`worker/src/pipeline/index.ts`) orchestrates four steps, each tracked in `pipeline_steps`:
   - `download_recording` — HTTP Basic Auth download of `${recordingUrl}.mp3` (falls back to `.wav`) into `/app/recordings/<accountSid>/<recordingSid>.{mp3,wav}` (Docker volume `worker_recordings`)
   - `transcribe_whisper` — OpenAI Whisper (requires `OPENAI_API_KEY`)
   - `analyze_llm` — currently writes deterministic placeholder JSON into `insights` (no LLM call)
   - `persist_db` — updates `calls` summary/status and marks recording processed
6. After `persist_db`, the pipeline **enqueues a follow-up analysis job** onto the same `recording_jobs` queue. `runCallAnalysisJob` (`worker/src/analysis/analysisWorker.ts`) applies a duration + transcript-length gate, builds a prompt, calls the LLM with a JSON-repair retry (`repair.ts`), post-processes, and writes rows into `call_tasks_suggested`, `call_tags_suggested`, `call_participants_suggested`, plus `calls.summary_suggested_*` and `calls.analysis_*` fields. Users then accept/dismiss suggestions via `POST /calls/:externalId/analysis/accept` and `/dismiss`.

### Idempotency model

Every stage is re-entrant on the same `recordingSid`:

- API: `jobId=recordingSid` — BullMQ rejects duplicates (the API catches `"already exists"` and returns success).
- Pipeline: each step checks DB state before re-doing work (recording has `local_path` + file exists → skip download; transcript row exists → skip Whisper; insights row exists → skip analyze).
- Tracking: `pipeline_runs` is keyed by `(recording_sid, job_id)` unique; `pipeline_steps` by `(run_id, step)` unique. `startStep` returns `alreadyCompleted=true` when re-running a finished step.
- To force a full re-run for the same recording, pass a different BullMQ id: `--job-id "<unique>"` to `enqueue:test`.

On failure, the current step is marked failed, `calls.status='failed'` / `recordings.status='failed'`, the run is marked failed, and the error is re-thrown so BullMQ's retry/backoff applies (5 attempts, exponential, base 2s).

### Database (Drizzle + plain SQL migrations)

- Schema source of truth: `db/schema.ts`. **Three Drizzle schema copies exist, all hand-maintained**: the canonical one, `apps/api/src/schema.ts`, and inline definitions inside `worker/src/pipeline/db.ts` + `worker/src/analysis/db.ts`. Each worker file declares only the columns it touches. When you add or change a column, update the canonical file and any of the three copies that reference the affected column — otherwise the consumer silently drops the field.
- Migrations are plain `.sql` files under `db/migrations/` applied in filename order by `db/migrate.ts`. Do not rely on `drizzle-kit generate` output alone — new migrations are written by hand and must be added to this folder with the next sequential prefix (latest is `0007_*.sql`).
- Seed (`db/seed.ts`) upserts by `calls.external_id` and is safe to re-run.
- Key tables: `calls` (rich analysis metadata lives here as flat columns, not a side table), `recordings`, `transcripts` (original + English translation in `content` / `content_en`), `insights`, `pipeline_runs` / `pipeline_steps`, and the `call_*_suggested` tables that store AI suggestions in a `state` state machine (`suggested` → `confirmed` | `dismissed`).

### Two-tier tag model

`call_tags_suggested` carries both kinds of tag in one table, differentiated by the `tier` column:

- **`tier='top'`** — closed-vocab categories shown as colored chips in the timeline/feed: `Reservations`, `Special Requests`, `Inquiries`, `Miscellaneous`. Multiple allowed per call. Auto-applied (`state='confirmed'`) when the LLM's confidence ≥ `LLM_TOP_TAG_AUTO_APPLY_THRESHOLD` (default `0.85`); otherwise land in `state='suggested'` and need user acceptance. `calls.tag` is the denormalized comma-joined string of *confirmed* top-tier tags only — rebuilt on auto-apply and on `/analysis/accept`.
- **`tier='detail'`** — free-form short phrases (e.g. `"late check-in"`, `"parking"`, `"breakfast included"`). Always land in `state='suggested'`; never auto-apply. Shown only in the call detail panel's "Suggested tags" section.

The analysis LLM emits both under separate keys (`tags` for top-level, `detail_tags` for free-form) — see [`worker/src/analysis/prompt.ts`](worker/src/analysis/prompt.ts) and the `AnalysisOutput` type in [`worker/src/analysis/schema.ts`](worker/src/analysis/schema.ts). The prompt also includes **per-category summary guidance** — `summary_detailed` must mention caller/room/dates/price when tagged `Reservations`, request + fees when `Special Requests`, etc. Re-running analysis replaces only `state='suggested'` rows; confirmed tags survive so prior user acceptances stick.

API surface:

- `GET /calls` → each call carries `topLevelTags: string[]` (confirmed top-tier only).
- `GET /calls/:externalId/analysis` → `topLevelTags` (confirmed), `topLevelTagsSuggested` (pending review), `detailTagsSuggested` (pending review).
- `POST /calls/:externalId/analysis/accept` accepts both tiers in a single `tagIds` list; only tier=`top` tags feed back into `calls.tag`.

### Env vars that actually gate behavior

- `REDIS_URL` — required everywhere. The API silently returns 503 from the webhook and skips mounting Bull Board if missing. The worker refuses to start.
- `DATABASE_URL` — API routes return 503 `DATABASE_URL not configured` when absent.
- `TWILIO_AUTH_TOKEN` + `PUBLIC_WEBHOOK_URL` — both required for signature verification; `PUBLIC_WEBHOOK_URL` must match **exactly** what Twilio calls (no trailing slash nuances — the code strips trailing `/` then appends `/webhooks/twilio/recording`).
- `TWILIO_ACCOUNT_SID` — the worker uses the job payload's `accountSid` first, falls back to env. Required for media download.
- `OPENAI_API_KEY` — required for Whisper in the pipeline and for LLM analysis.
- `BULLBOARD_ENABLED="true"` — gates the `/admin/queues` UI on the API.
- `LLM_MIN_DURATION_SEC` — duration gate for analysis (default 30s). Calls shorter than this are marked `analysis_status=skipped` with reason `duration_below_threshold`.
- `LLM_TOP_TAG_AUTO_APPLY_THRESHOLD` — confidence cutoff (0..1, default `0.85`). Top-level tags at/above this confidence auto-confirm; below goes through the accept/dismiss flow.

### TypeScript / ESM conventions

- `apps/api` and `worker` are `"type": "module"` and target NodeNext. **Relative imports must include the `.js` extension** (e.g., `import { runPipeline } from "./pipeline/index.js"`) even though the source files are `.ts`. New files must follow this or `tsx`/`node` will fail to resolve at runtime.
- `apps/web` is not ESM-typed and uses the Vite alias `@/` → `apps/web/src/`.

### Redis connection quirk

The worker builds a plain connection-options object rather than passing an `ioredis` instance to BullMQ (`recordingWorker.ts`). This is intentional — it avoids an ioredis version mismatch between the worker's direct dep and BullMQ's bundled ioredis — and sets `family: 0` so Railway's IPv6 private network works. Preserve this pattern when adding new BullMQ consumers.
