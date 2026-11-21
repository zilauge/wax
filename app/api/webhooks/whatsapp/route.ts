import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { metaSignatureMatches } from "@/app/lib/channels/meta-signature";
import {
  attachIdentity,
  findIdentityAcrossChannels,
  findIdentityInChannel,
} from "@/app/lib/contacts/identities";
import { normalizeIdentity } from "@/app/lib/contacts/identity";
import { workspaceForWhatsAppNumber } from "@/app/lib/channels/whatsapp";
import { mapReceiptStatus, nextMessageStatus } from "@/app/lib/channels/status";
import { db } from "@/app/lib/db/db";
import { publishWorkspaceEvent } from "@/app/lib/workspace/realtime";

type WhatsAppMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
};

type WhatsAppStatus = {
  id?: string;
  status?: string;
  errors?: { title?: string; message?: string }[];
};

type WhatsAppValue = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: WhatsAppMessage[];
  statuses?: WhatsAppStatus[];
};

type WhatsAppPayload = {
  entry?: { changes?: { field?: string; value?: WhatsAppValue }[] }[];
};

/** Meta's subscription handshake. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;

  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "WHATSAPP_VERIFY_TOKEN is not configured." },
      { status: 503 },
    );
  }

  if (mode === "subscribe" && token === expected && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  return NextResponse.json({ ok: false, error: "Verification failed." }, { status: 403 });
}

/**
 * Inbound WhatsApp messages.
 *
 * Meta delivers every tenant's events to one URL, so the payload's
 * `phone_number_id` is what selects the workspace: it must match the number
 * stored on that workspace's connection. Messages are deduplicated on Meta's
 * own message id, and the sender is resolved through contact identities before
 * a new contact is created — the same order the Telegram webhook uses.
 */
export async function POST(request: Request) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "META_APP_SECRET is not configured." },
      { status: 503 },
    );
  }

  const raw = await request.text();
  if (
    !metaSignatureMatches(
      raw,
      request.headers.get("x-hub-signature-256"),
      secret,
    )
  ) {
    return NextResponse.json(
      { ok: false, error: "Invalid signature." },
      { status: 401 },
    );
  }

  let payload: WhatsAppPayload;
  try {
    payload = JSON.parse(raw) as WhatsAppPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  let accepted = 0;
  let duplicates = 0;
  let receipts = 0;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field && change.field !== "messages") continue;

      const value = change.value;

      // Delivery receipts move an already-sent message forward; they never
      // create messages, and they are scoped to the tenant that owns the number.
      for (const status of value?.statuses ?? []) {
        const phoneNumberId = value?.metadata?.phone_number_id;
        const externalId = status.id;
        const incoming = mapReceiptStatus(status.status ?? "");
        if (!phoneNumberId || !externalId || !incoming) continue;

        const workspaceId = workspaceForWhatsAppNumber(phoneNumberId);
        if (!workspaceId) continue;

        const row = db
          .prepare(
            `SELECT m.id, m.status, m.conversation_id
             FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             WHERE c.workspace_id = ? AND m.external_id = ?`,
          )
          .get(workspaceId, externalId);
        if (!row) continue;

        const next = nextMessageStatus(
          String(row.status) as "sent" | "delivered" | "read" | "failed",
          incoming,
        );
        if (next === row.status) continue;

        const failure = status.errors?.[0]?.message ?? status.errors?.[0]?.title;
        db.prepare("UPDATE messages SET status = ?, error = ? WHERE id = ?").run(
          next,
          next === "failed" ? (failure ?? "WhatsApp reported a delivery failure.") : null,
          String(row.id),
        );

        publishWorkspaceEvent(workspaceId, {
          kind: "message",
          conversationId: String(row.conversation_id),
          text: `WhatsApp message ${next}`,
        });
        receipts += 1;
      }

      const message = value?.messages?.[0];
      const text = message?.text?.body?.trim();
      const from = message?.from;
      const phoneNumberId = value?.metadata?.phone_number_id;

      if (!message || !text || !from || !phoneNumberId) continue;

      const workspaceId = workspaceForWhatsAppNumber(phoneNumberId);
      if (!workspaceId) {
        // An unlinked number must never be filed against another tenant.
        continue;
      }

      const address = normalizeIdentity(from);
      if (!address) continue;

      const senderName =
        value?.contacts?.find((contact) => contact.wa_id === from)?.profile?.name ??
        address.address;

      let contactId =
        findIdentityInChannel(db, workspaceId, "whatsapp", address.address)
          ?.contactId ??
        findIdentityAcrossChannels(db, workspaceId, address.address, "whatsapp")
          ?.contactId ??
        null;

      if (!contactId) {
        contactId = randomUUID();
        db.prepare(
          `INSERT INTO contacts (id, workspace_id, name, handle, company, color)
           VALUES (?, ?, ?, ?, 'WhatsApp contact', '#25d366')`,
        ).run(contactId, workspaceId, senderName, address.address);
      }

      attachIdentity(db, {
        workspaceId,
        contactId,
        channelId: "whatsapp",
        raw: address.address,
      });

      let conversation = db
        .prepare(
          `SELECT id FROM conversations
           WHERE workspace_id = ? AND channel_id = 'whatsapp' AND contact_id = ?
           ORDER BY last_at DESC LIMIT 1`,
        )
        .get(workspaceId, contactId);

      const defaultQueue = db
        .prepare(
          "SELECT id, sla_minutes FROM queues WHERE workspace_id = ? ORDER BY position LIMIT 1",
        )
        .get(workspaceId) as { id: string; sla_minutes: number } | undefined;

      const slaMinutes = defaultQueue ? Number(defaultQueue.sla_minutes) : 15;
      const receivedAt = message.timestamp
        ? Number(message.timestamp) * 1000
        : Date.now();

      if (!conversation) {
        const conversationId = randomUUID();
        db.prepare(
          `INSERT INTO conversations
             (id, workspace_id, channel_id, contact_id, topic, status, queue_id,
              first_response_at, sla_due_at, unread, last_at)
           VALUES (?, ?, 'whatsapp', ?, ?, 'open', ?, NULL, ?, 0, ?)`,
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

      // Meta retries webhooks, so the provider message id is the dedupe key.
      const inserted = db
        .prepare(
          `INSERT OR IGNORE INTO messages
             (id, conversation_id, author, body, created_at, status, external_id)
           VALUES (?, ?, 'contact', ?, ?, 'sent', ?)`,
        )
        .run(
          randomUUID(),
          conversationId,
          text,
          receivedAt,
          `whatsapp:${message.id ?? randomUUID()}`,
        );

      if (Number(inserted.changes) === 0) {
        duplicates += 1;
        continue;
      }

      db.prepare(
        `UPDATE conversations
         SET unread = unread + 1,
             last_at = ?,
             sla_due_at = COALESCE(sla_due_at, ?)
         WHERE id = ? AND workspace_id = ?`,
      ).run(receivedAt, receivedAt + slaMinutes * 60_000, conversationId, workspaceId);

      publishWorkspaceEvent(workspaceId, {
        kind: "message",
        conversationId,
        text: `New WhatsApp message from ${senderName}`,
      });

      accepted += 1;
    }
  }

  return NextResponse.json({ ok: true, accepted, duplicates, receipts });
}
