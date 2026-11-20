"use server";

import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { requireUser } from "@/app/lib/auth/auth";
import { deleteConnection } from "@/app/lib/channels/connections";
import {
  CHANNEL_OAUTH_COOKIE,
  getProvider,
  type OAuthPending,
  type SocialChannelId,
} from "@/app/lib/channels/providers";

export type ConnectResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

function appOrigin(host: string, proto: string) {
  const configured = process.env.WAX_APP_URL?.trim();
  return (configured ?? `${proto}://${host}`).replace(/\/$/, "");
}

/** Returns the provider's consent URL, or why this channel cannot be linked. */
export async function startChannelConnectionAction(
  channel: string,
): Promise<ConnectResult> {
  const user = await requireUser();
  const provider = getProvider(channel);

  if (!provider) {
    return { ok: false, error: "That channel cannot be connected." };
  }

  if (!provider.configured()) {
    return {
      ok: false,
      error: `${provider.name} is not configured on this server. Set ${provider.env.join(" and ")}.`,
    };
  }

  const headerStore = await headers();
  const host = headerStore.get("host") ?? "localhost:3000";
  const proto = headerStore.get("x-forwarded-proto") ?? "http";
  const origin = appOrigin(host, proto);
  const redirectUri = `${origin}/api/channels/${provider.id}/callback`;

  const state = randomBytes(24).toString("hex");
  const verifier =
    provider.id === "x" ? randomBytes(32).toString("base64url") : null;

  const pending: OAuthPending = {
    state,
    channel: provider.id,
    workspaceId: user.workspaceId,
    verifier,
  };

  const cookieStore = await cookies();
  cookieStore.set(CHANNEL_OAUTH_COOKIE, JSON.stringify(pending), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });

  return {
    ok: true,
    url: provider.authorizeUrl({
      redirectUri,
      state,
      verifier: verifier ?? undefined,
    }),
  };
}

export async function disconnectChannelAction(
  channel: SocialChannelId,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();

  if (user.role === "agent") {
    return {
      ok: false,
      error: "Only an owner or admin can disconnect a channel.",
    };
  }

  deleteConnection(user.workspaceId, channel);
  return { ok: true };
}
