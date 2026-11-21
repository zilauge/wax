/**
 * Token storage shapes. Meta tokens are long-lived and stored raw; Google and X
 * issue short-lived access tokens with a refresh token, so those connections
 * store a small JSON blob. Kept free of server-only imports so the rules can be
 * exercised by the test runner.
 */
export type StoredToken = {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds; absent means the token has no known expiry. */
  expiresAt?: number;
};

export function readStoredToken(raw: string): StoredToken | null {
  const value = raw.trim();
  if (!value) return null;

  if (!value.startsWith("{")) return { accessToken: value };

  try {
    const parsed = JSON.parse(value) as {
      accessToken?: unknown;
      refreshToken?: unknown;
      expiresAt?: unknown;
    };
    if (typeof parsed.accessToken !== "string" || !parsed.accessToken) {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken:
        typeof parsed.refreshToken === "string" ? parsed.refreshToken : undefined,
      expiresAt:
        typeof parsed.expiresAt === "number" ? parsed.expiresAt : undefined,
    };
  } catch {
    return null;
  }
}

export function serializeToken(token: StoredToken): string {
  if (!token.refreshToken && token.expiresAt === undefined) {
    return token.accessToken;
  }
  return JSON.stringify(token);
}

/** Refresh a minute early so a send never races the expiry. */
export function tokenNeedsRefresh(token: StoredToken, now = Date.now()): boolean {
  if (!token.refreshToken || token.expiresAt === undefined) return false;
  return token.expiresAt - 60_000 <= now;
}
