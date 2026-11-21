import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  attachIdentity,
  findIdentityAcrossChannels,
  findIdentityInChannel,
} from "@/app/lib/contacts/identities";
import { normalizeIdentity } from "@/app/lib/contacts/identity";
import type { ChannelId } from "@/app/lib/types";

export type InboundOutcome = "accepted" | "duplicate" | "ignored";

/**
 * Files one customer message from any webhook-driven channel.
 *
 * The tenant is always passed in by the caller, which resolved it from the
 * provider account that received the event — never from the request body alone.
 * The sender is matched through contact identities before a new contact is
 * created, and the provider's own message id is the dedupe key, because every
 * provider retries webhooks.
 */
export function recordInboundMessage(
  database: DatabaseSync,
  {
    workspaceId,
    channel,
    rawAddress,
    senderName,
    text,
    receivedAt,
    externalId,
    company,
    color,
  }: {
    workspaceId: string;
    channel: ChannelId;
    rawAddress: string;
    senderName: string;
    text: string;
    receivedAt: number;
    externalId: string;
    company: string;
    color: string;
  },
): InboundOutcome {
  const address = normalizeIdentity(rawAddress);
  if (!address) return "ignored";

  let contactId =
    findIdentityInChannel(database, workspaceId, channel, address.address)
      ?.contactId ??
    findIdentityAcrossChannels(database, workspaceId, address.address, channel)
      ?.contactId ??
    null;

  if (!contactId) {
    contactId = randomUUID();
    database
      .prepare(
        `INSERT INTO contacts (id, workspace_id, name, handle, company, color)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(contactId, workspaceId, senderName, address.address, company, color);
  }

  attachIdentity(database, {
    workspaceId,
    contactId,
    channelId: channel,
    raw: rawAddress,
  });

  const existing = database
    .prepare(
      `SELECT id FROM conversations
       WHERE workspace_id = ? AND channel_id = ? AND contact_id = ?
       ORDER BY last_at DESC LIMIT 1`,
    )
    .get(workspaceId, channel, contactId);

  const defaultQueue = database
    .prepare(
      "SELECT id, sla_minutes FROM queues WHERE workspace_id = ? ORDER BY position LIMIT 1",
    )
    .get(workspaceId) as { id: string; sla_minutes: number } | undefined;

  const slaMinutes = defaultQueue ? Number(defaultQueue.sla_minutes) : 15;

  let conversationId = existing ? String(existing.id) : null;

  if (!conversationId) {
    conversationId = randomUUID();
    database
      .prepare(
        `INSERT INTO conversations
           (id, workspace_id, channel_id, contact_id, topic, status, queue_id,
            first_response_at, sla_due_at, unread, last_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?, NULL, ?, 0, ?)`,
      )
      .run(
        conversationId,
        workspaceId,
        channel,
        contactId,
        text.length > 60 ? `${text.slice(0, 57)}…` : text,
        defaultQueue?.id ?? null,
        receivedAt + slaMinutes * 60_000,
        receivedAt,
      );
  }

  const inserted = database
    .prepare(
      `INSERT OR IGNORE INTO messages
         (id, conversation_id, author, body, created_at, status, external_id)
       VALUES (?, ?, 'contact', ?, ?, 'sent', ?)`,
    )
    .run(
      randomUUID(),
      conversationId,
      text,
      receivedAt,
      `${channel}:${externalId}`,
    );

  if (Number(inserted.changes) === 0) return "duplicate";

  database
    .prepare(
      `UPDATE conversations
       SET unread = unread + 1,
           last_at = ?,
           sla_due_at = COALESCE(sla_due_at, ?)
       WHERE id = ? AND workspace_id = ?`,
    )
    .run(
      receivedAt,
      receivedAt + slaMinutes * 60_000,
      conversationId,
      workspaceId,
    );

  return "accepted";
}

/** The conversation a just-recorded inbound message landed in. */
export function latestConversationFor(
  database: DatabaseSync,
  workspaceId: string,
  channel: ChannelId,
  rawAddress: string,
): string | null {
  const address = normalizeIdentity(rawAddress);
  if (!address) return null;

  const row = database
    .prepare(
      `SELECT c.id FROM conversations c
       JOIN contact_identities ci
         ON ci.contact_id = c.contact_id
        AND ci.workspace_id = c.workspace_id
        AND ci.channel_id = c.channel_id
       WHERE c.workspace_id = ? AND c.channel_id = ? AND ci.address = ?
       ORDER BY c.last_at DESC LIMIT 1`,
    )
    .get(workspaceId, channel, address.address);

  return row ? String(row.id) : null;
}
