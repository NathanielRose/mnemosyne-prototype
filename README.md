# Mnemosyne Prototype

## Services

- **API**: `apps/api` (Fastify)
- **Web**: `apps/web` (Vite + React)
- **DB**: `db` (schema/migrations/seed scripts)
- **Worker**: `worker` (BullMQ consumer)
- **Redis**: used for BullMQ queue

## Phase 1: Twilio Recording Status Callback → enqueue job

This phase adds a webhook receiver:

- `POST /webhooks/twilio/recording`
  - verifies Twilio signature
  - enqueues a BullMQ job to Redis queue `recording_jobs`
  - returns `200` only after `queue.add()` succeeds (idempotent with `jobId=RecordingSid`)

The worker consumes `recording_jobs` and only logs payloads for now.

## Environment variables

Required for webhook validation:

- `TWILIO_AUTH_TOKEN=...`
- `PUBLIC_WEBHOOK_URL=https://your-public-domain`
  - Must match exactly what Twilio calls.
  - The API validates using `PUBLIC_WEBHOOK_URL + /webhooks/twilio/recording`.

Redis:

- In Docker: `REDIS_URL=redis://redis:6379`
- On host: `REDIS_URL=redis://localhost:6379`

## Local dev (Docker Compose)

Start Phase 1 services (Redis + API + worker):

```
docker compose up -d --build redis api worker
```

Start everything (DB + API + web + worker + redis + pgAdmin):

```
docker compose up -d --build
```

Follow logs:

```
docker compose logs -f api worker
```

## Expose webhook to Twilio (ngrok / cloudflared)

You need a public HTTPS URL that forwards to your local API.

Example with ngrok (assuming API is on port 8080):

```
ngrok http 8080
```

Then set:

- `PUBLIC_WEBHOOK_URL=https://<your-ngrok-subdomain>.ngrok-free.app`

In the Twilio Recording Status Callback URL, use:

- `https://<your-ngrok-subdomain>.ngrok-free.app/webhooks/twilio/recording`

## What you should see in logs

API:
- webhook received
- signature validated
- job enqueued (jobId=RecordingSid)

Worker:
- job received + payload
- job completed

