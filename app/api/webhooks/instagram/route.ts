import { NextResponse } from "next/server";
import { db } from "@/app/lib/db/db";
import { metaSignatureMatches } from "@/app/lib/channels/meta-signature";
import { workspaceForInstagramAccount } from "@/app/lib/channels/instagram";
import {
  latestConversationFor,
  recordInboundMessage,
} from "@/app/lib/channels/inbound";
import { publishWorkspaceEvent } from "@/app/lib/workspace/realtime";

type InstagramMessage = {
  mid?: string;
  text?: string;
  is_echo?: boolean;
};

type InstagramEvent = {
  sender?: { id?: string };
  timestamp?: number;
  message?: InstagramMessage;
};

type InstagramPayload = {
  object?: string;
  entry?: { id?: string; time?: number; messaging?: InstagramEvent[] }[];
};

/** The subscription handshake, shared with the WhatsApp endpoint's token. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected =
    process.env.META_VERIFY_TOKEN?.trim() ??
    process.env.WHATSAPP_VERIFY_TOKEN?.trim();

  if (!expected) {
    return NextResponse.json(
      {
        ok: false,
        error: "META_VERIFY_TOKEN (or WHATSAPP_VERIFY_TOKEN) is not configured.",
      },
      { status: 503 },
    );
  }

  if (mode === "subscribe" && token === expected && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  return NextResponse.json(
    { ok: false, error: "Verification failed." },
    { status: 403 },
  );
}

/**
 * Inbound Instagram direct messages.
 *
 * Every app receives all accounts' events at one URL, so `entry[].id` — the
 * Instagram professional account id — selects the workspace. An unlinked
 * account is dropped rather than filed against another tenant; echoes of our
 * own sends are ignored; Meta's `mid` is the dedupe key.
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

  let payload: InstagramPayload;
  try {
    payload = JSON.parse(raw) as InstagramPayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON." },
      { status: 400 },
    );
  }

  if (payload.object !== "instagram") {
    return NextResponse.json({ ok: true, ignored: "not an Instagram event" });
  }

  let accepted = 0;
  let duplicates = 0;

  for (const entry of payload.entry ?? []) {
    const accountId = entry.id;
    if (!accountId) continue;

    const workspaceId = workspaceForInstagramAccount(String(accountId));
    if (!workspaceId) continue;

    for (const event of entry.messaging ?? []) {
      const text = event.message?.text?.trim();
      const senderId = event.sender?.id;
      const mid = event.message?.mid;

      if (!text || !senderId || !mid || event.message?.is_echo) continue;

      const outcome = recordInboundMessage(db, {
        workspaceId,
        channel: "instagram",
        rawAddress: String(senderId),
        senderName: "Instagram contact",
        text,
        receivedAt: event.timestamp ? Number(event.timestamp) : Date.now(),
        externalId: String(mid),
        company: "Instagram contact",
        color: "#e1306c",
      });

      if (outcome === "duplicate") {
        duplicates += 1;
        continue;
      }
      if (outcome !== "accepted") continue;

      const conversationId = latestConversationFor(
        db,
        workspaceId,
        "instagram",
        String(senderId),
      );

      publishWorkspaceEvent(workspaceId, {
        kind: "message",
        ...(conversationId ? { conversationId } : {}),
        text: "New Instagram message",
      });
      accepted += 1;
    }
  }

  return NextResponse.json({ ok: true, accepted, duplicates });
}
