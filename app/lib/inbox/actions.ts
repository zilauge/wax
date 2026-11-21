"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { requireUser } from "@/app/lib/auth/auth";
import { deliverTelegramMessage } from "@/app/lib/channels/telegram";
import { deliverDiscordMessage } from "@/app/lib/channels/discord";
import { deliverInstagramMessage } from "@/app/lib/channels/instagram";
import { deliverSmsMessage } from "@/app/lib/channels/twilio";
import { deliverXMessage } from "@/app/lib/channels/x";
import { deliverYouTubeReply } from "@/app/lib/channels/youtube";
import {
  deliverWhatsAppMessage,
  deliverWhatsAppTemplate,
} from "@/app/lib/channels/whatsapp";
import { noteConnectionError } from "@/app/lib/channels/connections";
import { isReplyWindowOpen } from "@/app/lib/channels/window";
import { db } from "@/app/lib/db/db";
import { publishWorkspaceEvent } from "@/app/lib/workspace/realtime";
import type { ChannelId, Message, MessageStatus } from "@/app/lib/types";

export type SendMessageResult =
  | { ok: true; message: Message }
  | { ok: false; error: string };

type Delivery =
  | { status: "sent"; externalId?: string | null }
  | { status: "failed"; error?: string };

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

/** Inbound YouTube messages store `youtube:<top-level comment id>`. */
function youtubeParentCommentId(externalId: string | null) {
  if (!externalId) return null;
  const value = externalId.startsWith("youtube:")
    ? externalId.slice("youtube:".length)
    : externalId;
  return value.trim() || null;
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

  const delivery: Delivery =
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
        : channelId === "instagram"
          ? await deliverInstagramMessage({
              workspaceId: user.workspaceId,
              address: conversation.address
                ? String(conversation.address)
                : null,
              text,
            })
          : channelId === "sms"
            ? await deliverSmsMessage({
                workspaceId: user.workspaceId,
                address: conversation.address
                  ? String(conversation.address)
                  : null,
                text,
              })
            : channelId === "discord"
              ? await deliverDiscordMessage({
                  workspaceId: user.workspaceId,
                  address: conversation.address
                    ? String(conversation.address)
                    : null,
                  text,
                })
              : channelId === "x"
                ? await deliverXMessage({
                    workspaceId: user.workspaceId,
                    address: conversation.address
                      ? String(conversation.address)
                      : null,
                    text,
                  })
                : channelId === "youtube"
                  ? await deliverYouTubeReply({
                      workspaceId: user.workspaceId,
                      parentCommentId: youtubeParentCommentId(
                        conversation.last_inbound_external_id
                          ? String(conversation.last_inbound_external_id)
                          : null,
                      ),
                      text,
                    })
                  : {
                      status: "failed" as const,
                      error: `${String(conversation.channel_name)} delivery is not wired yet.`,
                    };

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

  const delivery = await deliverWhatsAppTemplate({
    workspaceId: user.workspaceId,
    address: conversation.address ? String(conversation.address) : null,
    name,
    language,
    params,
  });

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
