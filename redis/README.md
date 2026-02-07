# Redis

This service is used by BullMQ for background jobs.

## Local (Docker Compose)

Redis runs as `redis:7` and is exposed on `localhost:6379`.

In Docker (API/worker), use:

- `REDIS_URL=redis://redis:6379`

On your host machine (if running API/worker outside Docker), use:

- `REDIS_URL=redis://localhost:6379`

