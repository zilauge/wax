/** WhatsApp only allows free-form replies for 24 hours after the customer writes. */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function replyWindowEndsAt(lastInboundAt: number | null): number | null {
  return lastInboundAt === null ? null : lastInboundAt + REPLY_WINDOW_MS;
}

export function isReplyWindowOpen(
  lastInboundAt: number | null,
  now = Date.now(),
): boolean {
  const endsAt = replyWindowEndsAt(lastInboundAt);
  return endsAt !== null && endsAt > now;
}
