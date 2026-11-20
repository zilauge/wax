import "server-only";

import { db } from "@/app/lib/db/db";

/**
 * WhatsApp Cloud API delivery. The tenant is decided by the stored connection
 * row: its access token and its phone number id (kept in `external_id`) belong
 * to exactly one workspace, so neither an inbound webhook nor an outbound send
 * can cross tenants.
 */
const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * A connection whose external id is "wati" is served by the operator's WATI
 * account instead of Meta's Cloud API. It is a per-connection marker, so only
 * the workspace that owns that row sends through WATI.
 */
export const WATI_TRANSPORT = "wati";

function watiSettings() {
  const key = process.env.WATI_API_KEY?.trim();
  const base = process.env.WATI_BASE_URL?.trim().replace(/\/$/, "");
  return key && base ? { key, base } : null;
}

export type WhatsAppDelivery =
  | { status: "sent" }
  | { status: "failed"; error: string };

export type WhatsAppCredentials = {
  workspaceId: string;
  phoneNumberId: string;
  accessToken: string;
  accountName: string | null;
};

export function whatsappConnectionForWorkspace(
  workspaceId: string,
): WhatsAppCredentials | null {
  const row = db
    .prepare(
      `SELECT workspace_id, external_id, access_token, account_name
       FROM channel_connections
       WHERE workspace_id = ? AND channel_id = 'whatsapp'`,
    )
    .get(workspaceId);

  if (!row) return null;

  return {
    workspaceId: String(row.workspace_id),
    phoneNumberId: String(row.external_id),
    accessToken: String(row.access_token),
    accountName: row.account_name ? String(row.account_name) : null,
  };
}

/** Resolves the workspace that owns a webhook's phone number id. */
export function workspaceForWhatsAppNumber(phoneNumberId: string): string | null {
  const row = db
    .prepare(
      `SELECT workspace_id FROM channel_connections
       WHERE channel_id = 'whatsapp' AND external_id = ?`,
    )
    .get(phoneNumberId);

  return row ? String(row.workspace_id) : null;
}

function errorMessage(payload: Record<string, unknown> | null, status: number) {
  const nested = payload?.error;
  if (nested && typeof nested === "object" && "message" in nested) {
    const message = (nested as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  if (typeof payload?.message === "string") return payload.message;
  return `WhatsApp responded with ${status}.`;
}

export async function deliverWhatsAppMessage({
  workspaceId,
  address,
  text,
}: {
  workspaceId: string;
  address: string | null;
  text: string;
}): Promise<WhatsAppDelivery> {
  const connection = whatsappConnectionForWorkspace(workspaceId);

  if (!connection) {
    return {
      status: "failed",
      error:
        "WhatsApp is not connected for this workspace. Link the account in settings before sending.",
    };
  }

  const to = (address ?? "").replace(/\D/g, "");
  if (!to) {
    return {
      status: "failed",
      error: "This contact has no WhatsApp phone number, so nothing was sent.",
    };
  }

  if (connection.phoneNumberId === WATI_TRANSPORT) {
    return sendViaWati(to, text);
  }

  try {
    const response = await fetch(
      `${GRAPH}/${connection.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${connection.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { body: text },
        }),
        cache: "no-store",
      },
    );

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      return {
        status: "failed",
        error: errorMessage(payload, response.status),
      };
    }

    return { status: "sent" };
  } catch {
    return {
      status: "failed",
      error: "Could not reach WhatsApp. The message was not delivered.",
    };
  }
}

async function sendViaWati(
  target: string,
  text: string,
): Promise<WhatsAppDelivery> {
  const settings = watiSettings();
  if (!settings) {
    return {
      status: "failed",
      error:
        "WATI is not configured on this server. Set WATI_API_KEY and WATI_BASE_URL.",
    };
  }

  try {
    const response = await fetch(
      `${settings.base}/conversations/messages/text`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${settings.key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ target, text }),
        cache: "no-store",
      },
    );

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const message =
        typeof payload?.message === "string"
          ? payload.message
          : typeof payload?.error === "string"
            ? payload.error
            : `WATI responded with ${response.status}.`;
      return { status: "failed", error: message };
    }

    return { status: "sent" };
  } catch {
    return {
      status: "failed",
      error: "Could not reach WATI. The message was not delivered.",
    };
  }
}
