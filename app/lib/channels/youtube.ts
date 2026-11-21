import "server-only";

import { db } from "@/app/lib/db/db";
import {
  readStoredToken,
  serializeToken,
  tokenNeedsRefresh,
  type StoredToken,
} from "@/app/lib/channels/tokens";

/**
 * YouTube as a comment channel through the Data API v3.
 *
 * A "conversation" is a comment thread: the contact identity is the author's
 * channel id, and the thread's top-level comment id travels on the inbound
 * message's external id so a reply knows what it is replying to. Google access
 * tokens last an hour, so the connection stores a refresh token and rotates it.
 */
const API = (
  process.env.YOUTUBE_API_BASE?.trim() || "https://www.googleapis.com/youtube/v3"
).replace(/\/$/, "");

export type YouTubeDelivery =
  | { status: "sent"; externalId: string | null }
  | { status: "failed"; error: string };

export type YouTubeCredentials = {
  workspaceId: string;
  channelId: string;
  accessToken: string;
  accountName: string | null;
  cursor: string | null;
};

type Row = Record<string, unknown>;

function credentialsFromRow(row: Row | undefined): YouTubeCredentials | null {
  if (!row) return null;
  return {
    workspaceId: String(row.workspace_id),
    channelId: String(row.external_id),
    accessToken: String(row.access_token),
    accountName: row.account_name ? String(row.account_name) : null,
    cursor: row.cursor ? String(row.cursor) : null,
  };
}

export function youtubeConnectionForWorkspace(
  workspaceId: string,
): YouTubeCredentials | null {
  return credentialsFromRow(
    db
      .prepare(
        `SELECT workspace_id, external_id, access_token, account_name, cursor
         FROM channel_connections
         WHERE workspace_id = ? AND channel_id = 'youtube'`,
      )
      .get(workspaceId) as Row | undefined,
  );
}

export function listYouTubeConnections(): YouTubeCredentials[] {
  return db
    .prepare(
      `SELECT workspace_id, external_id, access_token, account_name, cursor
       FROM channel_connections
       WHERE channel_id = 'youtube'`,
    )
    .all()
    .map((row) => credentialsFromRow(row))
    .filter((row): row is YouTubeCredentials => row !== null);
}

export function setYouTubeCursor(workspaceId: string, cursor: string) {
  db.prepare(
    "UPDATE channel_connections SET cursor = ? WHERE workspace_id = ? AND channel_id = 'youtube'",
  ).run(cursor, workspaceId);
}

async function refreshGoogleToken(token: StoredToken): Promise<StoredToken | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!token.refreshToken || !clientId || !clientSecret) return null;

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: token.refreshToken,
        grant_type: "refresh_token",
      }),
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!response.ok || typeof payload?.access_token !== "string") return null;

    const expiresIn = Number(payload.expires_in ?? 3_600);
    return {
      accessToken: payload.access_token,
      refreshToken: token.refreshToken,
      expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3_600) * 1000,
    };
  } catch {
    return null;
  }
}

/** A usable access token, rotated and persisted when it is about to expire. */
export async function youtubeAccessToken(
  connection: YouTubeCredentials,
): Promise<string | null> {
  const token = readStoredToken(connection.accessToken);
  if (!token) return null;
  if (!tokenNeedsRefresh(token)) return token.accessToken;

  const refreshed = await refreshGoogleToken(token);
  if (!refreshed) return token.accessToken;

  db.prepare(
    "UPDATE channel_connections SET access_token = ? WHERE workspace_id = ? AND channel_id = 'youtube'",
  ).run(serializeToken(refreshed), connection.workspaceId);

  return refreshed.accessToken;
}

function errorMessage(payload: Record<string, unknown> | null, status: number) {
  const error = payload?.error as
    | { message?: string; errors?: { reason?: string }[] }
    | undefined;
  if (error?.message) return error.message;
  return `YouTube responded with ${status}.`;
}

export async function deliverYouTubeReply({
  workspaceId,
  parentCommentId,
  text,
}: {
  workspaceId: string;
  parentCommentId: string | null;
  text: string;
}): Promise<YouTubeDelivery> {
  const connection = youtubeConnectionForWorkspace(workspaceId);
  if (!connection) {
    return {
      status: "failed",
      error:
        "YouTube is not connected for this workspace. Link the channel in settings before replying.",
    };
  }

  if (!parentCommentId) {
    return {
      status: "failed",
      error:
        "This conversation has no inbound comment to reply to. YouTube replies must attach to a comment.",
    };
  }

  const token = await youtubeAccessToken(connection);
  if (!token) {
    return {
      status: "failed",
      error: "The stored YouTube credentials could not be refreshed. Link the channel again.",
    };
  }

  try {
    const response = await fetch(`${API}/comments?part=snippet`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        snippet: { parentId: parentCommentId, textOriginal: text },
      }),
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (!response.ok) {
      return { status: "failed", error: errorMessage(payload, response.status) };
    }

    return {
      status: "sent",
      externalId: payload?.id ? String(payload.id) : null,
    };
  } catch {
    return {
      status: "failed",
      error: "Could not reach YouTube. The reply was not posted.",
    };
  }
}

export type YouTubeInbound = {
  commentId: string;
  authorChannelId: string;
  authorName: string;
  text: string;
  publishedAt: string;
};

export type YouTubeActivity =
  | { comments: YouTubeInbound[]; complete: boolean }
  | { error: string };

/**
 * Newest comment threads on the channel, newest first. YouTube has no
 * comment webhook, so the sync endpoint polls this.
 */
export async function fetchYouTubeComments(
  connection: YouTubeCredentials,
): Promise<YouTubeActivity> {
  const token = await youtubeAccessToken(connection);
  if (!token) return { error: "The stored YouTube credentials could not be refreshed." };

  try {
    const url = new URL(`${API}/commentThreads`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("allThreadsRelatedToChannelId", connection.channelId);
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("order", "time");
    url.searchParams.set("textFormat", "plainText");

    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as {
      items?: {
        snippet?: {
          topLevelComment?: {
            id?: string;
            snippet?: {
              textDisplay?: string;
              textOriginal?: string;
              authorDisplayName?: string;
              authorChannelId?: { value?: string };
              publishedAt?: string;
            };
          };
        };
      }[];
    } & Record<string, unknown> | null;

    if (!response.ok) {
      return { error: errorMessage(payload, response.status) };
    }

    const comments: YouTubeInbound[] = [];

    for (const item of payload?.items ?? []) {
      const comment = item.snippet?.topLevelComment;
      const snippet = comment?.snippet;
      const text = (snippet?.textOriginal ?? snippet?.textDisplay ?? "").trim();
      const authorChannelId = snippet?.authorChannelId?.value;

      if (!comment?.id || !snippet?.publishedAt || !authorChannelId || !text) {
        continue;
      }

      comments.push({
        commentId: String(comment.id),
        authorChannelId: String(authorChannelId),
        authorName: String(snippet.authorDisplayName ?? "YouTube viewer"),
        text,
        publishedAt: String(snippet.publishedAt),
      });
    }

    comments.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    return { comments, complete: true };
  } catch {
    return { error: "Could not reach YouTube while syncing." };
  }
}
