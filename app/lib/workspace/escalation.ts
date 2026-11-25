import "server-only";

import { db } from "@/app/lib/db/db";
import { runJob } from "@/app/lib/jobs/runner";
import { publishWorkspaceEvent } from "@/app/lib/workspace/realtime";

/**
 * Escalates first-response SLA breaches.
 *
 * A conversation that is past its queue deadline, has never had an agent reply
 * and still has no owner is silently nobody's problem — exactly the thread that
 * waits forever. Each one is handed to a teammate whose presence is
 * "available", starting with the lightest workload, so the work spreads out
 * instead of landing on whoever happens to be first.
 *
 * Runs on each dashboard load, before the data is read, so the escalation is
 * already visible in the inbox the agent is looking at. Assignments are also
 * guarded in the UPDATE (`assignee_user_id IS NULL`) so two concurrent loads
 * cannot both claim the same conversation. No available agent means nothing is
 * changed: the header's breach count is what keeps it visible.
 */
function escalateOverdue(workspaceId: string): number {
  const overdue = db
    .prepare(
      `SELECT id FROM conversations
       WHERE workspace_id = ?
         AND status <> 'resolved'
         AND first_response_at IS NULL
         AND assignee_user_id IS NULL
         AND sla_due_at IS NOT NULL
         AND sla_due_at < ?
       ORDER BY sla_due_at ASC`,
    )
    .all(workspaceId, Date.now()) as { id: string }[];

  if (overdue.length === 0) return 0;

  const available = db
    .prepare(
      `SELECT m.user_id AS id,
              (SELECT COUNT(*) FROM conversations c
               WHERE c.workspace_id = m.workspace_id
                 AND c.assignee_user_id = m.user_id
                 AND c.status <> 'resolved') AS load
       FROM memberships m
       JOIN agent_presence p
         ON p.workspace_id = m.workspace_id AND p.user_id = m.user_id
       WHERE m.workspace_id = ? AND p.status = 'available'
       ORDER BY load, m.rowid`,
    )
    .all(workspaceId) as { id: string; load: number }[];

  if (available.length === 0) return 0;

  const claim = db.prepare(
    `UPDATE conversations SET assignee_user_id = ?
     WHERE id = ? AND workspace_id = ? AND assignee_user_id IS NULL`,
  );

  let escalated = 0;
  overdue.forEach((conversation, index) => {
    const agent = available[index % available.length];
    const result = claim.run(agent.id, conversation.id, workspaceId);
    escalated += Number(result.changes);
  });

  if (escalated > 0) {
    publishWorkspaceEvent(workspaceId, {
      kind: "sla",
      text: `${escalated} overdue conversation${escalated === 1 ? "" : "s"} escalated`,
    });
  }

  return escalated;
}

/**
 * Dashboard loads are the trigger, but the lease makes the sweep safe: two
 * tabs opening at once (or two instances) escalate the backlog once, not twice,
 * and the outcome is recorded alongside the other background jobs.
 */
export function escalateBreaches(workspaceId: string): number {
  const outcome = runJob(`sla-escalation:${workspaceId}`, () =>
    escalateOverdue(workspaceId),
  );
  return outcome.ran ? outcome.result : 0;
}
