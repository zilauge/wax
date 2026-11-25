import "server-only";

import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/app/lib/db/db";
import { runJob } from "@/app/lib/jobs/runner";

const BACKUP_DIR = join(process.cwd(), ".data", "backups");
const KEEP = 7;
const ONE_DAY = 24 * 60 * 60 * 1000;

/**
 * SQLite's online-safe copy: `VACUUM INTO` writes a consistent, compacted
 * database while the desk keeps serving reads and writes. Returns the file it
 * created so a caller can report it.
 */
export function createBackup(label = "auto") {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(BACKUP_DIR, `wax-${stamp}-${label}.db`);

  db.prepare("VACUUM INTO ?").run(target);
  return target;
}

export function listBackups() {
  try {
    return readdirSync(BACKUP_DIR)
      .filter((name) => name.startsWith("wax-") && name.endsWith(".db"))
      .map((name) => {
        const path = join(BACKUP_DIR, name);
        const stats = statSync(path);
        return { name, path, bytes: stats.size, at: stats.mtimeMs };
      })
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

/** Keeps the newest `keep` copies and deletes anything older. */
export function pruneBackups(keep = KEEP) {
  const removed: string[] = [];
  for (const backup of listBackups().slice(keep)) {
    try {
      unlinkSync(backup.path);
      removed.push(backup.name);
    } catch {
      // A file already gone or locked is not worth failing the whole prune.
    }
  }
  return removed;
}

export function lastBackupAt() {
  const [latest] = listBackups();
  return latest ? latest.at : null;
}

/**
 * Writes today's copy if none exists yet, then trims the history. Returns the
 * file it created, or null when today's copy was already there — the job runner
 * records that outcome either way.
 */
export function runDailyBackupIfDue() {
  const last = lastBackupAt();
  if (last !== null && Date.now() - last < ONE_DAY) return null;
  const path = createBackup("daily");
  pruneBackups();
  return path;
}

/**
 * One backup a day, kept to the last week. It runs on boot and then on a timer,
 * so a self-hosted install needs no cron entry. WAX_BACKUP_DISABLED=1 opts out.
 * The lease means boot, the timer and an external tick cannot all write at once.
 */
export function startBackupScheduler() {
  if (process.env.WAX_BACKUP_DISABLED === "1") return;

  const run = () => {
    runJob("daily-backup", runDailyBackupIfDue);
  };

  const timer = setInterval(run, 6 * 60 * 60 * 1000);
  timer.unref?.();
  // Give the server a moment to finish booting before the first copy.
  setTimeout(run, 30_000).unref?.();
}
