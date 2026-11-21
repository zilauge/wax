import "server-only";

import { db } from "@/app/lib/db/db";

/**
 * Discord as an inbox channel through a bot.
 *
 * The linked account is the bot (`external_id` is its user id), so a bot can
 * only ever serve one workspace. Outbound replies open a DM channel with the
 * recipient and post into it; inbound DMs are pulled by the sync endpoint,
 * because Discord's real-time gateway is a long-lived socket a request-scoped
 * server cannot hold open.
 */
const API = (
  process.env.DISCORD_API_BASE?.trim() || "https://discord.com/api/v10"
).replace(/\/$/, "");

export type DiscordDelivery =
  | { status: "sent"; externalId: string | null }
  | { status: "failed"; error: string };

export type DiscordCredentials = {
  workspaceId: string;
  botUserId: string;
  botToken: string;
  accountName: string | null;
  cursor: string | null;
};

type Row = Record<string, unknown>;

function credentialsFromRow(row: Row | undefined): DiscordCredentials | null {
  if (!row) return null;
  return {
    workspaceId: String(row.workspace_id),
    botUserId: String(row.external_id),
    botToken: String(row.access_token),
    accountName: row.account_name ? String(row.account_name) : null,
    cursor: row.cursor ? String(row.cursor) : null,
  };
}

export function discordConnectionForWorkspace(
  workspaceId: string,
): DiscordCredentials | null {
  const row = db
    .prepare(
      `SELECT workspace_id, external_id, access_token, account_name, cursor
       FROM channel_connections
       WHERE workspace_id = ? AND channel_id = 'discord' AND provider = 'discord'`,
    )
    .get(workspaceId);

  return credentialsFromRow(row);
}

export function listDiscordConnections(): DiscordCredentials[] {
  return db
    .prepare(
      `SELECT workspace_id, external_id, access_token, account_name, cursor
       FROM channel_connections
       WHERE channel_id = 'discord' AND provider = 'discord'`,
    )
    .all()
    .map((row) => credentialsFromRow(row))
    .filter((row): row is DiscordCredentials => row !== null);
}

export function setDiscordCursor(workspaceId: string, cursor: string) {
  db.prepare(
    "UPDATE channel_connections SET cursor = ? WHERE workspace_id = ? AND channel_id = 'discord'",
  ).run(cursor, workspaceId);
}

function botHeaders(token: string) {
  return {
    authorization: `Bot ${token}`,
    "content-type": "application/json",
  };
}

function failure(payload: Record<string, unknown> | null, status: number) {
  const message = payload?.message;
  return typeof message === "string"
    ? message
    : `Discord responded with ${status}.`;
}

/** The bot's own identity, used as the connection's account id. */
export async function fetchDiscordBot(
  botToken: string,
): Promise<{ id: string; name: string } | { error: string }> {
  try {
    const response = await fetch(`${API}/users/@me`, {
      headers: botHeaders(botToken),
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (!response.ok || !payload?.id) {
      return {
        error:
          response.status === 401
            ? "Discord rejected that bot token."
            : failure(payload, response.status),
      };
    }

    return {
      id: String(payload.id),
      name: String(payload.username ?? "Discord bot"),
    };
  } catch {
    return { error: "Could not reach Discord to verify that bot token." };
  }
}

export async function deliverDiscordMessage({
  workspaceId,
  address,
  text,
}: {
  workspaceId: string;
  address: string | null;
  text: string;
}): Promise<DiscordDelivery> {
  const connection = discordConnectionForWorkspace(workspaceId);

  if (!connection) {
    return {
      status: "failed",
      error:
        "Discord is not connected for this workspace. Link the bot in settings before sending.",
    };
  }

  const recipient = (address ?? "").replace(/[^\d]/g, "");
  if (!recipient) {
    return {
      status: "failed",
      error: "This contact has no Discord user id, so nothing was sent.",
    };
  }

  try {
    const opened = await fetch(`${API}/users/@me/channels`, {
      method: "POST",
      headers: botHeaders(connection.botToken),
      body: JSON.stringify({ recipient_id: recipient }),
      cache: "no-store",
    });
    const channel = (await opened.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (!opened.ok || !channel?.id) {
      return { status: "failed", error: failure(channel, opened.status) };
    }

    const posted = await fetch(`${API}/channels/${String(channel.id)}/messages`, {
      method: "POST",
      headers: botHeaders(connection.botToken),
      body: JSON.stringify({ content: text, allowed_mentions: { parse: [] } }),
      cache: "no-store",
    });
    const message = (await posted.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (!posted.ok) {
      return { status: "failed", error: failure(message, posted.status) };
    }

    return {
      status: "sent",
      externalId: message?.id ? String(message.id) : null,
    };
  } catch {
    return {
      status: "failed",
      error: "Could not reach Discord. The message was not delivered.",
    };
  }
}

export type DiscordInbound = {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  receivedAt: number;
};

export type DiscordActivity =
  | { messages: DiscordInbound[]; complete: boolean }
  | { error: string };

/**
 * New DM messages from people (never other bots) across the bot's open DM
 * channels, oldest first. Snowflake ids order globally by time, so one cursor
 * serves every channel.
 *
 * `complete` is false when any DM channel could not be read: the caller must
 * then keep its cursor, otherwise the messages in the failed channel would be
 * skipped for good.
 */
export async function fetchDiscordDmActivity(
  connection: DiscordCredentials,
): Promise<DiscordActivity> {
  const query = connection.cursor ? `?after=${connection.cursor}&limit=50` : "?limit=25";
  const headers = botHeaders(connection.botToken);

  try {
    const channelsResponse = await fetch(`${API}/users/@me/channels`, {
      headers,
      cache: "no-store",
    });
    const channelsPayload = (await channelsResponse.json().catch(() => null)) as
      | Record<string, unknown>[]
      | null;

    if (!channelsResponse.ok || !Array.isArray(channelsPayload)) {
      return { error: `Discord responded with ${channelsResponse.status} while listing DMs.` };
    }

    const dms = channelsPayload.filter(
      (channel) => channel.type === 1 && typeof channel.id === "string",
    );

    const messages: DiscordInbound[] = [];
    let complete = true;

    for (const channel of dms) {
      const response = await fetch(
        `${API}/channels/${String(channel.id)}/messages${query}`,
        { headers, cache: "no-store" },
      );
      if (!response.ok) {
        complete = false;
        continue;
      }

      const batch = (await response.json().catch(() => null)) as
        | Record<string, unknown>[]
        | null;
      if (!Array.isArray(batch)) {
        complete = false;
        continue;
      }

      for (const message of batch) {
        const author = (message.author ?? {}) as Record<string, unknown>;
        const content = typeof message.content === "string" ? message.content.trim() : "";
        if (author.bot || !content || !message.id || !author.id) continue;

        messages.push({
          id: String(message.id),
          authorId: String(author.id),
          authorName: String(author.username ?? "Discord user"),
          text: content,
          receivedAt: message.timestamp
            ? Date.parse(String(message.timestamp))
            : Date.now(),
        });
      }
    }

    messages.sort((a, b) => a.id.localeCompare(b.id));
    return { messages, complete };
  } catch {
    return { error: "Could not reach Discord while syncing." };
  }
}
