import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { db } from "@/app/lib/db/db";
import { resolveTimeZone, systemTimeZone } from "@/app/lib/calendar/rules";
import { provisionWorkspace } from "@/app/lib/workspace/seed";
import type { WorkspaceUser } from "@/app/lib/types";

export type SessionUser = WorkspaceUser & { workspaceId: string };

type UserRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  phone_verified_at: number | null;
  timezone: string | null;
  role: string;
  workspace_id: string;
  workspace_name: string;
};

const USER_SELECT = `
  SELECT u.id, u.name, u.email, u.phone, u.phone_verified_at, u.timezone,
         m.role, m.workspace_id, w.name AS workspace_name
  FROM users u
  JOIN memberships m ON m.user_id = u.id
  JOIN workspaces w ON w.id = m.workspace_id
`;

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role: String(row.role) as SessionUser["role"],
    workspaceId: String(row.workspace_id),
    workspaceName: String(row.workspace_name),
    phone: row.phone ? String(row.phone) : null,
    phoneVerified: Boolean(row.phone_verified_at),
    timeZone: resolveTimeZone(row.timezone ? String(row.timezone) : null),
  };
}

/** The workspace this person belongs to; the oldest membership is the default. */
function loadLocalUser(userId: string): SessionUser | null {
  const row = db
    .prepare(
      `${USER_SELECT}
       WHERE u.id = ?
       ORDER BY m.rowid ASC
       LIMIT 1`,
    )
    .get(userId) as UserRow | undefined;

  return row ? toSessionUser(row) : null;
}

function primaryEmail(clerkUser: {
  emailAddresses: { id: string; emailAddress: string }[];
  primaryEmailAddressId: string | null;
}) {
  const primary = clerkUser.emailAddresses.find(
    (address) => address.id === clerkUser.primaryEmailAddressId,
  );
  return (primary ?? clerkUser.emailAddresses[0])?.emailAddress.toLowerCase() ?? null;
}

/**
 * Maps a Clerk identity onto a local user row.
 *
 * The first sign-in creates the row and its workspace; later ones only read.
 * A pre-existing account with the same email is adopted rather than duplicated,
 * because the users table is unique on email.
 */
async function resolveLocalUser(clerkUserId: string): Promise<SessionUser | null> {
  const linked = db
    .prepare("SELECT id FROM users WHERE clerk_user_id = ?")
    .get(clerkUserId) as { id: string } | undefined;

  if (linked) return loadLocalUser(String(linked.id));

  const clerkUser = await currentUser();
  if (!clerkUser) return null;

  const email = primaryEmail(clerkUser);
  if (!email) return null;

  const name =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim() ||
    clerkUser.username ||
    email.split("@")[0];

  const existing = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(email) as { id: string } | undefined;

  if (existing) {
    db.prepare("UPDATE users SET clerk_user_id = ? WHERE id = ?").run(
      clerkUserId,
      String(existing.id),
    );
    const membership = db
      .prepare("SELECT 1 FROM memberships WHERE user_id = ? LIMIT 1")
      .get(String(existing.id));
    if (!membership) {
      provisionWorkspace({
        userId: String(existing.id),
        userName: String(name),
        companyName: "",
      });
    }
    return loadLocalUser(String(existing.id));
  }

  const userId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO users
       (id, clerk_user_id, email, name, company, password_hash, password_salt,
        phone, timezone, created_at)
     VALUES (?, ?, ?, ?, NULL, '', '', NULL, ?, ?)`,
  ).run(userId, clerkUserId, email, name, systemTimeZone(), Date.now());

  provisionWorkspace({ userId, userName: String(name), companyName: "" });

  return loadLocalUser(userId);
}

/**
 * The single seam between Clerk and the workspace: every page, action and API
 * route already resolves the current person through this function.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  // Reading the Clerk session is per-request (never part of a prerender).
  await connection();

  // The session token carries the id, so the common path makes no network call
  // to Clerk; the profile is fetched only when this person is new to the desk.
  const { userId } = await auth();
  if (!userId) return null;

  return resolveLocalUser(userId);
}

/** Every server action and page that touches workspace data goes through this. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  return user;
}
