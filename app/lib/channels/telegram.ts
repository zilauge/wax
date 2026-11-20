import "server-only";

/**
 * Telegram is the first channel wired end to end: messages arrive through
 * /api/webhooks/telegram and leave through the Bot API below. The bot token is
 * a server-only environment variable and is never sent to the browser.
 */
const API_ROOT = "https://api.telegram.org";

export type DeliveryResult = {
  status: "sent" | "failed";
  error?: string;
};

export function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export async function deliverTelegramMessage(
  chatId: string | null,
  text: string,
): Promise<DeliveryResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    return {
      status: "failed",
      error: "Telegram is not connected — set TELEGRAM_BOT_TOKEN on the server.",
    };
  }

  if (!chatId) {
    return {
      status: "failed",
      error: "This contact has no Telegram chat id, so no message was sent.",
    };
  }

  try {
    const response = await fetch(`${API_ROOT}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; description?: string }
      | null;

    if (!response.ok || !payload?.ok) {
      return {
        status: "failed",
        error:
          payload?.description ?? `Telegram responded with ${response.status}.`,
      };
    }

    return { status: "sent" };
  } catch {
    return {
      status: "failed",
      error: "Could not reach Telegram. The message was not delivered.",
    };
  }
}
