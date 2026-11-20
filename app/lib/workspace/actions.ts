"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/app/lib/auth/auth";
import { db } from "@/app/lib/db/db";
import { publishWorkspaceEvent } from "@/app/lib/workspace/realtime";
import type { ConversationStatus, PresenceStatus } from "@/app/lib/types";

export type ActionResult = { ok: true } | { ok: false; error: string };

const PRESENCE_VALUES: PresenceStatus[] = ["available", "busy", "away"];

const STATUS_VALUES: ConversationStatus[] = ["open", "pending", "resolved"];

function inWorkspace(conversationId: string, workspaceId: string) {
  return db
    .prepare("SELECT id FROM conversations WHERE id = ? AND workspace_id = ?")
    .get(conversationId, workspaceId);
}

function callInWorkspace(callId: string, workspaceId: string) {
  return db
    .prepare("SELECT id, caller FROM calls WHERE id = ? AND workspace_id = ?")
    .get(callId, workspaceId) as { id: string; caller: string } | undefined;
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

  let assigneeName: string | null = null;

  if (userId !== null) {
    const member = db
      .prepare(
        `SELECT u.name FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.workspace_id = ? AND m.user_id = ?`,
      )
      .get(user.workspaceId, userId) as { name: string } | undefined;

    if (!member) {
      return { ok: false, error: "That person is not on this workspace." };
    }

    assigneeName = member.name;
  }

  db.prepare(
    "UPDATE conversations SET assignee_user_id = ? WHERE id = ? AND workspace_id = ?",
  ).run(userId, conversationId, user.workspaceId);

  publishWorkspaceEvent(user.workspaceId, {
    kind: "assignment",
    conversationId,
    text: assigneeName
      ? `Conversation assigned to ${assigneeName}`
      : "Conversation returned to the queue",
  });

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
    .prepare(
      "SELECT name, sla_minutes FROM queues WHERE id = ? AND workspace_id = ?",
    )
    .get(queueId, user.workspaceId) as
    | { name: string; sla_minutes: number }
    | undefined;

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

  publishWorkspaceEvent(user.workspaceId, {
    kind: "sla",
    conversationId,
    text: `Conversation moved to ${queue.name}`,
  });

  refresh();
  return { ok: true };
}

/**
 * Moves a conversation between open, pending and resolved. Resolving stops the
 * first-response clock; moving back to open/pending restarts it for a thread no
 * agent has answered yet, so a reopened thread is measured against its queue
 * instead of showing an immediate breach from its previous life.
 */
export async function setConversationStatusAction(
  conversationId: string,
  status: ConversationStatus,
): Promise<ActionResult> {
  const user = await requireUser();

  if (!STATUS_VALUES.includes(status)) {
    return { ok: false, error: "Unknown conversation status." };
  }

  const conversation = db
    .prepare(
      `SELECT c.first_response_at, q.sla_minutes
       FROM conversations c
       LEFT JOIN queues q ON q.id = c.queue_id
       WHERE c.id = ? AND c.workspace_id = ?`,
    )
    .get(conversationId, user.workspaceId) as
    | { first_response_at: number | null; sla_minutes: number | null }
    | undefined;

  if (!conversation) {
    return { ok: false, error: "That conversation is not in your workspace." };
  }

  const slaMinutes = conversation.sla_minutes
    ? Number(conversation.sla_minutes)
    : null;

  const dueAt =
    status === "resolved" || conversation.first_response_at !== null || !slaMinutes
      ? null
      : Date.now() + slaMinutes * 60_000;

  db.prepare(
    `UPDATE conversations SET status = ?, sla_due_at = ?
     WHERE id = ? AND workspace_id = ?`,
  ).run(status, dueAt, conversationId, user.workspaceId);

  publishWorkspaceEvent(user.workspaceId, {
    kind: "status",
    conversationId,
    text: `Conversation marked ${status}`,
  });

  refresh();
  return { ok: true };
}

/**
 * Assigns a call to a teammate, or clears it with `null`. Calls share the
 * conversation assignment model, so the target must be a member of the same
 * workspace for exactly the same reason: an id from another tenant must never
 * be able to take a call over.
 */
export async function assignCallAction(
  callId: string,
  userId: string | null,
): Promise<ActionResult> {
  const user = await requireUser();

  const call = callInWorkspace(callId, user.workspaceId);

  if (!call) {
    return { ok: false, error: "That call is not in your workspace." };
  }

  let assigneeName: string | null = null;

  if (userId !== null) {
    const member = db
      .prepare(
        `SELECT u.name FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.workspace_id = ? AND m.user_id = ?`,
      )
      .get(user.workspaceId, userId) as { name: string } | undefined;

    if (!member) {
      return { ok: false, error: "That person is not on this workspace." };
    }

    assigneeName = member.name;
  }

  db.prepare(
    "UPDATE calls SET assignee_user_id = ? WHERE id = ? AND workspace_id = ?",
  ).run(userId, callId, user.workspaceId);

  publishWorkspaceEvent(user.workspaceId, {
    kind: "call",
    callId,
    text: assigneeName
      ? `Call with ${String(call.caller)} assigned to ${assigneeName}`
      : `Call with ${String(call.caller)} returned to the queue`,
  });

  refresh();
  return { ok: true };
}

/** Moves a call into another queue of the same workspace. */
export async function moveCallToQueueAction(
  callId: string,
  queueId: string,
): Promise<ActionResult> {
  const user = await requireUser();

  const call = callInWorkspace(callId, user.workspaceId);

  if (!call) {
    return { ok: false, error: "That call is not in your workspace." };
  }

  const queue = db
    .prepare(
      "SELECT name FROM queues WHERE id = ? AND workspace_id = ?",
    )
    .get(queueId, user.workspaceId) as { name: string } | undefined;

  if (!queue) {
    return { ok: false, error: "That queue is not in this workspace." };
  }

  db.prepare(
    "UPDATE calls SET queue_id = ? WHERE id = ? AND workspace_id = ?",
  ).run(queueId, callId, user.workspaceId);

  publishWorkspaceEvent(user.workspaceId, {
    kind: "call",
    callId,
    text: `Call with ${String(call.caller)} moved to ${queue.name}`,
  });

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

  publishWorkspaceEvent(user.workspaceId, {
    kind: "presence",
    text: `${user.name} is now ${status}`,
  });

  refresh();
  return { ok: true };
}
