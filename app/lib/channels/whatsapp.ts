import "server-only";

import { db } from "@/app/lib/db/db";

/**
 * WhatsApp delivery. Two API families are supported: Meta's Cloud API and the
 * operator's WATI account. The tenant is decided by the stored connection row,
 * so neither an inbound webhook nor an outbound send can cross workspaces.
 */
const GRAPH = "https://graph.facebook.com/v21.0";

/** The provider stored on WAX's per-connection WATI marker row. */
export const WATI_PROVIDER = "wati";

function watiSettings() {
  const key = process.env.WATI_API_KEY?.trim();
  const base = process.env.WATI_BASE_URL?.trim().replace(/\/$/, "");
  return key && base ? { key, base } : null;
}

export type WhatsAppDelivery =
  | { status: "sent"; externalId: string | null }
  | { status: "failed"; error: string };

export type WhatsAppCredentials = {
  workspaceId: string;
  provider: string;
  externalId: string;
  accessToken: string;
  accountName: string | null;
};

export function whatsappConnectionForWorkspace(
  workspaceId: string,
): WhatsAppCredentials | null {
  const row = db
    .prepare(
      `SELECT workspace_id, provider, external_id, access_token, account_name
       FROM channel_connections
       WHERE workspace_id = ? AND channel_id = 'whatsapp'`,
    )
    .get(workspaceId);

  if (!row) return null;

  return {
    workspaceId: String(row.workspace_id),
    provider: String(row.provider),
    externalId: String(row.external_id),
    accessToken: String(row.access_token),
    accountName: row.account_name ? String(row.account_name) : null,
  };
}

/** Resolves the workspace that owns a Meta webhook's phone number id. */
export function workspaceForWhatsAppNumber(phoneNumberId: string): string | null {
  const row = db
    .prepare(
      `SELECT workspace_id FROM channel_connections
       WHERE channel_id = 'whatsapp' AND provider = 'meta' AND external_id = ?`,
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

/** Meta returns the provider message id that delivery receipts refer to. */
function sentId(payload: Record<string, unknown> | null): string | null {
  const messages = Array.isArray(payload?.messages)
    ? (payload.messages as Record<string, unknown>[])
    : [];
  const id = messages[0]?.id;
  return typeof id === "string" ? id : null;
}

function watiSentId(payload: Record<string, unknown> | null): string | null {
  const id = payload?.whatsappMessageId ?? payload?.messageId;
  if (typeof id === "string") return id;
  const nested = payload?.message;
  if (nested && typeof nested === "object" && "id" in nested) {
    const nestedId = (nested as { id?: unknown }).id;
    if (typeof nestedId === "string") return nestedId;
  }
  return null;
}

function normalizeNumber(address: string | null) {
  return (address ?? "").replace(/\D/g, "");
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

  const to = normalizeNumber(address);
  if (!to) {
    return {
      status: "failed",
      error: "This contact has no WhatsApp phone number, so nothing was sent.",
    };
  }

  if (connection.provider === WATI_PROVIDER) {
    return sendViaWati(to, text);
  }

  return sendMeta(connection, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: text },
  }, to);
}

/**
 * Outside the 24-hour service window Meta only accepts an approved template.
 * `params` fill the template body in order.
 */
export async function deliverWhatsAppTemplate({
  workspaceId,
  address,
  name,
  language,
  params,
}: {
  workspaceId: string;
  address: string | null;
  name: string;
  language: string;
  params: string[];
}): Promise<WhatsAppDelivery> {
  const connection = whatsappConnectionForWorkspace(workspaceId);

  if (!connection) {
    return { status: "failed", error: "WhatsApp is not connected for this workspace." };
  }
  if (connection.provider === WATI_PROVIDER) {
    return {
      status: "failed",
      error: "Sending templates through WATI is not wired yet.",
    };
  }

  const to = normalizeNumber(address);
  if (!to) {
    return { status: "failed", error: "This contact has no WhatsApp phone number." };
  }

  return sendMeta(
    connection,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name,
        language: { code: language },
        ...(params.length > 0
          ? {
              components: [
                {
                  type: "body",
                  parameters: params.map((value) => ({ type: "text", text: value })),
                },
              ],
            }
          : {}),
      },
    },
    to,
  );
}

async function sendMeta(
  connection: WhatsAppCredentials,
  payload: Record<string, unknown>,
  to: string,
): Promise<WhatsAppDelivery> {
  try {
    const response = await fetch(
      `${GRAPH}/${connection.externalId}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${connection.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
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

    return { status: "sent", externalId: sentId(body) };
  } catch {
    return {
      status: "failed",
      error: `Could not reach WhatsApp for ${to}. The message was not delivered.`,
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

    const payload = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (!response.ok) {
      const message =
        typeof payload?.message === "string"
          ? payload.message
          : typeof payload?.error === "string"
            ? payload.error
            : `WATI responded with ${response.status}.`;
      return { status: "failed", error: message };
    }

    return { status: "sent", externalId: watiSentId(payload) };
  } catch {
    return {
      status: "failed",
      error: "Could not reach WATI. The message was not delivered.",
    };
  }
}
