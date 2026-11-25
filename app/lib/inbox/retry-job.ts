import "server-only";

import { db } from "@/app/lib/db/db";
import { backoffMs } from "@/app/lib/inbox/backoff";
import { dispatchDelivery, type DeliveryTarget } from "@/app/lib/inbox/delivery";
import { runJob } from "@/app/lib/jobs/runner";
import { publishWorkspaceEvent } from "@/app/lib/workspace/realtime";

const MAX_ATTEMPTS = 3;

export { backoffMs };

type DueRow = {
  id: string;
  body: string;
  retry_count: number;
  conversation_id: string;
  workspace_id: string;
  channel_id: string;
  channel_name: string;
  telegram_chat_id: string | null;
  address: string | null;
  last_inbound_external_id: string | null;
  attempted_at: number;
};

/**
 * Automatic retry with backoff for replies a provider rejected. Only messages
 * that failed are touched, at most three automatic attempts each, and the
 * provider's own error stays on the row so a person can still see why.
 */
export async function retryDueMessages(now = Date.now()) {
  const rows = db
    .prepare(
      `SELECT m.id, m.body, m.retry_count, c.id AS conversation_id,
              c.workspace_id, c.channel_id, ch.name AS channel_name,
              ct.telegram_chat_id,
              (SELECT ci.address FROM contact_identities ci
               WHERE ci.workspace_id = c.workspace_id
                 AND ci.contact_id = c.contact_id
                 AND ci.channel_id = c.channel_id
               ORDER BY ci.created_at LIMIT 1) AS address,
              (SELECT im.external_id FROM messages im
               WHERE im.conversation_id = c.id AND im.author = 'contact'
               ORDER BY im.created_at DESC LIMIT 1) AS last_inbound_external_id,
              COALESCE(m.last_attempt_at, m.created_at) AS attempted_at
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN channels ch ON ch.workspace_id = c.workspace_id AND ch.id = c.channel_id
       JOIN contacts ct ON ct.id = c.contact_id
       WHERE m.status = 'failed' AND m.internal = 0 AND m.author = 'agent'
         AND m.retry_count < ?
       ORDER BY m.created_at ASC
       LIMIT 25`,
    )
    .all(MAX_ATTEMPTS) as DueRow[];

  const due = rows.filter(
    (row) => now - Number(row.attempted_at) >= backoffMs(Number(row.retry_count)),
  );

  let delivered = 0;
  for (const row of due) {
    const target: DeliveryTarget = {
      channel: String(row.channel_id),
      channelName: String(row.channel_name),
      telegramChatId: row.telegram_chat_id ? String(row.telegram_chat_id) : null,
      address: row.address ? String(row.address) : null,
      lastInboundExternalId: row.last_inbound_external_id
        ? String(row.last_inbound_external_id)
        : null,
      workspaceId: String(row.workspace_id),
    };

    const delivery = await dispatchDelivery(target, String(row.body));
    const at = Date.now();

    db.prepare(
      `UPDATE messages
       SET status = ?, error = ?, external_id = COALESCE(?, external_id),
           retry_count = retry_count + 1, last_attempt_at = ?
       WHERE id = ?`,
    ).run(
      delivery.status,
      delivery.status === "failed" ? (delivery.error ?? null) : null,
      delivery.status === "sent" ? (delivery.externalId ?? null) : null,
      at,
      String(row.id),
    );

    if (delivery.status === "sent") {
      delivered += 1;
      db.prepare(
        `UPDATE conversations
         SET last_at = ?, first_response_at = COALESCE(first_response_at, ?)
         WHERE id = ? AND workspace_id = ?`,
      ).run(at, at, String(row.conversation_id), String(row.workspace_id));

      publishWorkspaceEvent(String(row.workspace_id), {
        kind: "message",
        conversationId: String(row.conversation_id),
        text: `Retry delivered on ${String(row.channel_name)}`,
      });
    }
  }

  return { attempted: due.length, delivered };
}

/**
 * Runs the queue every minute. The interval is unref'd so a short-lived script
 * that imports the app is not held open by the retry loop.
 */
export function startRetryLoop() {
  if (process.env.WAX_RETRY_DISABLED === "1") return;

  const timer = setInterval(() => {
    // The lease keeps two server instances, or a timer racing an external
    // cron, from delivering the same failed message twice.
    runJob("delivery-retry", () => retryDueMessages());
  }, 60_000);
  timer.unref?.();
}
