import { runDailyBackupIfDue } from "@/app/lib/db/backup";
import { db } from "@/app/lib/db/db";
import { retryDueMessages } from "@/app/lib/inbox/retry-job";
import { runJob } from "@/app/lib/jobs/runner";
import { escalateBreaches } from "@/app/lib/workspace/escalation";

/**
 * One tick for an external scheduler (cron, systemd timer, uptime pinger).
 *
 * The in-process timers are convenient but only exist while the server does; a
 * self-hosted user can point a cron entry here instead, or as well, and the job
 * leases make the two safe to run together. The endpoint is disabled unless
 * WAX_JOBS_TOKEN is set, because it spends provider credits and moves data.
 */
async function tick(request: Request) {
  const token = process.env.WAX_JOBS_TOKEN;
  if (!token) return new Response("Not found", { status: 404 });

  const expected = `Bearer ${token}`;
  if (request.headers.get("authorization") !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  const outcomes: Record<string, unknown> = {};

  const retry = runJob("delivery-retry", () => retryDueMessages());
  outcomes.retry = retry.ran ? retry.result : "leased";

  let escalated = 0;
  for (const row of db.prepare("SELECT id FROM workspaces").all()) {
    escalated += escalateBreaches(String(row.id));
  }
  outcomes.escalated = escalated;

  const backup = runJob("daily-backup", () => runDailyBackupIfDue());
  outcomes.backup = backup.ran ? backup.result : "leased";

  return Response.json({ ok: true, ...outcomes });
}

export async function GET(request: Request) {
  return tick(request);
}

export async function POST(request: Request) {
  return tick(request);
}
