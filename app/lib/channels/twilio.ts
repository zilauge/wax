import "server-only";

import { db } from "@/app/lib/db/db";

/**
 * SMS as an inbox channel through Twilio.
 *
 * The linked account is the sending number; the Account SID and auth token are
 * stored together as JSON in the connection's server-only token column, because
 * one workspace keeps one number and the pair is what signs its webhooks.
 */
export const TWILIO_PROVIDER = "twilio";

export type SmsDelivery =
  | { status: "sent"; externalId: string | null }
  | { status: "failed"; error: string };

export type SmsCredentials = {
  workspaceId: string;
  accountSid: string;
  authToken: string;
  from: string;
  accountName: string | null;
};

/** E.164, so a stored number can always be matched to a webhook's "To". */
export function normalizeSmsNumber(raw: string) {
  const digits = raw.replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

function parseToken(value: string): { accountSid: string; authToken: string } | null {
  try {
    const parsed = JSON.parse(value) as {
      accountSid?: unknown;
      authToken?: unknown;
    };
    if (
      typeof parsed.accountSid === "string" &&
      typeof parsed.authToken === "string"
    ) {
      return { accountSid: parsed.accountSid, authToken: parsed.authToken };
    }
  } catch {
    // Older rows stored a bare token; treated as unusable rather than guessed.
  }
  return null;
}

function credentialsFromRow(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  const token = parseToken(String(row.access_token));
  if (!token) return null;
  return {
    workspaceId: String(row.workspace_id),
    accountSid: token.accountSid,
    authToken: token.authToken,
    from: String(row.external_id),
    accountName: row.account_name ? String(row.account_name) : null,
  };
}

export function smsConnectionForWorkspace(
  workspaceId: string,
): SmsCredentials | null {
  const row = db
    .prepare(
      `SELECT workspace_id, external_id, access_token, account_name
       FROM channel_connections
       WHERE workspace_id = ? AND channel_id = 'sms' AND provider = ?`,
    )
    .get(workspaceId, TWILIO_PROVIDER);

  return credentialsFromRow(row);
}

/**
 * Resolves the tenant from the number Twilio received the message on, then
 * returns the auth token that must have signed the request.
 */
export function workspaceForSmsNumber(
  to: string,
): { workspaceId: string; authToken: string } | null {
  const row = db
    .prepare(
      `SELECT workspace_id, external_id, access_token, account_name
       FROM channel_connections
       WHERE channel_id = 'sms' AND provider = ? AND external_id = ?`,
    )
    .get(TWILIO_PROVIDER, normalizeSmsNumber(to));

  const credentials = credentialsFromRow(row);
  return credentials
    ? {
        workspaceId: credentials.workspaceId,
        authToken: credentials.authToken,
      }
    : null;
}

function errorMessage(payload: Record<string, unknown> | null, status: number) {
  const message = payload?.message;
  return typeof message === "string"
    ? message
    : `Twilio responded with ${status}.`;
}

export async function deliverSmsMessage({
  workspaceId,
  address,
  text,
}: {
  workspaceId: string;
  address: string | null;
  text: string;
}): Promise<SmsDelivery> {
  const connection = smsConnectionForWorkspace(workspaceId);

  if (!connection) {
    return {
      status: "failed",
      error:
        "SMS is not connected for this workspace. Link a Twilio number in settings before sending.",
    };
  }

  const to = normalizeSmsNumber(address ?? "");
  if (!to) {
    return {
      status: "failed",
      error: "This contact has no phone number, so nothing was sent.",
    };
  }

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${connection.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(
            `${connection.accountSid}:${connection.authToken}`,
          ).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: to,
          From: connection.from,
          Body: text,
        }),
        cache: "no-store",
      },
    );

    const payload = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (!response.ok) {
      return { status: "failed", error: errorMessage(payload, response.status) };
    }

    const sid = payload?.sid;
    return { status: "sent", externalId: typeof sid === "string" ? sid : null };
  } catch {
    return {
      status: "failed",
      error: "Could not reach Twilio. The message was not delivered.",
    };
  }
}
