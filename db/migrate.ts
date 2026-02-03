import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { Client } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run migrations.");
}

const migrationsDir = path.join(process.cwd(), "migrations");

async function run() {
  const client = new Client({ connectionString });
  await client.connect();

  const entries = await fs.readdir(migrationsDir);
  const sqlFiles = entries.filter((file) => file.endsWith(".sql")).sort();

  for (const file of sqlFiles) {
    const fullPath = path.join(migrationsDir, file);
    const sql = await fs.readFile(fullPath, "utf-8");
    if (sql.trim().length === 0) continue;
    await client.query(sql);
  }

  await client.end();
}

run().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
