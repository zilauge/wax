import "server-only";

import { db } from "@/app/lib/db/db";
import {
  readStoredToken,
  serializeToken,
  tokenNeedsRefresh,
  type StoredToken,
} from "@/app/lib/channels/tokens";
import { classifyXInboundFailure } from "@/app/lib/channels/x-inbound";
import {
  isOAuth1Credentials,
  oauth1Authorization,
  type OAuth1Credentials,
} from "@/app/lib/channels/x-oauth1";

/**
 * X direct messages through API v2.
 *
 * X access tokens last two hours, so the stored connection is the JSON form
 * with a refresh token and the send path refreshes it before use and writes the
 * rotated pair back. Inbound DMs are not available: X only pushes them through
 * the Account Activity API, which this app does not register.
 */
const API = (process.env.X_API_BASE?.trim() || "https://api.x.com/2").replace(
  /\/$/,
  "",
);

export type XDelivery =
  | { status: "sent"; externalId: string | null }
  | { status: "failed"; error: string };

type Row = Record<string, unknown>;

export type XCredentials = {
  workspaceId: string;
  userId: string;
  accountName: string | null;
  cursor: string | null;
  inboundState: "ready" | "unavailable" | null;
  inboundNote: string | null;
};

function credentialsFromRow(row: Row | undefined): XCredentials | null {
  if (!row) return null;
  return {
    workspaceId: String(row.workspace_id),
    userId: String(row.external_id),
    accountName: row.account_name ? String(row.account_name) : null,
    cursor: row.cursor ? String(row.cursor) : null,
    inboundState:
      row.inbound_state === "ready" || row.inbound_state === "unavailable"
        ? row.inbound_state
        : null,
    inboundNote: row.inbound_note ? String(row.inbound_note) : null,
  };
}

export function xConnectionForWorkspace(
  workspaceId: string,
): XCredentials | null {
  return credentialsFromRow(
    db
      .prepare(
        `SELECT workspace_id, external_id, account_name, cursor, inbound_state, inbound_note
         FROM channel_connections
         WHERE workspace_id = ? AND channel_id = 'x'`,

      )
      .get(workspaceId) as Row | undefined,
  );
}

export function listXConnections(): XCredentials[] {
  return db
    .prepare(
      `SELECT workspace_id, external_id, account_name, cursor, inbound_state, inbound_note
       FROM channel_connections
       WHERE channel_id = 'x'`,
    )
    .all()
    .map((row) => credentialsFromRow(row))
    .filter((row): row is XCredentials => row !== null);
}

/** Records whether X allowed the DM read, so the UI can say so once. */
export function setXInboundState(
  workspaceId: string,
  state: "ready" | "unavailable",
  note: string | null,
) {
  db.prepare(
    `UPDATE channel_connections
     SET inbound_state = ?, inbound_note = ?
     WHERE workspace_id = ? AND channel_id = 'x'`,
  ).run(state, state === "unavailable" ? note : null, workspaceId);
}

export function setXCursor(workspaceId: string, cursor: string) {
  db.prepare(
    "UPDATE channel_connections SET cursor = ? WHERE workspace_id = ? AND channel_id = 'x'",
  ).run(cursor, workspaceId);
}

function connectionRow(workspaceId: string) {
  return db
    .prepare(
      `SELECT workspace_id, external_id, access_token, account_name
       FROM channel_connections
       WHERE workspace_id = ? AND channel_id = 'x'`,
    )
    .get(workspaceId) as Row | undefined;
}

async function refreshXToken(token: StoredToken): Promise<StoredToken | null> {
  const clientId = process.env.X_CLIENT_ID?.trim();
  const clientSecret = process.env.X_CLIENT_SECRET?.trim();
  if (!token.refreshToken || !clientId || !clientSecret) return null;

  try {
    const response = await fetch(`${API}/oauth2/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!response.ok || typeof payload?.access_token !== "string") return null;

    const expiresIn = Number(payload.expires_in ?? 7_200);
    return {
      accessToken: payload.access_token,
      refreshToken:
        typeof payload.refresh_token === "string"
          ? payload.refresh_token
          : token.refreshToken,
      expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 7_200) * 1000,
    };
  } catch {
    return null;
  }
}

type StoredXAuth =
  | { kind: "oauth1"; credentials: OAuth1Credentials }
  | { kind: "bearer"; token: StoredToken };

function readXAuth(raw: string): StoredXAuth | null {
  const value = raw.trim();
  if (!value) return null;

  if (value.startsWith("{")) {
    try {
      const parsed = JSON.parse(value) as { oauth1?: unknown };
      if (isOAuth1Credentials(parsed.oauth1)) {
        return { kind: "oauth1", credentials: parsed.oauth1 };
      }
    } catch {
      // Fall through to the bearer-token shape.
    }
  }

  const token = readStoredToken(value);
  return token ? { kind: "bearer", token } : null;
}

async function accessTokenFor(workspaceId: string): Promise<string | null> {
  const row = connectionRow(workspaceId);
  if (!row) return null;

  const token = readStoredToken(String(row.access_token));
  if (!token) return null;
  if (!tokenNeedsRefresh(token)) return token.accessToken;

  const refreshed = await refreshXToken(token);
  if (!refreshed) return token.accessToken;

  db.prepare(
    "UPDATE channel_connections SET access_token = ? WHERE workspace_id = ? AND channel_id = 'x'",
  ).run(serializeToken(refreshed), workspaceId);

  return refreshed.accessToken;
}

/**
 * Headers for one request, signing with OAuth 1.0a keys or using the stored
 * OAuth 2.0 bearer token (refreshed when needed).
 */
async function authorizationFor(
  workspaceId: string,
  method: string,
  url: string,
  query?: Record<string, string>,
): Promise<Record<string, string> | null> {
  const row = connectionRow(workspaceId);
  if (!row) return null;

  const auth = readXAuth(String(row.access_token));
  if (!auth) return null;

  if (auth.kind === "oauth1") {
    return {
      authorization: oauth1Authorization({
        method,
        url,
        credentials: auth.credentials,
        query,
      }),
    };
  }

  const token = await accessTokenFor(workspaceId);
  return token ? { authorization: `Bearer ${token}` } : null;
}

/** Confirms OAuth 1.0a keys with X and returns the account they belong to. */
export async function verifyXCredentials(
  credentials: OAuth1Credentials,
): Promise<{ id: string; name: string } | { error: string }> {
  const url = `${API}/users/me`;
  const query = { "user.fields": "username" };

  try {
    const response = await fetch(`${url}?${new URLSearchParams(query)}`, {
      headers: {
        authorization: oauth1Authorization({ method: "GET", url, credentials, query }),
      },
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as {
      data?: { id?: string; username?: string };
      detail?: string;
      title?: string;
    } | null;

    if (!response.ok || !payload?.data?.id) {
      return {
        error:
          response.status === 401
            ? "X rejected those keys. Check the API key/secret and access token/secret, and that the app has Read permission at least."
            : errorMessage(payload as Record<string, unknown> | null, response.status),
      };
    }

    return {
      id: String(payload.data.id),
      name: payload.data.username
        ? `@${payload.data.username}`
        : "X account",
    };
  } catch {
    return { error: "Could not reach X to verify those keys." };
  }
}

function errorMessage(payload: Record<string, unknown> | null, status: number) {
  const detail = payload?.detail;
  if (typeof detail === "string") return detail;
  const title = payload?.title;
  if (typeof title === "string") return title;
  return `X responded with ${status}.`;
}

/**
 * X addresses a DM by numeric user id. Contacts are stored normalised, so an
 * inbound sender id arrives as "+5001"; a contact linked as "@handle" is
 * resolved through the users lookup so the desk can send either form.
 */
async function resolveParticipant(
  workspaceId: string,
  address: string | null,
): Promise<string | null> {
  const value = (address ?? "").trim();
  if (/^\+?\d+$/.test(value)) return value.replace(/\D/g, "");

  const handle = value.replace(/^@+/, "").trim();
  if (!handle) return null;

  const url = `${API}/users/by/username/${encodeURIComponent(handle)}`;
  const headers = await authorizationFor(workspaceId, "GET", url);
  if (!headers) return null;

  try {
    const response = await fetch(url, { headers, cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as {
      data?: { id?: string };
    } | null;
    return payload?.data?.id ?? null;
  } catch {
    return null;
  }
}

export type XInbound = {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  receivedAt: number;
  conversationId: string | null;
};

export type XActivity =
  | { messages: XInbound[]; complete: boolean }
  | { error: string; capability?: "unavailable" };

/**
 * Inbound DMs, pulled from the user's DM events. X has no DM webhook without
 * the Account Activity API, so this endpoint is polled like Discord and
 * YouTube. Events from the linked account itself are skipped.
 */
export async function fetchXDirectMessages(
  connection: XCredentials,
): Promise<XActivity> {
  const query: Record<string, string> = {
    "dm_event.fields": "created_at,sender_id,text,dm_conversation_id",
    expansions: "sender_id",
    "user.fields": "username",
    event_types: "MessageCreate",
    max_results: "100",
  };

  const url = new URL(`${API}/dm_events`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  const headers = await authorizationFor(
    connection.workspaceId,
    "GET",
    `${API}/dm_events`,
    query,
  );

  if (!headers) {
    return {
      error:
        "The stored X credentials could not be used. Link the account again to read messages.",
    };
  }

  try {
    const response = await fetch(url, { headers, cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as {
      data?: {
        id?: string;
        event_type?: string;
        text?: string;
        sender_id?: string;
        created_at?: string;
        dm_conversation_id?: string;
      }[];
      includes?: { users?: { id?: string; username?: string }[] };
      detail?: string;
      title?: string;
    } | null;

    if (!response.ok) {
      const classified = classifyXInboundFailure(
        response.status,
        payload as Record<string, unknown> | null,
      );
      return classified.capability
        ? { error: classified.message, capability: classified.capability }
        : { error: classified.message };
    }

    const usernames = new Map<string, string>();
    for (const user of payload?.includes?.users ?? []) {
      if (user.id && user.username) {
        usernames.set(String(user.id), `@${user.username}`);
      }
    }

    const messages: XInbound[] = [];

    for (const event of payload?.data ?? []) {
      if (event.event_type && event.event_type !== "MessageCreate") continue;
      const text = event.text?.trim();
      const senderId = event.sender_id;
      if (!event.id || !text || !senderId) continue;
      // Our own replies come back through the same feed.
      if (String(senderId) === connection.userId) continue;

      messages.push({
        id: String(event.id),
        senderId: String(senderId),
        senderName: usernames.get(String(senderId)) ?? `X user ${String(senderId)}`,
        text,
        receivedAt: event.created_at ? Date.parse(event.created_at) : Date.now(),
        conversationId: event.dm_conversation_id
          ? String(event.dm_conversation_id)
          : null,
      });
    }

    messages.sort((a, b) => Number(BigInt(a.id) - BigInt(b.id)));
    return { messages, complete: true };
  } catch {
    return { error: "Could not reach X while syncing direct messages." };
  }
}

export async function deliverXMessage({
  workspaceId,
  address,
  text,
}: {
  workspaceId: string;
  address: string | null;
  text: string;
}): Promise<XDelivery> {
  const connection = connectionRow(workspaceId);

  if (!connection || !readXAuth(String(connection.access_token))) {
    return {
      status: "failed",
      error:
        "X is not connected for this workspace. Link the account in settings before sending.",
    };
  }

  const participant = await resolveParticipant(workspaceId, address);
  if (!participant) {
    return {
      status: "failed",
      error:
        "This contact has no X user id or handle, so the direct message was not sent.",
    };
  }

  const url = `${API}/dm_conversations/with/${participant}/messages`;
  const headers = await authorizationFor(workspaceId, "POST", url);
  if (!headers) {
    return {
      status: "failed",
      error: "The stored X credentials could not be used. Link the account again.",
    };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text }),
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as {
      data?: { dm_event_id?: string };
      detail?: string;
      title?: string;
    } | null;

    if (!response.ok) {
      return {
        status: "failed",
        error: errorMessage(payload as Record<string, unknown> | null, response.status),
      };
    }

    return {
      status: "sent",
      externalId: payload?.data?.dm_event_id ?? null,
    };
  } catch {
    return {
      status: "failed",
      error: "Could not reach X. The message was not delivered.",
    };
  }
}
