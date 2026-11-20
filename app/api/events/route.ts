import { getSessionUser } from "@/app/lib/auth/auth";
import { subscribeWorkspace } from "@/app/lib/workspace/realtime";
import type { RealtimeEvent } from "@/app/lib/types";

/**
 * Server-sent events for the dashboard.
 *
 * The stream is bound to the workspace on the session cookie — never to a query
 * parameter — so a subscriber cannot ask for another tenant's activity. The
 * connection sends one `ready` event, a `tick` every 30 seconds so relative SLA
 * countdowns stay fresh, and a data event for every write published by the
 * workspace's actions.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const workspaceId = user.workspaceId;
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe = () => {};

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      const send = (event: RealtimeEvent) =>
        write(`data: ${JSON.stringify(event)}\n\n`);

      // SLA states change with the clock, not only with writes, so a tick asks
      // each dashboard to recompute its relative deadlines.
      const ticker = setInterval(() => {
        send({ kind: "tick", text: "SLA check", at: Date.now() });
      }, 30_000);

      cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(ticker);
        request.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      };

      send({
        kind: "ready",
        text: "Live updates connected.",
        at: Date.now(),
      });

      unsubscribe = subscribeWorkspace(workspaceId, send);

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
