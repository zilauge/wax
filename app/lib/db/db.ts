import "server-only";

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "@/app/lib/db/migrate";
import { SCHEMA } from "@/app/lib/db/schema";

/**
 * Server-side persistence. Node 24 ships SQLite, so the app needs no database
 * driver dependency; the file lives next to the project (gitignored).
 */
const DB_PATH =
  process.env.WAX_DB_PATH ?? join(process.cwd(), ".data", "wax.db");

function openDatabase() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const database = new DatabaseSync(DB_PATH);
  database.exec(SCHEMA);
  migrate(database);
  return database;
}

// Reuse one connection across HMR reloads in development.
const globalForDb = globalThis as unknown as { waxDatabase?: DatabaseSync };

export const db: DatabaseSync =
  globalForDb.waxDatabase ?? (globalForDb.waxDatabase = openDatabase());
