import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
  // #region agent log
  fetch("http://127.0.0.1:7242/ingest/a3ef73b0-1718-4862-bfcc-8be547c0ddca", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      location: "apps/api/src/db.ts:12",
      message: "getDb called",
      data: { hasDatabaseUrl },
      timestamp: Date.now(),
      runId: "pre-fix",
      hypothesisId: "H1",
    }),
  }).catch(() => {});
  // #endregion

  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is required for database access.");
    }
    pool = new Pool({ connectionString });
    db = drizzle(pool, { schema });
  }

  return { db, pool };
}
