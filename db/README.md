# Database (Postgres)

This folder captures the first persistence step for the call UI. It includes a Postgres schema,
Drizzle migrations, and a seed script that inserts the existing mock call data. The frontend
still uses in-memory mock data for now.

## Why Drizzle

Drizzle keeps the schema in TypeScript, gives strong type inference for shared models, and uses
plain SQL migrations that are easy to review and run in CI.

## Schema overview

Tables:

- `calls` — core call record and summary data
- `recordings` — audio metadata per call (POC: provider, status, optional URL)
- `transcripts` — full transcript text (preview stays on `calls`)
- `extractions` — JSONB payloads from LLM extraction (reservation draft data)
- `notifications` — actionable alerts derived from calls

Enums:

- `call_outcome`, `call_priority`, `call_language`
- `notification_type`, `notification_status`

## Migrations

Set your local `DATABASE_URL` (e.g. `postgres://user:pass@localhost:5432/mnemosyne`), then:

```
cd db
npm install
npm run migrate
```

The initial migration lives at `db/migrations/0001_initial.sql`.

`npm run migrate` runs all `.sql` files in `db/migrations/` in filename order.

## Seed data

```
cd db
npm run seed
```

The seed script upserts by `calls.external_id`, so it is safe to re-run.

## Types

Types are defined in `db/schema.ts` and exported via `db/types.ts`.
If/when a shared package exists (e.g. `packages/shared`), move the types there
and re-export them from the backend and frontend.

## Future usage

The API will query `calls`/`transcripts`/`recordings` for list/detail views.
Worker services will populate `recordings`, `transcripts`, `extractions`, and
`notifications` as calls are processed.

## Environment assumptions

- Local development uses a local Postgres instance.
- Production uses Railway Postgres.
