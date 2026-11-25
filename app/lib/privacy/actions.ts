"use server";

import { refresh } from "next/cache";
import { recordAudit } from "@/app/lib/audit/log";
import { requireUser } from "@/app/lib/auth/auth";
import { db } from "@/app/lib/db/db";
import { publishWorkspaceEvent } from "@/app/lib/workspace/realtime";

export type PrivacyResult =
  | { ok: true }
  | { ok: false; error: string };

export type ContactExport = {
  exportedAt: string;
  contact: Record<string, unknown>;
  identities: Record<string, unknown>[];
  conversations: {
    conversation: Record<string, unknown>;
    messages: Record<string, unknown>[];
  }[];
};

function loadContact(contactId: string, workspaceId: string) {
  return db
    .prepare(
      "SELECT id, name, handle, company, color FROM contacts WHERE id = ? AND workspace_id = ?",
    )
    .get(contactId, workspaceId) as Record<string, unknown> | undefined;
}

/**
 * Everything the workspace stores about one person, in one JSON document. It is
 * the answer to a subject-access request, so it includes every thread and note
 * the person appears in, not just the profile row.
 */
export async function exportContactData(
  contactId: string,
): Promise<{ ok: true; data: ContactExport } | { ok: false; error: string }> {
  const user = await requireUser();
  const contact = loadContact(contactId, user.workspaceId);
  if (!contact) return { ok: false, error: "That contact is not in your workspace." };

  // Agents may export the customer they are talking to; the data never leaves
  // the workspace boundary because the id is re-checked against it above.
  const identities = db
    .prepare(
      `SELECT channel_id, address, created_at FROM contact_identities
       WHERE contact_id = ? AND workspace_id = ? ORDER BY created_at`,
    )
    .all(contactId, user.workspaceId) as Record<string, unknown>[];

  const conversationRows = db
    .prepare(
      `SELECT id, channel_id, topic, status, created_at, last_at
       FROM conversations WHERE contact_id = ? AND workspace_id = ?
       ORDER BY last_at DESC`,
    )
    .all(contactId, user.workspaceId) as Record<string, unknown>[];

  const conversations = conversationRows.map((conversation) => ({
    conversation,
    messages: db
      .prepare(
        `SELECT author, body, created_at, status, internal FROM messages
         WHERE conversation_id = ? ORDER BY created_at ASC`,
      )
      .all(String(conversation.id)) as Record<string, unknown>[],
  }));

  recordAudit({
    workspaceId: user.workspaceId,
    actorId: user.id,
    actorName: user.name,
    action: "contact.export",
    target: String(contact.name),
    detail: "Downloaded a full subject-access export",
  });

  return {
    ok: true,
    data: {
      exportedAt: new Date().toISOString(),
      contact,
      identities,
      conversations,
    },
  };
}

/**
 * Erases a person and everything attached to them. Only an owner or admin can
 * do it, because it is irreversible and removes the audit trail of their
 * threads with the workspace.
 */
export async function deleteContactData(contactId: string): Promise<PrivacyResult> {
  const user = await requireUser();
  if (user.role !== "owner" && user.role !== "admin") {
    return { ok: false, error: "Only owners and admins can delete a contact." };
  }

  const contact = loadContact(contactId, user.workspaceId);
  if (!contact) return { ok: false, error: "That contact is not in your workspace." };

  db.exec("BEGIN");
  try {
    db.prepare(
      `DELETE FROM messages WHERE conversation_id IN (
         SELECT id FROM conversations WHERE contact_id = ? AND workspace_id = ?
       )`,
    ).run(contactId, user.workspaceId);
    db.prepare(
      "DELETE FROM conversations WHERE contact_id = ? AND workspace_id = ?",
    ).run(contactId, user.workspaceId);
    db.prepare(
      "DELETE FROM contact_identities WHERE contact_id = ? AND workspace_id = ?",
    ).run(contactId, user.workspaceId);
    db.prepare("DELETE FROM contacts WHERE id = ? AND workspace_id = ?").run(
      contactId,
      user.workspaceId,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  recordAudit({
    workspaceId: user.workspaceId,
    actorId: user.id,
    actorName: user.name,
    action: "contact.delete",
    target: String(contact.name),
    detail: "Deleted the contact, every thread and every message",
  });

  publishWorkspaceEvent(user.workspaceId, {
    kind: "presence",
    text: `${user.name} deleted a contact and its history`,
  });

  refresh();
  return { ok: true };
}
