import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Twilio signs the full webhook URL followed by every sorted POST parameter.
 * The URL must be the exact one configured on the number, so callers pass the
 * public URL when the app runs behind a proxy.
 */
export function twilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
) {
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(payload, "utf8").digest("base64");
}

export function verifyTwilioSignature({
  authToken,
  url,
  signature,
  params,
}: {
  authToken: string;
  url: string;
  signature: string | null;
  params: Record<string, string>;
}): boolean {
  if (!signature) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const received = Buffer.from(signature);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}
