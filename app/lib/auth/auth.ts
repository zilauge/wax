import "server-only";

import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { db } from "@/app/lib/db/db";
import type { WorkspaceUser } from "@/app/lib/types";

const SESSION_COOKIE = "wax_session";
const REMEMBERED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SessionUser = WorkspaceUser & { workspaceId: string };

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

export function verifyPassword(password: string, hash: string, salt: string) {
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: string,
  workspaceId: string,
  remember: boolean,
) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + (remember ? REMEMBERED_TTL_MS : DEFAULT_TTL_MS);

  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, workspace_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
  ).run(hashToken(token), userId, workspaceId, now, expiresAt);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(remember ? { maxAge: REMEMBERED_TTL_MS / 1000 } : {}),
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  }
  cookieStore.delete(SESSION_COOKIE);
}

/** Reads the session cookie and resolves the user, workspace and role. */
export async function getSessionUser(): Promise<SessionUser | null> {
  // The session is per-request (cookie + expiry check), never part of a prerender.
  await connection();

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.phone, u.phone_verified_at,
              m.role, m.workspace_id, w.name AS workspace_name, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN memberships m ON m.user_id = u.id AND m.workspace_id = s.workspace_id
       JOIN workspaces w ON w.id = m.workspace_id
       WHERE s.token_hash = ?`,
    )
    .get(hashToken(token));

  if (!row) return null;

  if (Number(row.expires_at) <= Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
    return null;
  }

  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role: String(row.role) as SessionUser["role"],
    workspaceId: String(row.workspace_id),
    workspaceName: String(row.workspace_name),
    phone: row.phone ? String(row.phone) : null,
    phoneVerified: Boolean(row.phone_verified_at),
  };
}

/** Every server action and page that touches workspace data goes through this. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}
