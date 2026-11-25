import "server-only";

import { db } from "@/app/lib/db/db";
import type { ChannelId } from "@/app/lib/types";

export type MessageHit = {
  messageId: string;
  conversationId: string;
  contactName: string;
  channel: ChannelId;
  body: string;
  at: number;
};

/**
 * FTS5 treats punctuation as syntax, so every token is quoted and prefix
 * matched: `inv` finds "invoice" without letting a user inject operators.
 */
export function toMatchQuery(query: string) {
  const tokens = query
    .split(/\s+/)
    .map((token) => token.replace(/["*^:()]/g, "").trim())
    .filter(Boolean)
    .slice(0, 8);

  return tokens.map((token) => `"${token}"*`).join(" AND ");
}

export function searchMessages(
  workspaceId: string,
  query: string,
  limit = 5,
): MessageHit[] {
  const match = toMatchQuery(query);
  if (!match) return [];

  try {
    return db
      .prepare(
        `SELECT m.id, m.conversation_id, m.body, m.created_at,
                c.channel_id, ct.name AS contact_name
         FROM messages_fts f
         JOIN messages m ON m.rowid = f.rowid
         JOIN conversations c ON c.id = m.conversation_id
         JOIN contacts ct ON ct.id = c.contact_id
         WHERE messages_fts MATCH ? AND c.workspace_id = ?
         ORDER BY m.created_at DESC
         LIMIT ?`,
      )
      .all(match, workspaceId, limit)
      .map((row) => ({
        messageId: String(row.id),
        conversationId: String(row.conversation_id),
        contactName: String(row.contact_name),
        channel: String(row.channel_id) as ChannelId,
        body: String(row.body),
        at: Number(row.created_at),
      }));
  } catch {
    // A malformed MATCH must read as "no results", never as a broken search.
    return [];
  }
}
