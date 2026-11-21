import { NextResponse } from "next/server";
import {
  latestConversationFor,
  recordInboundMessage,
} from "@/app/lib/channels/inbound";
import { mapTwilioStatus, nextMessageStatus } from "@/app/lib/channels/status";
import { workspaceForSmsNumber } from "@/app/lib/channels/twilio";
import { verifyTwilioSignature } from "@/app/lib/channels/twilio-signature";
import { db } from "@/app/lib/db/db";
import { publishWorkspaceEvent } from "@/app/lib/workspace/realtime";
import type { MessageStatus } from "@/app/lib/types";

function twiml(body = "") {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`,
    { status: 200, headers: { "content-type": "text/xml" } },
  );
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "Twilio SMS webhook",
    usage: "Point the number's messaging webhook and status callback here.",
  });
}

/**
 * Inbound SMS and delivery receipts from Twilio.
 *
 * The receiving number (`To`) selects the workspace before the signature is
 * checked, so a signature can only ever be validated with the credentials of
 * the tenant that owns the number. Twilio retries, so the message SID is the
 * dedupe key, and status callbacks only move a message forward.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const params = Object.fromEntries(new URLSearchParams(raw));

  const to = params.To?.trim();
  if (!to) return twiml();

  const owner = workspaceForSmsNumber(to);
  if (!owner) {
    // An unlinked number must never be filed against another workspace.
    return twiml();
  }

  const url = process.env.TWILIO_WEBHOOK_URL?.trim() || request.url;
  const valid = verifyTwilioSignature({
    authToken: owner.authToken,
    url,
    signature: request.headers.get("x-twilio-signature"),
    params,
  });

  if (!valid) {
    return NextResponse.json(
      { ok: false, error: "Invalid Twilio signature." },
      { status: 401 },
    );
  }

  const { workspaceId } = owner;

  const status = params.MessageStatus?.trim();
  if (status) {
    const incoming = mapTwilioStatus(status);
    const sid = params.MessageSid ?? params.SmsSid;
    if (!incoming || !sid) return twiml();

    const row = db
      .prepare(
        `SELECT m.id, m.status, m.conversation_id
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.workspace_id = ? AND m.external_id = ?`,
      )
      .get(workspaceId, sid);
    if (!row) return twiml();

    const next = nextMessageStatus(
      String(row.status) as MessageStatus,
      incoming,
    );
    if (next === row.status) return twiml();

    db.prepare("UPDATE messages SET status = ?, error = ? WHERE id = ?").run(
      next,
      next === "failed"
        ? (params.ErrorMessage ?? "Twilio reported a delivery failure.")
        : null,
      String(row.id),
    );

    publishWorkspaceEvent(workspaceId, {
      kind: "message",
      conversationId: String(row.conversation_id),
      text: `SMS message ${next}`,
    });

    return twiml();
  }

  const body = params.Body?.trim();
  const from = params.From?.trim();
  if (!body || !from) return twiml();

  const outcome = recordInboundMessage(db, {
    workspaceId,
    channel: "sms",
    rawAddress: from,
    senderName: from,
    text: body,
    receivedAt: params.DateSent ? Date.parse(params.DateSent) : Date.now(),
    externalId: params.MessageSid ?? params.SmsSid ?? `${from}:${Date.now()}`,
    company: "SMS contact",
    color: "#f22f46",
  });

  if (outcome === "accepted") {
    const conversationId = latestConversationFor(
      db,
      workspaceId,
      "sms",
      from,
    );

    publishWorkspaceEvent(workspaceId, {
      kind: "message",
      ...(conversationId ? { conversationId } : {}),
      text: `New SMS message from ${from}`,
    });
  }

  return twiml();
}
