import { NextResponse } from "next/server";
import { syncAllChannels } from "@/app/lib/channels/sync";

/**
 * Optional external trigger for the inbound poller.
 *
 * The app already polls on its own timer (see `instrumentation.ts`), so this
 * endpoint exists for deployments that prefer a scheduler or want to force a
 * run. It stays secret-gated and refuses to run without `SYNC_SECRET`.
 */
function authorized(request: Request) {
  const secret = process.env.SYNC_SECRET?.trim();
  if (!secret) return { ok: false as const, status: 503 };

  const header = request.headers.get("authorization") ?? "";
  const url = new URL(request.url);
  const supplied = header.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : (url.searchParams.get("secret") ?? "");

  return supplied === secret
    ? { ok: true as const }
    : { ok: false as const, status: 401 };
}

async function run(request: Request) {
  const auth = authorized(request);
  if (!auth.ok) {
    return NextResponse.json(
      {
        ok: false,
        error:
          auth.status === 503
            ? "SYNC_SECRET is not configured on this server. The app polls on its own timer instead."
            : "Invalid sync secret.",
      },
      { status: auth.status },
    );
  }

  const report = await syncAllChannels();
  return NextResponse.json({ ok: true, ...report });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
