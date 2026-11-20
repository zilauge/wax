"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { requireUser } from "@/app/lib/auth/auth";
import { deliverTelegramMessage } from "@/app/lib/channels/telegram";
import { deliverWhatsAppMessage } from "@/app/lib/channels/whatsapp";
import { db } from "@/app/lib/db/db";
import { publishWorkspaceEvent } from "@/app/lib/workspace/realtime";
import type { ChannelId, Message } from "@/app/lib/types";

export type SendMessageResult =
  | { ok: true; message: Message }
  | { ok: false; error: string };

export async function sendMessageAction(
  conversationId: string,
  body: string,
): Promise<SendMessageResult> {
  const user = await requireUser();
  const text = body.trim();

  if (!text) {
    return { ok: false, error: "Write a message before sending." };
  }
  if (text.length > 4000) {
    return { ok: false, error: "Messages are limited to 4000 characters." };
  }

  const conversation = db
    .prepare(
      `SELECT c.channel_id, ch.name AS channel_name, ct.telegram_chat_id,
              (SELECT ci.address FROM contact_identities ci
               WHERE ci.workspace_id = c.workspace_id
                 AND ci.contact_id = c.contact_id
                 AND ci.channel_id = c.channel_id
               ORDER BY ci.created_at LIMIT 1) AS address
       FROM conversations c
       JOIN channels ch ON ch.workspace_id = c.workspace_id AND ch.id = c.channel_id
       JOIN contacts ct ON ct.id = c.contact_id
       WHERE c.id = ? AND c.workspace_id = ?`,
    )
    .get(conversationId, user.workspaceId);

  if (!conversation) {
    return { ok: false, error: "That conversation is not in your workspace." };
  }

  const channelId = String(conversation.channel_id);
  const delivery: { status: "sent" | "failed"; error?: string } =
    channelId === "telegram"
      ? await deliverTelegramMessage(
          conversation.telegram_chat_id
            ? String(conversation.telegram_chat_id)
            : null,
          text,
        )
      : channelId === "whatsapp"
        ? await deliverWhatsAppMessage({
            workspaceId: user.workspaceId,
            address: conversation.address ? String(conversation.address) : null,
            text,
          })
        : {
            status: "failed" as const,
            error: `${String(conversation.channel_name)} delivery is not wired yet — Telegram and WhatsApp are the connected channels.`,
          };

  const id = randomUUID();
  const sentAt = Date.now();

  db.prepare(
    `INSERT INTO messages (id, conversation_id, author, body, created_at, status, error)
     VALUES (?, ?, 'agent', ?, ?, ?, ?)`,
  ).run(id, conversationId, text, sentAt, delivery.status, delivery.error ?? null);

  // The first agent reply stops the queue's first-response clock.
  db.prepare(
    `UPDATE conversations
     SET last_at = ?, unread = 0, first_response_at = COALESCE(first_response_at, ?)
     WHERE id = ?`,
  ).run(sentAt, sentAt, conversationId);

  publishWorkspaceEvent(user.workspaceId, {
    kind: "message",
    conversationId,
    text: `${user.name} replied on ${String(conversation.channel_name)}`,
  });

  refresh();

  return {
    ok: true,
    message: {
      id,
      author: "agent",
      text,
      time: new Date(sentAt).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      at: sentAt,
      channel: channelId as ChannelId,
      status: delivery.status,
      error: delivery.error,
    },
  };
}
