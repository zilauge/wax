/**
 * X exposes inbound DMs through `GET /2/dm_events`, but only for apps whose
 * plan and permissions include DM read. When X refuses that call the channel is
 * still usable for replies, so the refusal is classified as a capability the UI
 * can state plainly instead of an error that looks like a broken integration.
 *
 * Pure, so the rules can be tested without a server.
 */
export type XInboundCapability = "unavailable" | null;

export function classifyXInboundFailure(
  status: number,
  payload: Record<string, unknown> | null,
): { capability: XInboundCapability; message: string } {
  const detail =
    typeof payload?.detail === "string"
      ? payload.detail
      : typeof payload?.title === "string"
        ? payload.title
        : null;

  const denied =
    status === 401 ||
    status === 403 ||
    (detail !== null && /dm\.read|not authorized|access to this endpoint/i.test(detail));

  if (denied) {
    return {
      capability: "unavailable",
      message:
        "This X app cannot read direct messages, so incoming X messages will not appear here. Replies still send. Set the app's permission to \"Read, write and access Direct Messages\" (OAuth 1.0a) or grant the dm.read scope (OAuth 2.0).",
    };
  }

  return {
    capability: null,
    message: detail ?? `X responded with ${status} while reading direct messages.`,
  };
}
