/**
 * Manual SQLite backup: `npm run db:backup` copies the live database with
 * `VACUUM INTO` and prunes everything but the newest seven copies.
 */
import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const source = process.env.WAX_DB_PATH ?? join(process.cwd(), ".data", "wax.db");
const directory = join(dirname(source), "backups");
const keep = Number(process.env.WAX_BACKUP_KEEP ?? 7);

mkdirSync(directory, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = join(directory, `wax-${stamp}-manual.db`);

const database = new DatabaseSync(source, { readOnly: true });
try {
  database.prepare("VACUUM INTO ?").run(target);
} finally {
  database.close();
}

const copies = readdirSync(directory)
  .filter((name) => name.startsWith("wax-") && name.endsWith(".db"))
  .map((name) => ({ name, at: statSync(join(directory, name)).mtimeMs }))
  .sort((a, b) => b.at - a.at);

for (const copy of copies.slice(keep)) {
  unlinkSync(join(directory, copy.name));
}

console.log(`Backup written to ${target}`);
console.log(`Kept ${Math.min(copies.length, keep)} of ${copies.length} copies in ${directory}`);
