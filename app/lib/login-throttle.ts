import "server-only";

import { db } from "./db";

/**
 * Brute-force protection for the sign-in form, on two axes:
 *
 *  - per account (normalised email): five failures in fifteen minutes start a
 *    one-minute cooldown. Unknown addresses are counted the same way, so the
 *    form cannot be used to discover which emails are registered.
 *  - per client IP: twenty failures in fifteen minutes start a five-minute
 *    cooldown. This is deliberately looser — it catches one client guessing
 *    across many accounts, while a person mistyping their password once (or a
 *    few people behind the same office IP) stays well under it.
 *
 * A successful sign-in clears the account counter but not the IP counter: if
 * successes reset the IP budget, an attacker holding one valid login could erase
 * the evidence of every other guess. State lives in SQLite so a restart does not
 * hand an attacker a fresh budget.
 */
type Policy = {
  maxAttempts: number;
  windowMs: number;
  cooldownMs: number;
};

const ACCOUNT_POLICY: Policy = {
  maxAttempts: 5,
  windowMs: 15 * 60_000,
  cooldownMs: 60_000,
};

const CLIENT_POLICY: Policy = {
  maxAttempts: 20,
  windowMs: 15 * 60_000,
  cooldownMs: 5 * 60_000,
};

type Scope = { key: string; policy: Policy };

type AttemptRow = {
  count: number;
  first_attempt_at: number;
  locked_until: number;
};

export type ThrottleState = {
  locked: boolean;
  retryAfterSeconds: number;
};

function accountScope(email: string): Scope {
  return {
    key: `account:${email.trim().toLowerCase()}`,
    policy: ACCOUNT_POLICY,
  };
}

function clientScope(ip: string): Scope {
  return { key: `ip:${ip}`, policy: CLIENT_POLICY };
}

/** Best-effort client address; behind a proxy the first X-Forwarded-For entry. */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

function readAttempt(key: string): AttemptRow | null {
  const row = db
    .prepare(
      "SELECT count, first_attempt_at, locked_until FROM login_attempts WHERE key = ?",
    )
    .get(key);

  if (!row) return null;

  return {
    count: Number(row.count),
    first_attempt_at: Number(row.first_attempt_at),
    locked_until: Number(row.locked_until),
  };
}

function checkScope(scope: Scope): ThrottleState {
  const attempt = readAttempt(scope.key);
  if (!attempt) return { locked: false, retryAfterSeconds: 0 };

  const now = Date.now();

  if (attempt.locked_until > now) {
    return {
      locked: true,
      retryAfterSeconds: Math.ceil((attempt.locked_until - now) / 1000),
    };
  }

  // Cooldown finished (or the window lapsed): the next attempt starts fresh.
  if (
    attempt.locked_until > 0 ||
    now - attempt.first_attempt_at > scope.policy.windowMs
  ) {
    db.prepare("DELETE FROM login_attempts WHERE key = ?").run(scope.key);
  }

  return { locked: false, retryAfterSeconds: 0 };
}

function bumpScope(scope: Scope): ThrottleState {
  const now = Date.now();
  const attempt = readAttempt(scope.key);
  const windowExpired =
    !attempt || now - attempt.first_attempt_at > scope.policy.windowMs;

  const count = windowExpired ? 1 : attempt.count + 1;
  const firstAttemptAt = windowExpired ? now : attempt.first_attempt_at;
  const lockedUntil =
    count >= scope.policy.maxAttempts ? now + scope.policy.cooldownMs : 0;

  db.prepare(
    `INSERT INTO login_attempts (key, count, first_attempt_at, locked_until)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = excluded.count,
       first_attempt_at = excluded.first_attempt_at,
       locked_until = excluded.locked_until`,
  ).run(scope.key, count, firstAttemptAt, lockedUntil);

  return {
    locked: lockedUntil > 0,
    retryAfterSeconds:
      lockedUntil > 0 ? Math.ceil(scope.policy.cooldownMs / 1000) : 0,
  };
}

function firstLocked(states: ThrottleState[]): ThrottleState {
  return states.find((state) => state.locked) ?? { locked: false, retryAfterSeconds: 0 };
}

export function checkLoginThrottle(email: string, ip: string): ThrottleState {
  return firstLocked([checkScope(accountScope(email)), checkScope(clientScope(ip))]);
}

export function recordFailedLogin(email: string, ip: string): ThrottleState {
  return firstLocked([bumpScope(accountScope(email)), bumpScope(clientScope(ip))]);
}

/** Clears the account counter only; the client counter keeps counting. */
export function clearLoginFailures(email: string) {
  db.prepare("DELETE FROM login_attempts WHERE key = ?").run(
    accountScope(email).key,
  );
}
