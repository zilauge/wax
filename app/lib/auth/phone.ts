import "server-only";

import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { db } from "@/app/lib/db/db";
import { sendSms } from "@/app/lib/channels/sms";

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

/**
 * Normalises a mobile number to E.164. The browser may send spaces, dashes or
 * brackets; only the country code and digits are kept.
 */
export function normalizePhone(input: string): string | null {
  const cleaned = input.replace(/[\s()-]/g, "");
  if (!/^\+?\d{8,15}$/.test(cleaned)) return null;
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

function hashCode(salt: string, code: string) {
  return createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

export type SendCodeResult =
  | { ok: true; phone: string; channel: "twilio" | "console" }
  | { ok: false; error: string };

/** Issues a six-digit code for the user's mobile number and texts it. */
export async function startPhoneVerification(
  userId: string,
  input: string,
): Promise<SendCodeResult> {
  const phone = normalizePhone(input);
  if (!phone) {
    return {
      ok: false,
      error:
        "Enter a mobile number in international format, for example +14155550134.",
    };
  }

  const latest = db
    .prepare(
      "SELECT created_at FROM phone_verifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(userId);

  if (latest && Date.now() - Number(latest.created_at) < RESEND_MS) {
    const seconds = Math.ceil(
      (RESEND_MS - (Date.now() - Number(latest.created_at))) / 1000,
    );
    return {
      ok: false,
      error: `Wait ${seconds}s before requesting another code.`,
    };
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const salt = randomBytes(16).toString("hex");
  const id = randomBytes(16).toString("hex");
  const now = Date.now();

  db.prepare(
    `INSERT INTO phone_verifications
       (id, user_id, phone, code_salt, code_hash, created_at, expires_at, attempts)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(id, userId, phone, salt, hashCode(salt, code), now, now + CODE_TTL_MS);

  const delivery = await sendSms(
    phone,
    `Your Wax verification code is ${code}. It expires in 10 minutes.`,
  );

  if (!delivery.ok) {
    db.prepare("DELETE FROM phone_verifications WHERE id = ?").run(id);
    return { ok: false, error: delivery.error };
  }

  db.prepare(
    "UPDATE users SET phone = ?, phone_verified_at = NULL WHERE id = ?",
  ).run(phone, userId);

  return { ok: true, phone, channel: delivery.provider };
}

export type VerifyCodeResult =
  | { ok: true; phone: string }
  | { ok: false; error: string };

/** Checks the newest live code, then marks the number verified for calls. */
export function confirmPhoneCode(
  userId: string,
  input: string,
): VerifyCodeResult {
  const code = input.replace(/\D/g, "");

  if (code.length !== 6) {
    return {
      ok: false,
      error: "Enter the six-digit code from the text message.",
    };
  }

  const row = db
    .prepare(
      `SELECT id, phone, code_salt, code_hash, expires_at, attempts
       FROM phone_verifications
       WHERE user_id = ? AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(userId);

  if (!row) {
    return { ok: false, error: "Request a code before verifying your number." };
  }

  if (Number(row.expires_at) <= Date.now()) {
    return { ok: false, error: "That code has expired. Request a new one." };
  }

  if (Number(row.attempts) >= MAX_ATTEMPTS) {
    return {
      ok: false,
      error: "Too many attempts on that code. Request a new one.",
    };
  }

  const expected = Buffer.from(String(row.code_hash), "hex");
  const actual = Buffer.from(hashCode(String(row.code_salt), code), "hex");
  const matches =
    expected.length === actual.length && timingSafeEqual(expected, actual);

  if (!matches) {
    db.prepare(
      "UPDATE phone_verifications SET attempts = attempts + 1 WHERE id = ?",
    ).run(String(row.id));
    return { ok: false, error: "That code is not correct." };
  }

  const now = Date.now();
  db.prepare(
    "UPDATE phone_verifications SET consumed_at = ? WHERE id = ?",
  ).run(now, String(row.id));
  db.prepare(
    "UPDATE users SET phone = ?, phone_verified_at = ? WHERE id = ?",
  ).run(String(row.phone), now, userId);

  return { ok: true, phone: String(row.phone) };
}
