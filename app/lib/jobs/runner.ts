import "server-only";

import { db } from "@/app/lib/db/db";
import type { JobState } from "@/app/lib/types";

/** Slightly longer than the tick interval, so a slow run is not doubled up. */
const LEASE_MS = 55_000;

export type JobOutcome<T> =
  | { ran: true; result: T }
  | { ran: false };

/**
 * Claims a named job before it runs. SQLite applies the UPDATE half of the
 * upsert atomically and only when the previous lease has expired, so a second
 * process (or a second timer) sees `changes: 0` and skips this round. A crash
 * leaves the lease to expire instead of wedging the job forever.
 */
function claim(name: string): boolean {
  const now = Date.now();
  const result = db
    .prepare(
      `INSERT INTO job_state (name, lease_until, last_started_at)
       VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         lease_until = excluded.lease_until,
         last_started_at = excluded.last_started_at
       WHERE job_state.lease_until < ?`,
    )
    .run(name, now + LEASE_MS, now, now);

  return Number(result.changes) > 0;
}

function release(name: string, status: "ok" | "error", error?: string) {
  db.prepare(
    `UPDATE job_state
     SET lease_until = 0, last_finished_at = ?, last_status = ?,
         last_error = ?, run_count = run_count + 1
     WHERE name = ?`,
  ).run(Date.now(), status, error ?? null, name);
}

/**
 * Runs `task` only if this instance owns the job's lease, and records how the
 * last attempt went. A failure is logged and stored rather than thrown, because
 * these run from a timer where an exception has nowhere useful to go; the job
 * page in settings shows the stored error instead.
 */
export function runJob<T>(name: string, task: () => T): JobOutcome<T> {
  if (!claim(name)) return { ran: false };

  try {
    const result = task();
    release(name, "ok");
    return { ran: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    release(name, "error", message);
    console.error(`[job:${name}]`, error);
    return { ran: false };
  }
}

/** Human labels for the job names stored in `job_state`. */
function jobLabel(name: string) {
  if (name === "delivery-retry") return "Delivery retries";
  if (name === "daily-backup") return "Daily backup";
  if (name.startsWith("sla-escalation:")) return "SLA escalation";
  return "Background job";
}

/**
 * The last outcome of the server-wide jobs plus this workspace's own escalation
 * sweep. Job names carry a workspace id for per-tenant leases, so the list is
 * filtered here rather than in the page: another tenant's name, status and
 * error must never reach this workspace's settings.
 */
export function listJobStates(workspaceId: string): JobState[] {
  return db
    .prepare(
      `SELECT name, last_finished_at, last_status, last_error, run_count
       FROM job_state
       WHERE name NOT LIKE '%:%' OR name = ?
       ORDER BY CASE WHEN name LIKE '%:%' THEN 1 ELSE 0 END, name`,
    )
    .all(`sla-escalation:${workspaceId}`)
    .map((row) => {
      const name = String(row.name);
      return {
        name,
        label: jobLabel(name),
        lastFinishedAt: row.last_finished_at
          ? Number(row.last_finished_at)
          : null,
        lastStatus: row.last_status
          ? (String(row.last_status) as "ok" | "error")
          : null,
        lastError: row.last_error ? String(row.last_error) : null,
        runCount: Number(row.run_count),
      };
    });
}
