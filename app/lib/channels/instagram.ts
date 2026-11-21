import "server-only";

import { db } from "@/app/lib/db/db";

/**
 * Instagram messaging through Meta's Graph API. The linked account is the
 * Instagram professional account id, and the stored token is the Page token
 * that is allowed to send on its behalf. A webhook carries the business account
 * id, which is what resolves the tenant.
 */
const GRAPH = "https://graph.facebook.com/v21.0";

export type InstagramDelivery =
  | { status: "sent"; externalId: string | null }
  | { status: "failed"; error: string };

export type InstagramCredentials = {
  workspaceId: string;
  externalId: string;
  accessToken: string;
  accountName: string | null;
};

export function instagramConnectionForWorkspace(
  workspaceId: string,
): InstagramCredentials | null {
  const row = db
    .prepare(
      `SELECT workspace_id, external_id, access_token, account_name
       FROM channel_connections
       WHERE workspace_id = ? AND channel_id = 'instagram'`,
    )
    .get(workspaceId);

  if (!row) return null;

  return {
    workspaceId: String(row.workspace_id),
    externalId: String(row.external_id),
    accessToken: String(row.access_token),
    accountName: row.account_name ? String(row.account_name) : null,
  };
}

/** Resolves the workspace that owns an Instagram business account id. */
export function workspaceForInstagramAccount(
  instagramAccountId: string,
): string | null {
  const row = db
    .prepare(
      `SELECT workspace_id FROM channel_connections
       WHERE channel_id = 'instagram' AND provider = 'meta' AND external_id = ?`,
    )
    .get(instagramAccountId);

  return row ? String(row.workspace_id) : null;
}

/**
 * Identities are stored normalised (a numeric id becomes "+123…"), but the
 * Instagram recipient must be the bare IGSID the webhook delivered.
 */
function instagramRecipient(address: string | null) {
  return (address ?? "").replace(/[^\d]/g, "");
}

function errorMessage(payload: Record<string, unknown> | null, status: number) {
  const nested = payload?.error;
  if (nested && typeof nested === "object" && "message" in nested) {
    const message = (nested as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return `Instagram responded with ${status}.`;
}

export async function deliverInstagramMessage({
  workspaceId,
  address,
  text,
}: {
  workspaceId: string;
  address: string | null;
  text: string;
}): Promise<InstagramDelivery> {
  const connection = instagramConnectionForWorkspace(workspaceId);

  if (!connection) {
    return {
      status: "failed",
      error:
        "Instagram is not connected for this workspace. Link the account in settings before sending.",
    };
  }

  const recipient = instagramRecipient(address);
  if (!recipient) {
    return {
      status: "failed",
      error: "This contact has no Instagram id, so nothing was sent.",
    };
  }

  try {
    const response = await fetch(
      `${GRAPH}/${connection.externalId}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${connection.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          recipient: { id: recipient },
          messaging_type: "RESPONSE",
          message: { text },
        }),
        cache: "no-store",
      },
    );

    const body = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (!response.ok) {
      return { status: "failed", error: errorMessage(body, response.status) };
    }

    const id = body?.message_id;
    return {
      status: "sent",
      externalId: typeof id === "string" ? id : null,
    };
  } catch {
    return {
      status: "failed",
      error: "Could not reach Instagram. The message was not delivered.",
    };
  }
}
