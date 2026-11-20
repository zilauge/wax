import "server-only";

import { db } from "@/app/lib/db/db";
import type { ChannelConnection, ChannelId } from "@/app/lib/types";
import type { SocialChannelId } from "@/app/lib/channels/providers";

export function listConnections(workspaceId: string): ChannelConnection[] {
  return db
    .prepare(
      "SELECT channel_id, account_name FROM channel_connections WHERE workspace_id = ?",
    )
    .all(workspaceId)
    .map((row) => ({
      channel: String(row.channel_id) as ChannelId,
      accountName: row.account_name ? String(row.account_name) : null,
    }));
}

/** Records the linked account and its token; both stay server-side. */
export function saveConnection({
  workspaceId,
  channel,
  externalId,
  accountName,
  accessToken,
}: {
  workspaceId: string;
  channel: SocialChannelId;
  externalId: string;
  accountName: string;
  accessToken: string;
}) {
  db.prepare(
    `INSERT INTO channel_connections
       (workspace_id, channel_id, external_id, account_name, access_token, connected_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (workspace_id, channel_id) DO UPDATE SET
       external_id = excluded.external_id,
       account_name = excluded.account_name,
       access_token = excluded.access_token,
       connected_at = excluded.connected_at`,
  ).run(workspaceId, channel, externalId, accountName, accessToken, Date.now());

  db.prepare(
    "UPDATE channels SET connected = 1, handle = ? WHERE workspace_id = ? AND id = ?",
  ).run(accountName, workspaceId, channel);
}

export function deleteConnection(workspaceId: string, channel: SocialChannelId) {
  db.prepare(
    "DELETE FROM channel_connections WHERE workspace_id = ? AND channel_id = ?",
  ).run(workspaceId, channel);
  db.prepare(
    "UPDATE channels SET connected = 0, handle = '' WHERE workspace_id = ? AND id = ?",
  ).run(workspaceId, channel);
}
