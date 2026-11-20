/**
 * Channel identities are stored in one canonical form so the same person can be
 * matched across channels:
 *
 *   phone-like  "+234 803 555 0198" -> "+2348035550198"
 *   handle      "@Amara_Ok"          -> "@amara_ok"
 *
 * A bare digit string (a Telegram chat id, for example) is treated as a phone
 * number, because that is the only form the platform gives us and it is what a
 * WhatsApp identity for the same person would look like.
 */
export type IdentityKind = "phone" | "handle";

export type NormalizedIdentity = {
  kind: IdentityKind;
  address: string;
};

const PHONE_LIKE = /^[+]?[\d\s().-]+$/;

export function normalizeIdentity(raw: string): NormalizedIdentity | null {
  const value = raw.trim();
  if (!value) return null;

  if (PHONE_LIKE.test(value)) {
    const digits = value.replace(/\D/g, "");
    if (!digits) return null;
    return { kind: "phone", address: `+${digits}` };
  }

  const handle = value.replace(/^@+/, "").trim().toLowerCase();
  if (!handle) return null;
  return { kind: "handle", address: `@${handle}` };
}
