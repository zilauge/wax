import "server-only";

/**
 * Transactional SMS for phone verification. Any Twilio-compatible account works:
 * the credentials live in server-only environment variables. Without them the
 * code is printed to the server log in development and refused in production,
 * so a real deployment can never silently pretend a code was delivered.
 */
export type SmsDelivery =
  | { ok: true; provider: "twilio" | "console" }
  | { ok: false; error: string };

function credentials() {
  return {
    sid: process.env.TWILIO_ACCOUNT_SID?.trim(),
    token: process.env.TWILIO_AUTH_TOKEN?.trim(),
    from: process.env.TWILIO_FROM_NUMBER?.trim(),
  };
}

export async function sendSms(to: string, body: string): Promise<SmsDelivery> {
  const { sid, token, from } = credentials();

  if (!sid || !token || !from) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[wax] SMS to ${to}: ${body}`);
      return { ok: true, provider: "console" };
    }
    return {
      ok: false,
      error:
        "SMS is not configured on this server. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER.",
    };
  }

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: from, Body: body }),
        cache: "no-store",
      },
    );

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;
      return {
        ok: false,
        error:
          payload?.message ??
          `The SMS provider responded with ${response.status}.`,
      };
    }

    return { ok: true, provider: "twilio" };
  } catch {
    return {
      ok: false,
      error: "Could not reach the SMS provider. The code was not sent.",
    };
  }
}
