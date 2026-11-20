"use server";

import { refresh } from "next/cache";
import { requireUser } from "./auth";
import { db } from "./db";
import type { PresenceStatus } from "./types";

export type ActionResult = { ok: true } | { ok: false; error: string };

const PRESENCE_VALUES: PresenceStatus[] = ["available", "busy", "away"];

function inWorkspace(conversationId: string, workspaceId: string) {
  return db
    .prepare("SELECT id FROM conversations WHERE id = ? AND workspace_id = ?")
    .get(conversationId, workspaceId);
}

/**
 * Assigns a conversation to a teammate, or clears it back to the queue with
 * `null`. The target must be a member of the same workspace, so an id from
 * another tenant can never be used to take a conversation over.
 */
export async function assignConversationAction(
  conversationId: string,
  userId: string | null,
): Promise<ActionResult> {
  const user = await requireUser();

  if (!inWorkspace(conversationId, user.workspaceId)) {
    return { ok: false, error: "That conversation is not in your workspace." };
  }

  if (userId !== null) {
    const member = db
      .prepare(
        "SELECT 1 AS ok FROM memberships WHERE workspace_id = ? AND user_id = ?",
      )
      .get(user.workspaceId, userId);

    if (!member) {
      return { ok: false, error: "That person is not on this workspace." };
    }
  }

  db.prepare(
    "UPDATE conversations SET assignee_user_id = ? WHERE id = ? AND workspace_id = ?",
  ).run(userId, conversationId, user.workspaceId);

  refresh();
  return { ok: true };
}

/** Moves a conversation into another queue of the same workspace. */
export async function moveToQueueAction(
  conversationId: string,
  queueId: string,
): Promise<ActionResult> {
  const user = await requireUser();

  if (!inWorkspace(conversationId, user.workspaceId)) {
    return { ok: false, error: "That conversation is not in your workspace." };
  }

  const queue = db
    .prepare("SELECT sla_minutes FROM queues WHERE id = ? AND workspace_id = ?")
    .get(queueId, user.workspaceId);

  if (!queue) {
    return { ok: false, error: "That queue is not in this workspace." };
  }

  const conversation = db
    .prepare(
      "SELECT first_response_at, last_at FROM conversations WHERE id = ?",
    )
    .get(conversationId) as { first_response_at: number | null; last_at: number };

  // An unanswered conversation takes the new queue's deadline with it.
  const dueAt = conversation.first_response_at
    ? null
    : Number(conversation.last_at) + Number(queue.sla_minutes) * 60_000;

  db.prepare(
    `UPDATE conversations
     SET queue_id = ?, sla_due_at = ?
     WHERE id = ? AND workspace_id = ?`,
  ).run(queueId, dueAt, conversationId, user.workspaceId);

  refresh();
  return { ok: true };
}

/** Sets the signed-in person's own presence. */
export async function setPresenceAction(
  status: PresenceStatus,
): Promise<ActionResult> {
  const user = await requireUser();

  if (!PRESENCE_VALUES.includes(status)) {
    return { ok: false, error: "Unknown presence status." };
  }

  db.prepare(
    `INSERT INTO agent_presence (workspace_id, user_id, status, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(workspace_id, user_id) DO UPDATE SET
       status = excluded.status,
       updated_at = excluded.updated_at`,
  ).run(user.workspaceId, user.id, status, Date.now());

  refresh();
  return { ok: true };
}
