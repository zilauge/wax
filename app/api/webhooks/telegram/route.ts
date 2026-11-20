import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  countTelegramBindings,
  resolveTelegramBinding,
} from "@/app/lib/channels/telegram-binding";
import {
  attachIdentity,
  findIdentityAcrossChannels,
  findIdentityInChannel,
} from "@/app/lib/contacts/identities";
import { db } from "@/app/lib/db/db";
import { normalizeIdentity } from "@/app/lib/contacts/identity";
import { publishWorkspaceEvent } from "@/app/lib/workspace/realtime";

type TelegramUpdate = {
  update_id?: number;
  message?: {
    message_id?: number;
    date?: number;
    text?: string;
    chat?: { id?: number | string };
    from?: { first_name?: string; last_name?: string; username?: string };
  };
};

/**
 * Inbound Telegram messages. Telegram calls this endpoint for every update, so
 * it authenticates with the secret token set via setWebhook and deduplicates on
 * the Telegram message id before writing anything.
 *
 * The destination workspace comes from the bot's own secret (see
 * app/lib/channels/telegram-binding.ts). An update from a bot that is not bound
 * to a workspace is rejected rather than filed somewhere — a fallback would put
 * one tenant's customer messages in another tenant's inbox.
 */
export async function POST(request: Request) {
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Missing webhook secret." },
      { status: 401 },
    );
  }

  const binding = resolveTelegramBinding(secret);

  if (!binding) {
    const bound = countTelegramBindings();
    return NextResponse.json(
      {
        ok: false,
        error: bound
          ? "This bot is not bound to a workspace."
          : "No Telegram bot is bound to a workspace yet. Run `npm run telegram:bind`.",
      },
      { status: bound ? 403 : 503 },
    );
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const message = update.message;
  const chatId = message?.chat?.id;
  const text = message?.text?.trim();

  if (!message || chatId === undefined || !text) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const workspaceId = binding.workspaceId;
  const chatKey = String(chatId);
  const sender = message.from;
  const senderName =
    [sender?.first_name, sender?.last_name].filter(Boolean).join(" ") ||
    (sender?.username ? `@${sender.username}` : `Telegram ${chatKey}`);
  const handle = sender?.username ? `@${sender.username}` : chatKey;

  // Resolve the sender through the identity table first: a known handle on
  // Telegram, then the chat id, then the same handle on another channel (the
  // same person writing from Instagram, for example). Only then fall back to
  // the legacy telegram_chat_id column, and finally create a new contact.
  const handleAddress = sender?.username
    ? normalizeIdentity(`@${sender.username}`)
    : null;
  const chatAddress = normalizeIdentity(chatKey);

  let resolvedContactId: string | null =
    (handleAddress &&
      findIdentityInChannel(
        db,
        workspaceId,
        "telegram",
        handleAddress.address,
      )?.contactId) ||
    (chatAddress &&
      findIdentityInChannel(db, workspaceId, "telegram", chatAddress.address)
        ?.contactId) ||
    null;

  if (!resolvedContactId && handleAddress) {
    resolvedContactId =
      findIdentityAcrossChannels(
        db,
        workspaceId,
        handleAddress.address,
        "telegram",
      )?.contactId ?? null;
  }

  if (!resolvedContactId) {
    const legacy = db
      .prepare(
        "SELECT id FROM contacts WHERE workspace_id = ? AND telegram_chat_id = ?",
      )
      .get(workspaceId, chatKey);
    if (legacy) resolvedContactId = String(legacy.id);
  }

  if (!resolvedContactId) {
    const newContactId = randomUUID();
    db.prepare(
      `INSERT INTO contacts (id, workspace_id, name, handle, company, color, telegram_chat_id)
       VALUES (?, ?, ?, ?, 'Telegram contact', '#2aabee', ?)`,
    ).run(newContactId, workspaceId, senderName, handle, chatKey);
    resolvedContactId = newContactId;
  }

  const contactId = resolvedContactId;

  // Keep the identity table in step with the message: both the public handle
  // and the chat id are attached to the resolved contact, and the chat id is
  // recorded for outbound delivery when this contact has none yet.
  if (handleAddress) {
    attachIdentity(db, {
      workspaceId,
      contactId,
      channelId: "telegram",
      raw: handleAddress.address,
    });
  }
  if (chatAddress) {
    attachIdentity(db, {
      workspaceId,
      contactId,
      channelId: "telegram",
      raw: chatAddress.address,
    });
  }

  db.prepare(
    `UPDATE contacts SET telegram_chat_id = COALESCE(telegram_chat_id, ?)
     WHERE id = ? AND workspace_id = ?`,
  ).run(chatKey, contactId, workspaceId);

  let conversation = db
    .prepare(
      `SELECT id FROM conversations
       WHERE workspace_id = ? AND channel_id = 'telegram' AND contact_id = ?
       ORDER BY last_at DESC LIMIT 1`,
    )
    .get(workspaceId, contactId);

  // New conversations land in the workspace's first queue, which also owns the
  // first-response deadline unless an agent has already replied.
  const defaultQueue = db
    .prepare(
      "SELECT id, sla_minutes FROM queues WHERE workspace_id = ? ORDER BY position LIMIT 1",
    )
    .get(workspaceId) as { id: string; sla_minutes: number } | undefined;

  const slaMinutes = defaultQueue ? Number(defaultQueue.sla_minutes) : 15;
  const receivedAt = message.date ? message.date * 1000 : Date.now();

  if (!conversation) {
    const conversationId = randomUUID();
    db.prepare(
      `INSERT INTO conversations
         (id, workspace_id, channel_id, contact_id, topic, status, queue_id,
          first_response_at, sla_due_at, unread, last_at)
       VALUES (?, ?, 'telegram', ?, ?, 'open', ?, NULL, ?, 0, ?)`,
    ).run(
      conversationId,
      workspaceId,
      contactId,
      text.length > 60 ? `${text.slice(0, 57)}…` : text,
      defaultQueue?.id ?? null,
      receivedAt + slaMinutes * 60_000,
      receivedAt,
    );
    conversation = { id: conversationId };
  }

  const conversationId = String(conversation.id);
  const externalId = `telegram:${chatKey}:${message.message_id ?? randomUUID()}`;

  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO messages (id, conversation_id, author, body, created_at, status, external_id)
       VALUES (?, ?, 'contact', ?, ?, 'sent', ?)`,
    )
    .run(randomUUID(), conversationId, text, receivedAt, externalId);

  if (Number(inserted.changes) === 0) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  db.prepare(
    `UPDATE conversations
     SET unread = unread + 1,
         last_at = ?,
         sla_due_at = COALESCE(sla_due_at, ?)
     WHERE id = ?`,
  ).run(receivedAt, receivedAt + slaMinutes * 60_000, conversationId);

  publishWorkspaceEvent(workspaceId, {
    kind: "message",
    conversationId,
    text: `New Telegram message from ${senderName}`,
  });

  return NextResponse.json({ ok: true });
}
