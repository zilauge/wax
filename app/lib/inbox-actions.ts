"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { requireUser } from "./auth";
import { deliverTelegramMessage } from "./channels/telegram";
import { db } from "./db";
import type { Message } from "./types";

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
      `SELECT c.channel_id, ch.name AS channel_name, ct.telegram_chat_id
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
  const delivery =
    channelId === "telegram"
      ? await deliverTelegramMessage(
          conversation.telegram_chat_id
            ? String(conversation.telegram_chat_id)
            : null,
          text,
        )
      : {
          status: "failed" as const,
          error: `${String(conversation.channel_name)} delivery is not wired yet — only Telegram is connected.`,
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
      status: delivery.status,
      error: delivery.error,
    },
  };
}
