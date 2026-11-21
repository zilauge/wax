import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/lib/auth/auth";
import {
  logChannelAudit,
  providerForChannel,
  saveConnection,
} from "@/app/lib/channels/connections";
import {
  CHANNEL_OAUTH_COOKIE,
  getProvider,
  type OAuthPending,
} from "@/app/lib/channels/providers";
import { serializeToken } from "@/app/lib/channels/tokens";

function back(
  request: Request,
  channel: string,
  values: Record<string, string>,
) {
  const url = new URL("/settings", request.url);
  url.searchParams.set("channel", channel);
  for (const [key, value] of Object.entries(values)) {
    url.searchParams.set(key, value);
  }

  const response = NextResponse.redirect(url);
  response.cookies.set(CHANNEL_OAUTH_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ channel: string }> },
) {
  const { channel } = await params;
  const provider = getProvider(channel);

  if (!provider) {
    return NextResponse.json({ error: "Unknown channel" }, { status: 404 });
  }

  const user = await getSessionUser();
  if (!user) return back(request, channel, { error: "Sign in to connect a channel." });

  // The state cookie proves this callback started from this browser session,
  // and pins the attempt to the workspace that started it.
  const cookieStore = await cookies();
  const raw = cookieStore.get(CHANNEL_OAUTH_COOKIE)?.value;
  let pending: OAuthPending | null = null;
  try {
    pending = raw ? (JSON.parse(raw) as OAuthPending) : null;
  } catch {
    pending = null;
  }

  if (
    !pending ||
    pending.channel !== provider.id ||
    pending.workspaceId !== user.workspaceId
  ) {
    return back(request, channel, {
      error: "This connection attempt expired. Start again.",
    });
  }

  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const providerError =
    url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (providerError) return back(request, channel, { error: providerError });
  if (!state || state !== pending.state) {
    return back(request, channel, {
      error: "The provider returned a mismatched state. Start again.",
    });
  }
  if (!code) {
    return back(request, channel, { error: "The provider did not return a code." });
  }

  const redirectUri = `${url.origin}/api/channels/${provider.id}/callback`;

  try {
    const tokens = await provider.exchange({
      code,
      redirectUri,
      verifier: pending.verifier ?? undefined,
    });
    const account = await provider.account(tokens.accessToken);

    saveConnection({
      workspaceId: user.workspaceId,
      channel: provider.id,
      provider: providerForChannel(provider.id),
      externalId: account.id,
      accountName: account.name,
      accessToken: serializeToken({
        accessToken: account.accessToken ?? tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresIn
          ? Date.now() + tokens.expiresIn * 1000
          : undefined,
      }),
    });

    logChannelAudit({
      workspaceId: user.workspaceId,
      channel: provider.id,
      action: "connected",
      actorUserId: user.id,
      actorName: user.name,
    });

    return back(request, channel, { connected: "1" });
  } catch (error) {
    return back(request, channel, {
      error:
        error instanceof Error
          ? error.message
          : "The provider did not accept the connection.",
    });
  }
}
