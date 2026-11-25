import "server-only";

import { randomUUID } from "node:crypto";
import { db } from "@/app/lib/db/db";
import type { AuditEntry } from "@/app/lib/types";

/**
 * An append-only trail for actions that cannot be undone or that take customer
 * data out of the workspace: contact export and delete, role changes, invites.
 * It deliberately records the actor's name as well as their id, so the entry
 * still reads correctly after someone leaves the workspace.
 */
export function recordAudit({
  workspaceId,
  actorId,
  actorName,
  action,
  target,
  detail = null,
}: {
  workspaceId: string;
  actorId: string | null;
  actorName: string;
  action: string;
  target: string;
  detail?: string | null;
}) {
  db.prepare(
    `INSERT INTO audit_log
       (id, workspace_id, actor_user_id, actor_name, action, target, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    workspaceId,
    actorId,
    actorName,
    action,
    target,
    detail,
    Date.now(),
  );
}

export function listAudit(workspaceId: string, limit = 40): AuditEntry[] {
  return db
    .prepare(
      `SELECT id, actor_name, action, target, detail, created_at
       FROM audit_log
       WHERE workspace_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`,
    )
    .all(workspaceId, limit)
    .map((row) => ({
      id: String(row.id),
      actorName: String(row.actor_name),
      action: String(row.action),
      target: String(row.target),
      detail: row.detail ? String(row.detail) : null,
      at: Number(row.created_at),
    }));
}
