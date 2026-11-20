import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  countTelegramBindings,
  resolveTelegramBinding,
} from "../../../lib/channels/telegram-binding";
import { db } from "../../../lib/db";

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

  let contact = db
    .prepare(
      "SELECT id FROM contacts WHERE workspace_id = ? AND telegram_chat_id = ?",
    )
    .get(workspaceId, chatKey);

  if (!contact) {
    const contactId = randomUUID();
    db.prepare(
      `INSERT INTO contacts (id, workspace_id, name, handle, company, color, telegram_chat_id)
       VALUES (?, ?, ?, ?, 'Telegram contact', '#2aabee', ?)`,
    ).run(contactId, workspaceId, senderName, handle, chatKey);
    contact = { id: contactId };
  }

  const contactId = String(contact.id);

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

  return NextResponse.json({ ok: true });
}
