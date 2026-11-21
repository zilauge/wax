import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta signs every webhook body with the app secret. Both the WhatsApp and the
 * Instagram endpoints verify the same header, so one implementation is shared.
 */
export function metaSignatureMatches(
  raw: string,
  header: string | null,
  secret: string,
): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  const received = header.slice("sha256=".length);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
