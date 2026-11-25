"use server";

import { randomBytes } from "node:crypto";
import { refresh } from "next/cache";
import { cookies, headers } from "next/headers";
import { requireUser } from "@/app/lib/auth/auth";
import { canManageChannels } from "@/app/lib/auth/roles";
import {
  deleteConnection,
  logChannelAudit,
  saveConnection,
} from "@/app/lib/channels/connections";
import { fetchDiscordBot } from "@/app/lib/channels/discord";
import { verifyXCredentials } from "@/app/lib/channels/x";
import {
  isOAuth1Credentials,
  type OAuth1Credentials,
} from "@/app/lib/channels/x-oauth1";
import { syncWorkspaceChannels } from "@/app/lib/channels/sync";
import { normalizeSmsNumber, TWILIO_PROVIDER } from "@/app/lib/channels/twilio";
import type { ChannelId } from "@/app/lib/types";
import {
  CHANNEL_OAUTH_COOKIE,
  getProvider,
  type OAuthPending,
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

  if (!canManageChannels(user.role)) {
    return {
      ok: false,
      error: "Only an owner or admin can link a channel.",
    };
  }

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
  const host =
    headerStore.get("host") ??
    process.env.WAX_PUBLIC_HOST ??
    "172.20.204.10:53062";
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

function twilioAuth(accountSid: string, authToken: string) {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

/**
 * Links a Twilio number as this workspace's SMS channel. The credentials are
 * verified with Twilio before anything is stored, so an invalid pair fails
 * here instead of silently breaking every reply later.
 */
export async function connectSmsChannelAction(input: {
  accountSid: string;
  authToken: string;
  from: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();

  if (!canManageChannels(user.role)) {
    return { ok: false, error: "Only an owner or admin can link a channel." };
  }

  const accountSid = input.accountSid.trim();
  const authToken = input.authToken.trim();
  const from = normalizeSmsNumber(input.from);

  if (!/^AC[0-9a-f]{32}$/i.test(accountSid)) {
    return {
      ok: false,
      error: "Enter the Account SID from the Twilio console (it starts with AC).",
    };
  }
  if (authToken.length < 20) {
    return { ok: false, error: "Enter the account's auth token." };
  }
  if (!/^\+\d{8,15}$/.test(from)) {
    return {
      ok: false,
      error: "Enter the sending number in international form, for example +15551234567.",
    };
  }

  try {
    const account = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`,
      {
        headers: { authorization: twilioAuth(accountSid, authToken) },
        cache: "no-store",
      },
    );

    if (!account.ok) {
      return {
        ok: false,
        error:
          account.status === 401
            ? "Twilio rejected those credentials. Check the SID and auth token."
            : `Twilio responded with ${account.status} while checking the account.`,
      };
    }

    const numbers = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(from)}`,
      {
        headers: { authorization: twilioAuth(accountSid, authToken) },
        cache: "no-store",
      },
    );

    if (!numbers.ok) {
      return {
        ok: false,
        error: `Twilio responded with ${numbers.status} while checking ${from}.`,
      };
    }

    const payload = (await numbers.json().catch(() => null)) as {
      incoming_phone_numbers?: { phone_number?: string }[];
    } | null;

    const owns = payload?.incoming_phone_numbers?.some(
      (number) => normalizeSmsNumber(number.phone_number ?? "") === from,
    );

    if (!owns) {
      return {
        ok: false,
        error: `That account does not own ${from}. Add the number in Twilio or use one it owns.`,
      };
    }
  } catch {
    return {
      ok: false,
      error: "Could not reach Twilio to verify those credentials.",
    };
  }

  try {
    saveConnection({
      workspaceId: user.workspaceId,
      channel: "sms",
      provider: TWILIO_PROVIDER,
      externalId: from,
      accountName: from,
      accessToken: JSON.stringify({ accountSid, authToken }),
    });
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not store that SMS number.",
    };
  }

  logChannelAudit({
    workspaceId: user.workspaceId,
    channel: "sms",
    action: "connected",
    actorUserId: user.id,
    actorName: user.name,
  });

  refresh();
  return { ok: true };
}

/**
 * Links a Discord bot. The token is checked with Discord first, and the bot's
 * own user id becomes the connection's account id, so one bot can only ever
 * belong to a single workspace.
 */
export async function connectDiscordChannelAction(input: {
  botToken: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();

  if (!canManageChannels(user.role)) {
    return { ok: false, error: "Only an owner or admin can link a channel." };
  }

  const botToken = input.botToken.trim();
  if (botToken.length < 20) {
    return { ok: false, error: "Enter the bot token from the Discord developer portal." };
  }

  const bot = await fetchDiscordBot(botToken);
  if ("error" in bot) return { ok: false, error: bot.error };

  try {
    saveConnection({
      workspaceId: user.workspaceId,
      channel: "discord",
      provider: "discord",
      externalId: bot.id,
      accountName: bot.name,
      accessToken: botToken,
    });
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Could not store that Discord bot.",
    };
  }

  logChannelAudit({
    workspaceId: user.workspaceId,
    channel: "discord",
    action: "connected",
    actorUserId: user.id,
    actorName: user.name,
  });

  refresh();
  return { ok: true };
}

/**
 * Pulls new Discord DMs and YouTube comments for this workspace immediately.
 * The server also polls on a timer; this only makes the wait optional.
 */
export async function syncChannelsNowAction(): Promise<
  { ok: true; message: string } | { ok: false; error: string }
> {
  const user = await requireUser();

  if (!canManageChannels(user.role)) {
    return { ok: false, error: "Only an owner or admin can sync channels." };
  }

  const report = await syncWorkspaceChannels(user.workspaceId);
  refresh();

  const accepted =
    report.discord.accepted + report.youtube.accepted + report.x.accepted;
  const errors = [
    ...report.discord.errors,
    ...report.youtube.errors,
    ...report.x.errors,
  ];
  const notices = [
    ...report.discord.notices,
    ...report.youtube.notices,
    ...report.x.notices,
  ];

  if (errors.length > 0) {
    return {
      ok: false,
      error: `${errors.join(" ")}${
        accepted > 0 ? ` ${accepted} message(s) were stored before the error.` : ""
      }`,
    };
  }

  return {
    ok: true,
    message: [
      accepted > 0 ? `Synced ${accepted} new message(s).` : "Already up to date.",
      ...notices,
    ].join(" "),
  };
}

function cleanOAuth1(input: OAuth1Credentials): OAuth1Credentials {
  return {
    consumerKey: input.consumerKey.trim(),
    consumerSecret: input.consumerSecret.trim(),
    accessToken: input.accessToken.trim(),
    accessTokenSecret: input.accessTokenSecret.trim(),
  };
}

/**
 * Links X with OAuth 1.0a API keys (API key/secret + access token/secret),
 * verified against /2/users/me before they are stored. This is the path for
 * apps that have not set up an OAuth 2.0 client; both use the same connection.
 */
export async function connectXCredentialsAction(
  input: OAuth1Credentials,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();

  if (!canManageChannels(user.role)) {
    return { ok: false, error: "Only an owner or admin can link a channel." };
  }

  const credentials = cleanOAuth1(input);
  if (!isOAuth1Credentials(credentials)) {
    return {
      ok: false,
      error:
        "Enter the API key, API key secret, access token and access token secret from the X developer console.",
    };
  }

  const account = await verifyXCredentials(credentials);
  if ("error" in account) return { ok: false, error: account.error };

  try {
    saveConnection({
      workspaceId: user.workspaceId,
      channel: "x",
      provider: "x",
      externalId: account.id,
      accountName: account.name,
      accessToken: JSON.stringify({ oauth1: credentials }),
    });
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Could not store those X keys.",
    };
  }

  logChannelAudit({
    workspaceId: user.workspaceId,
    channel: "x",
    action: "connected",
    actorUserId: user.id,
    actorName: user.name,
  });

  refresh();
  return { ok: true };
}

export async function disconnectChannelAction(
  channel: ChannelId,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();

  if (!canManageChannels(user.role)) {
    return {
      ok: false,
      error: "Only an owner or admin can disconnect a channel.",
    };
  }

  deleteConnection(user.workspaceId, channel);
  logChannelAudit({
    workspaceId: user.workspaceId,
    channel,
    action: "disconnected",
    actorUserId: user.id,
    actorName: user.name,
  });
  return { ok: true };
}
