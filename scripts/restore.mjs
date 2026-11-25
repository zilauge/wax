#!/usr/bin/env node
/**
 * Verify a backup before anyone needs it, and optionally restore it.
 *
 *   npm run db:restore -- .data/backups/wax-2026-01-01T00-00-00-000Z-daily.db
 *   npm run db:restore -- <backup> --to .data/wax.db --force
 *
 * Without --to it only checks the copy: SQLite's integrity check, the table
 * list and the row counts that matter. That is the drill — a backup nobody has
 * opened is a file, not a recovery plan. With --to it copies the verified file
 * over the target, so the server must be stopped first.
 */
import { copyFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const source = args.find((arg) => !arg.startsWith("--"));
const toIndex = args.indexOf("--to");
const target = toIndex >= 0 ? args[toIndex + 1] : null;
const force = args.includes("--force");

if (!source) {
  console.error(
    "Usage: npm run db:restore -- <backup.db> [--to .data/wax.db --force]",
  );
  process.exit(1);
}

if (!existsSync(source)) {
  console.error(`No such backup: ${source}`);
  process.exit(1);
}

const bytes = statSync(source).size;
if (bytes === 0) {
  console.error(`Backup is empty: ${source}`);
  process.exit(1);
}

const database = new DatabaseSync(source, { readOnly: true });
let integrity;
let tables = [];
const counts = {};

try {
  integrity = database.prepare("PRAGMA integrity_check").get();
  tables = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((row) => String(row.name));

  for (const table of ["workspaces", "users", "contacts", "conversations", "messages"]) {
    if (!tables.includes(table)) {
      counts[table] = "missing";
      continue;
    }
    counts[table] = Number(
      database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,
    );
  }
} finally {
  database.close();
}

const result = String(integrity?.integrity_check ?? "");
console.log(`Backup: ${source}`);
console.log(`Size: ${(bytes / 1024 / 1024).toFixed(2)} MiB`);
console.log(`Integrity: ${result}`);
console.log(`Tables: ${tables.length}`);
for (const [table, count] of Object.entries(counts)) {
  console.log(`  ${table}: ${count}`);
}

if (result.toLowerCase() !== "ok") {
  console.error("Refusing to restore a backup that failed its integrity check.");
  process.exit(1);
}

if (target) {
  if (!force) {
    console.error(
      `Refusing to overwrite ${target} without --force. Stop the server first.`,
    );
    process.exit(1);
  }
  copyFileSync(source, target);
  console.log(`Restored to ${target}. Start the server and check the desk.`);
} else {
  console.log("Verification only. Pass --to <path> --force to restore.");
}
