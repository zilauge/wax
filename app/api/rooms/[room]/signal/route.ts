import { getSessionUser } from "@/app/lib/auth/auth";
import { joinRoom, leaveRoom, relay } from "@/app/lib/rooms/signaling";
import { roomInWorkspace } from "@/app/lib/rooms/store";

/**
 * Signaling channel for one room.
 *
 * GET opens a server-sent-events stream identified by a client-generated peer
 * id; POST relays one offer, answer or ICE candidate to a single peer. Both are
 * scoped to the session's workspace, so a room id from another tenant is a 404
 * rather than a way in. Media itself is peer-to-peer and never passes here.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ room: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { room } = await params;
  if (!roomInWorkspace(room, user.workspaceId)) {
    return new Response("Not found", { status: 404 });
  }

  const peerId = new URL(request.url).searchParams
    .get("peer")
    ?.replace(/[^A-Za-z0-9-]/g, "")
    .slice(0, 64);

  if (!peerId) return new Response("Missing peer", { status: 400 });

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };

      cleanup = () => {
        if (closed) return;
        closed = true;
        leaveRoom(room, peerId);
        clearInterval(heartbeat);
        request.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // Already closed by the browser.
        }
      };

      // A comment frame keeps proxies and the dev server from idling the stream
      // out while two people sit on a quiet call.
      const heartbeat = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            cleanup();
          }
        }
      }, 15_000);

      const existing = joinRoom(room, {
        id: peerId,
        name: user.name,
        send,
      });

      send({ type: "roster", peers: existing, you: { id: peerId, name: user.name } });
      request.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ room: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { room } = await params;
  if (!roomInWorkspace(room, user.workspaceId)) {
    return new Response("Not found", { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    from?: unknown;
    to?: unknown;
    payload?: unknown;
  } | null;

  const from = typeof body?.from === "string" ? body.from : "";
  const to = typeof body?.to === "string" ? body.to : "";
  if (!from || !to || !body?.payload) {
    return new Response("Bad request", { status: 400 });
  }

  const delivered = relay(room, from, to, body.payload);
  return new Response(null, { status: delivered ? 204 : 410 });
}
