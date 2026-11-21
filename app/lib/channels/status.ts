import type { MessageStatus } from "@/app/lib/types";

/**
 * WhatsApp delivery receipts only move forward: a late "sent" must never
 * regress a message that was already read.
 */
const RANK: Record<MessageStatus, number> = {
  failed: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

export function mapReceiptStatus(value: string): MessageStatus | null {
  switch (value) {
    case "sent":
    case "delivered":
    case "read":
    case "failed":
      return value;
    default:
      return null;
  }
}

/**
 * Twilio reports more states than the desk models: queued/sending before the
 * carrier accepts the message, and undelivered/canceled as failures.
 */
export function mapTwilioStatus(value: string): MessageStatus | null {
  switch (value.toLowerCase()) {
    case "queued":
    case "accepted":
    case "scheduled":
    case "sending":
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "read":
      return "read";
    case "failed":
    case "undelivered":
    case "canceled":
      return "failed";
    default:
      return null;
  }
}

export function nextMessageStatus(
  current: MessageStatus,
  incoming: MessageStatus,
): MessageStatus {
  if (current === "failed" || incoming === "failed") return "failed";
  return RANK[incoming] > RANK[current] ? incoming : current;
}
