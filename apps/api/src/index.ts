import Fastify from "fastify";
import cors from "@fastify/cors";
import { desc } from "drizzle-orm";
import { db } from "./db.js";
import { calls } from "./schema.js";

const app = Fastify({
  logger: true,
});

await app.register(cors, {
  origin: true,
});

app.get("/health", async () => {
  return { ok: true };
});

app.get("/calls", async (request, reply) => {
  const { limit } = request.query as { limit?: string };
  const parsed = Number(limit);
  const safeLimit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 50) : 6;

  const rows = await db
    .select()
    .from(calls)
    .orderBy(desc(calls.startedAt))
    .limit(safeLimit);

  reply.send(rows);
});

const port = Number(process.env.PORT || 8080);
const host = "0.0.0.0";

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
