import type { DatabaseSync } from "node:sqlite";


/**
 * Round-robin routing: pick the next agent who is marked available, preferring
 * whoever has the fewest open conversations, and remember the last choice so
 * consecutive arrivals rotate instead of stacking on one person.
 *
 * Returns the chosen user id, or null when nobody is available — the thread
 * then stays in the queue for a human to pick up, which is visible in the desk.
 */
export function assignNewConversation(
  database: DatabaseSync,
  workspaceId: string,
  conversationId: string,
): string | null {
  const candidates = database
    .prepare(
      `SELECT m.user_id,
              (SELECT COUNT(*) FROM conversations c
               WHERE c.workspace_id = m.workspace_id
                 AND c.assignee_user_id = m.user_id
                 AND c.status != 'resolved') AS open_count
       FROM memberships m
       LEFT JOIN agent_presence p
         ON p.workspace_id = m.workspace_id AND p.user_id = m.user_id
       WHERE m.workspace_id = ? AND COALESCE(p.status, 'away') = 'available'
       ORDER BY open_count ASC, m.user_id ASC`,
    )
    .all(workspaceId)
    .map((row) => ({ id: String(row.user_id), open: Number(row.open_count ?? 0) }));

  if (candidates.length === 0) return null;

  const last = database
    .prepare("SELECT last_user_id FROM routing_state WHERE workspace_id = ?")
    .get(workspaceId) as { last_user_id: string | null } | undefined;
  const lastIndex = last
    ? candidates.findIndex((candidate) => candidate.id === last.last_user_id)
    : -1;
  const chosen = candidates[(lastIndex + 1) % candidates.length];

  database
    .prepare(
      `INSERT INTO routing_state (workspace_id, last_user_id) VALUES (?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET last_user_id = excluded.last_user_id`,
    )
    .run(workspaceId, chosen.id);

  database
    .prepare(
      `UPDATE conversations SET assignee_user_id = ?
       WHERE id = ? AND workspace_id = ? AND assignee_user_id IS NULL`,
    )
    .run(chosen.id, conversationId, workspaceId);

  return chosen.id;
}
