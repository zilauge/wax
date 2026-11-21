import "server-only";

import { randomUUID } from "node:crypto";
import { db } from "@/app/lib/db/db";
import type {
  ChannelAuditEntry,
  ChannelConnection,
  ChannelId,
} from "@/app/lib/types";
import type { SocialChannelId } from "@/app/lib/channels/providers";

/** The API family behind a channel, stored so inbound routing can rely on it. */
export function providerForChannel(channel: ChannelId): string {
  if (channel === "instagram" || channel === "whatsapp") return "meta";
  if (channel === "sms") return "twilio";
  if (channel === "youtube") return "google";
  return channel;
}

export function listConnections(workspaceId: string): ChannelConnection[] {
  return db
    .prepare(
      `SELECT channel_id, provider, account_name, connected_at, last_error,
              inbound_state, inbound_note
       FROM channel_connections WHERE workspace_id = ?`,
    )
    .all(workspaceId)
    .map((row) => ({
      channel: String(row.channel_id) as ChannelId,
      provider: String(row.provider),
      accountName: row.account_name ? String(row.account_name) : null,
      connectedAt: row.connected_at ? Number(row.connected_at) : null,
      lastError: row.last_error ? String(row.last_error) : null,
      inboundState:
        row.inbound_state === "ready" || row.inbound_state === "unavailable"
          ? row.inbound_state
          : null,
      inboundNote: row.inbound_note ? String(row.inbound_note) : null,
    }));
}

/**
 * Records the linked account and its token; both stay server-side. The unique
 * (provider, external_id) pair is checked first so a second workspace cannot
 * claim the same account and steal its inbound messages.
 */
export function saveConnection({
  workspaceId,
  channel,
  provider,
  externalId,
  accountName,
  accessToken,
}: {
  workspaceId: string;
  channel: ChannelId;
  provider: string;
  externalId: string;
  accountName: string;
  accessToken: string;
}) {
  const claimed = db
    .prepare(
      `SELECT workspace_id FROM channel_connections
       WHERE provider = ? AND external_id = ? AND workspace_id <> ?`,
    )
    .get(provider, externalId, workspaceId);

  if (claimed) {
    throw new Error(
      "That account is already linked to another workspace. Disconnect it there first.",
    );
  }

  db.prepare(
    `INSERT INTO channel_connections
       (workspace_id, channel_id, provider, external_id, account_name, access_token, last_error, connected_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT (workspace_id, channel_id) DO UPDATE SET
       provider = excluded.provider,
       external_id = excluded.external_id,
       account_name = excluded.account_name,
       access_token = excluded.access_token,
       last_error = NULL,
       connected_at = excluded.connected_at`,
  ).run(
    workspaceId,
    channel,
    provider,
    externalId,
    accountName,
    accessToken,
    Date.now(),
  );

  db.prepare(
    "UPDATE channels SET connected = 1, handle = ? WHERE workspace_id = ? AND id = ?",
  ).run(accountName, workspaceId, channel);
}

export function deleteConnection(workspaceId: string, channel: ChannelId) {
  db.prepare(
    "DELETE FROM channel_connections WHERE workspace_id = ? AND channel_id = ?",
  ).run(workspaceId, channel);
  db.prepare(
    "UPDATE channels SET connected = 0, handle = '' WHERE workspace_id = ? AND id = ?",
  ).run(workspaceId, channel);
}

/** Keeps the last provider error on the connection so settings can show it. */
export function noteConnectionError(
  workspaceId: string,
  channel: ChannelId,
  message: string | null,
) {
  db.prepare(
    "UPDATE channel_connections SET last_error = ? WHERE workspace_id = ? AND channel_id = ?",
  ).run(message, workspaceId, channel);
}

export function logChannelAudit({
  workspaceId,
  channel,
  action,
  actorUserId,
  actorName,
}: {
  workspaceId: string;
  channel: SocialChannelId | ChannelId;
  action: "connected" | "disconnected";
  actorUserId: string;
  actorName: string;
}) {
  db.prepare(
    `INSERT INTO channel_audit
       (id, workspace_id, channel_id, action, actor_user_id, actor_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    workspaceId,
    channel,
    action,
    actorUserId,
    actorName,
    Date.now(),
  );
}

export function listChannelAudit(
  workspaceId: string,
  limit = 8,
): ChannelAuditEntry[] {
  return db
    .prepare(
      `SELECT id, channel_id, action, actor_name, created_at
       FROM channel_audit
       WHERE workspace_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(workspaceId, limit)
    .map((row) => ({
      id: String(row.id),
      channel: String(row.channel_id) as ChannelId,
      action: String(row.action) as ChannelAuditEntry["action"],
      actorName: String(row.actor_name),
      at: Number(row.created_at),
    }));
}
