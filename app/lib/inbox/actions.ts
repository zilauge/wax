"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { requireUser } from "@/app/lib/auth/auth";
import {
  dispatchDelivery,
  dispatchTemplate,
  type Delivery,
  type DeliveryTarget,
} from "@/app/lib/inbox/delivery";
import { noteConnectionError } from "@/app/lib/channels/connections";
import { isReplyWindowOpen } from "@/app/lib/channels/window";
import { db } from "@/app/lib/db/db";
import { publishWorkspaceEvent } from "@/app/lib/workspace/realtime";
import type { ChannelId, Message, MessageStatus } from "@/app/lib/types";

export type SendMessageResult =
  | { ok: true; message: Message }
  | { ok: false; error: string };

type ConversationRow = {
  channel_id: string;
  channel_name: string;
  telegram_chat_id: string | null;
  address: string | null;
  last_inbound_at: number | null;
  /** YouTube replies attach to the comment their thread started from. */
  last_inbound_external_id: string | null;
};

function loadConversation(
  conversationId: string,
  workspaceId: string,
): ConversationRow | null {
  const row = db
    .prepare(
      `SELECT c.channel_id, ch.name AS channel_name, ct.telegram_chat_id,
              (SELECT ci.address FROM contact_identities ci
               WHERE ci.workspace_id = c.workspace_id
                 AND ci.contact_id = c.contact_id
                 AND ci.channel_id = c.channel_id
               ORDER BY ci.created_at LIMIT 1) AS address,
              (SELECT MAX(m.created_at) FROM messages m
               WHERE m.conversation_id = c.id AND m.author = 'contact')
                AS last_inbound_at,
              (SELECT m.external_id FROM messages m
               WHERE m.conversation_id = c.id AND m.author = 'contact'
               ORDER BY m.created_at DESC LIMIT 1)
                AS last_inbound_external_id
       FROM conversations c
       JOIN channels ch ON ch.workspace_id = c.workspace_id AND ch.id = c.channel_id
       JOIN contacts ct ON ct.id = c.contact_id
       WHERE c.id = ? AND c.workspace_id = ?`,
    )
    .get(conversationId, workspaceId) as ConversationRow | undefined;

  return row ?? null;
}

function toAgentMessage({
  id,
  text,
  at,
  channel,
  status,
  error,
}: {
  id: string;
  text: string;
  at: number;
  channel: string;
  status: MessageStatus;
  error?: string;
}): Message {
  return {
    id,
    author: "agent",
    text,
    time: new Date(at).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    at,
    channel: channel as ChannelId,
    status,
    error: error ?? null,
  };
}

/** A retried submission returns the message it already created. */
function existingByNonce(
  nonce: string,
  conversationId: string,
  workspaceId: string,
): Message | null {
  const row = db
    .prepare(
      `SELECT m.id, m.body, m.created_at, m.status, m.error
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.client_nonce = ? AND m.conversation_id = ?
         AND m.author = 'agent' AND c.workspace_id = ?`,
    )
    .get(nonce, conversationId, workspaceId);

  if (!row) return null;

  const conversation = db
    .prepare("SELECT channel_id FROM conversations WHERE id = ?")
    .get(conversationId);

  return toAgentMessage({
    id: String(row.id),
    text: String(row.body),
    at: Number(row.created_at),
    channel: String(conversation?.channel_id ?? ""),
    status: String(row.status) as MessageStatus,
    error: row.error ? String(row.error) : undefined,
  });
}

/** Stores an agent reply, its provider id for receipts and its idempotency key. */
function recordReply({
  conversationId,
  workspaceId,
  text,
  delivery,
  nonce,
  channelId,
  channelName,
  userName,
}: {
  conversationId: string;
  workspaceId: string;
  text: string;
  delivery: Delivery;
  nonce: string | null;
  channelId: string;
  channelName: string;
  userName: string;
}) {
  const id = randomUUID();
  const sentAt = Date.now();

  db.prepare(
    `INSERT INTO messages
       (id, conversation_id, author, body, created_at, status, error, external_id, client_nonce)
     VALUES (?, ?, 'agent', ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    conversationId,
    text,
    sentAt,
    delivery.status,
    delivery.status === "failed" ? (delivery.error ?? null) : null,
    delivery.status === "sent" ? (delivery.externalId ?? null) : null,
    nonce,
  );

  // The first agent reply stops the queue's first-response clock.
  db.prepare(
    `UPDATE conversations
     SET last_at = ?, unread = 0, first_response_at = COALESCE(first_response_at, ?)
     WHERE id = ? AND workspace_id = ?`,
  ).run(sentAt, sentAt, conversationId, workspaceId);

  const error = delivery.status === "failed" ? delivery.error : undefined;

  // A successful send clears the stale failure shown on the channel card.
  noteConnectionError(workspaceId, channelId as ChannelId, error ?? null);

  publishWorkspaceEvent(workspaceId, {
    kind: "message",
    conversationId,
    text: `${userName} replied on ${channelName}`,
  });

  return toAgentMessage({
    id,
    text,
    at: sentAt,
    channel: channelId,
    status: delivery.status,
    error,
  });
}

function targetFor(
  conversation: ConversationRow,
  workspaceId: string,
): DeliveryTarget {
  return {
    channel: String(conversation.channel_id),
    channelName: String(conversation.channel_name),
    telegramChatId: conversation.telegram_chat_id
      ? String(conversation.telegram_chat_id)
      : null,
    address: conversation.address ? String(conversation.address) : null,
    lastInboundExternalId: conversation.last_inbound_external_id
      ? String(conversation.last_inbound_external_id)
      : null,
    workspaceId,
  };
}

export async function sendMessageAction(
  conversationId: string,
  body: string,
  clientNonce?: string,
): Promise<SendMessageResult> {
  const user = await requireUser();
  const text = body.trim();
  const nonce = clientNonce?.trim() || null;

  if (nonce) {
    const existing = existingByNonce(nonce, conversationId, user.workspaceId);
    if (existing) return { ok: true, message: existing };
  }

  if (!text) {
    return { ok: false, error: "Write a message before sending." };
  }
  if (text.length > 4000) {
    return { ok: false, error: "Messages are limited to 4000 characters." };
  }

  const conversation = loadConversation(conversationId, user.workspaceId);
  if (!conversation) {
    return { ok: false, error: "That conversation is not in your workspace." };
  }

  const channelId = String(conversation.channel_id);

  if (channelId === "whatsapp" || channelId === "instagram") {
    const lastInbound = conversation.last_inbound_at
      ? Number(conversation.last_inbound_at)
      : null;
    if (!isReplyWindowOpen(lastInbound)) {
      return {
        ok: false,
        error:
          channelId === "whatsapp"
            ? "WhatsApp's 24-hour reply window is closed. Send an approved template instead of free text."
            : "Instagram only accepts free-form replies within 24 hours of the customer's last message.",
      };
    }
  }

  const delivery = await dispatchDelivery(
    targetFor(conversation, user.workspaceId),
    text,
  );

  const message = recordReply({
    conversationId,
    workspaceId: user.workspaceId,
    text,
    delivery,
    nonce,
    channelId,
    channelName: String(conversation.channel_name),
    userName: user.name,
  });

  refresh();
  return { ok: true, message };
}

export async function sendTemplateAction(
  conversationId: string,
  input: { name: string; language: string; params: string[] },
  clientNonce?: string,
): Promise<SendMessageResult> {
  const user = await requireUser();
  const name = input.name.trim();
  const language = input.language.trim() || "en_US";
  const params = input.params.map((value) => value.trim()).filter(Boolean);
  const nonce = clientNonce?.trim() || null;

  if (nonce) {
    const existing = existingByNonce(nonce, conversationId, user.workspaceId);
    if (existing) return { ok: true, message: existing };
  }

  if (!/^[a-z0-9_]{1,512}$/i.test(name)) {
    return { ok: false, error: "Enter the approved template's exact name." };
  }

  const conversation = loadConversation(conversationId, user.workspaceId);
  if (!conversation || String(conversation.channel_id) !== "whatsapp") {
    return { ok: false, error: "Templates can only be sent on a WhatsApp conversation." };
  }

  const delivery = await dispatchTemplate(
    targetFor(conversation, user.workspaceId),
    { name, language, params },
  );

  const message = recordReply({
    conversationId,
    workspaceId: user.workspaceId,
    text: `Template: ${name}`,
    delivery,
    nonce,
    channelId: "whatsapp",
    channelName: String(conversation.channel_name),
    userName: user.name,
  });

  refresh();
  return { ok: true, message };
}

/**
 * An internal note lives in the thread for teammates and is never handed to a
 * provider. It deliberately does not clear unread or stop the SLA clock.
 */
export async function sendNoteAction(
  conversationId: string,
  body: string,
): Promise<SendMessageResult> {
  const user = await requireUser();
  const text = body.trim();

  if (!text) return { ok: false, error: "Write a note before saving." };
  if (text.length > 4000) {
    return { ok: false, error: "Notes are limited to 4000 characters." };
  }

  const conversation = loadConversation(conversationId, user.workspaceId);
  if (!conversation) {
    return { ok: false, error: "That conversation is not in your workspace." };
  }

  const id = randomUUID();
  const at = Date.now();

  db.prepare(
    `INSERT INTO messages
       (id, conversation_id, author, body, created_at, status, error, external_id, client_nonce, internal)
     VALUES (?, ?, 'agent', ?, ?, 'sent', NULL, NULL, NULL, 1)`,
  ).run(id, conversationId, text, at);

  db.prepare(
    "UPDATE conversations SET last_at = ? WHERE id = ? AND workspace_id = ?",
  ).run(at, conversationId, user.workspaceId);

  publishWorkspaceEvent(user.workspaceId, {
    kind: "message",
    conversationId,
    text: `${user.name} left an internal note`,
  });

  refresh();
  return {
    ok: true,
    message: {
      id,
      author: "agent",
      text,
      time: new Date(at).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      at,
      channel: String(conversation.channel_id) as ChannelId,
      status: "sent",
      error: null,
      internal: true,
      retryCount: 0,
    },
  };
}

/** Re-sends a reply that a provider refused, updating the same thread entry. */
export async function retryMessageAction(
  messageId: string,
): Promise<SendMessageResult> {
  const user = await requireUser();

  const row = db
    .prepare(
      `SELECT m.id, m.conversation_id, m.body, m.status, m.internal, m.author,
              m.retry_count
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.id = ? AND c.workspace_id = ?`,
    )
    .get(messageId, user.workspaceId) as
    | {
        id: string;
        conversation_id: string;
        body: string;
        status: string;
        internal: number;
        author: string;
        retry_count: number;
      }
    | undefined;

  if (!row) {
    return { ok: false, error: "That message is not in your workspace." };
  }
  if (String(row.author) !== "agent" || Number(row.internal) === 1) {
    return { ok: false, error: "Only your own replies can be retried." };
  }
  if (String(row.status) !== "failed") {
    return { ok: false, error: "That message was already delivered." };
  }

  const conversationId = String(row.conversation_id);
  const conversation = loadConversation(conversationId, user.workspaceId);
  if (!conversation) {
    return { ok: false, error: "That conversation is not in your workspace." };
  }

  const channelId = String(conversation.channel_id);
  if (channelId === "whatsapp" || channelId === "instagram") {
    const lastInbound = conversation.last_inbound_at
      ? Number(conversation.last_inbound_at)
      : null;
    if (!isReplyWindowOpen(lastInbound)) {
      return {
        ok: false,
        error: "The reply window closed, so this message can no longer be sent.",
      };
    }
  }

  const text = String(row.body);
  const delivery = await dispatchDelivery(
    targetFor(conversation, user.workspaceId),
    text,
  );
  const at = Date.now();

  db.prepare(
    `UPDATE messages
     SET status = ?, error = ?, external_id = ?, retry_count = retry_count + 1,
         last_attempt_at = ?
     WHERE id = ?`,
  ).run(
    delivery.status,
    delivery.status === "failed" ? (delivery.error ?? null) : null,
    delivery.status === "sent" ? (delivery.externalId ?? null) : null,
    at,
    messageId,
  );

  if (delivery.status === "sent") {
    db.prepare(
      `UPDATE conversations
       SET last_at = ?,
           first_response_at = COALESCE(first_response_at, ?)
       WHERE id = ? AND workspace_id = ?`,
    ).run(at, at, conversationId, user.workspaceId);
  }

  noteConnectionError(
    user.workspaceId,
    channelId as ChannelId,
    delivery.status === "failed" ? (delivery.error ?? null) : null,
  );

  publishWorkspaceEvent(user.workspaceId, {
    kind: "message",
    conversationId,
    text:
      delivery.status === "sent"
        ? `${user.name}'s retry was delivered on ${String(conversation.channel_name)}`
        : `A retry failed again on ${String(conversation.channel_name)}`,
  });

  refresh();
  return {
    ok: true,
    message: toAgentMessage({
      id: messageId,
      text,
      at,
      channel: channelId,
      status: delivery.status,
      error: delivery.status === "failed" ? delivery.error : undefined,
    }),
  };
}
