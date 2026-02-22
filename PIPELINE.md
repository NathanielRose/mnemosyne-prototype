# Worker Pipeline

This repo uses **BullMQ** to enqueue Twilio recording completion events onto the `recording_jobs` queue. The worker consumes those jobs and runs an end-to-end pipeline:

- Download Twilio recording media to disk
- Transcribe with OpenAI Whisper
- Generate placeholder insights (no LLM call yet)
- Persist results to Postgres
- Track business progress in `pipeline_runs` + `pipeline_steps`

## Where to look

- **Queue / job state**: Bull Board UI (locally via API)
  - API mounts at `GET /admin/queues` when `BULLBOARD_ENABLED="true"`
- **Business progress**: Postgres tables
  - `pipeline_runs` (one run per recordingSid + jobId)
  - `pipeline_steps` (per-step status + meta + error)
- **Artifacts**
  - Downloaded recordings: `/app/recordings/<accountSid>/<recordingSid>.mp3|.wav` (Docker volume `worker_recordings`)

## Database schema

Schema lives in `db/schema.ts` and is applied via migrations in `db/migrations/`.

To apply locally (Docker Compose):

1. Start postgres + run migrations:
   - `docker compose up -d postgres db-migrate`

This pipeline relies on migration `db/migrations/0002_pipeline.sql` which adds:

- New tables: `insights`, `pipeline_runs`, `pipeline_steps`
- New columns:
  - `calls`: `to_number`, `status`, `error`
  - `recordings`: `local_path`, `downloaded_at`
  - `transcripts`: `raw_json` + unique index on `recording_id`

## Worker environment

The worker requires:

- **REDIS_URL**: BullMQ connection
- **DATABASE_URL**: Postgres connection string
- **TWILIO_AUTH_TOKEN**: used for HTTP Basic Auth when downloading recording media
- **TWILIO_ACCOUNT_SID**: optional (the job payload usually includes `accountSid`)
- **OPENAI_API_KEY**: required for Whisper transcription

In `docker-compose.yml`, the worker also mounts:

- `worker_recordings:/app/recordings`

## Pipeline steps & idempotency

The orchestrator is `worker/src/pipeline/index.ts` and runs these steps:

1. **download_recording**
   - Skips if `recordings.local_path` + `recordings.downloaded_at` are present *and* the file exists on disk.
   - Otherwise downloads `${recordingUrl}.mp3` (fallback to `.wav`) using HTTP Basic Auth.
2. **transcribe_whisper**
   - Skips if a transcript exists for the recording (`transcripts.recording_id`).
   - Otherwise calls Whisper and stores `content` + `raw_json`.
3. **analyze_llm**
   - Skips if insights exist for the recording (`insights.recording_id`).
   - Otherwise writes deterministic placeholder JSON.
4. **persist_db**
   - Updates call preview/summary and marks call/recording status completed.

On failure, the worker:

- Marks the current step + run as failed (`pipeline_steps`, `pipeline_runs`)
- Updates `calls.status='failed'` and `recordings.status='failed'`
- Re-throws so BullMQ retry/backoff can apply

## Enqueue a test job

There’s a helper script:

- `worker/scripts/enqueue-test-job.mjs`

Run:

- `cd worker`
- `npm run enqueue:test -- --recording-url "<TWILIO_RECORDING_URL>" --account-sid "<AC...>"`

Optional args: `--from "+15551234567"`, `--to "+15557654321"`, `--duration 45` (caller, receiver, duration in seconds). Defaults are used if omitted.

You can also set env vars:

- `REDIS_URL`
- `RECORDING_URL`
- `TWILIO_ACCOUNT_SID`

Notes:

- For a true end-to-end run, `recordingUrl` must be a real Twilio recording URL and the worker must have `TWILIO_AUTH_TOKEN` + `OPENAI_API_KEY`.
- To re-run the pipeline for the same `recordingSid`, pass a different BullMQ id with `--job-id "<something-unique>"` (the worker stays idempotent per `recordingSid`).

