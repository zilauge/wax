import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "@/app/lib/db/db";

import type {
  PendingInvite,
  TeamMember,
  TeamRole,
} from "@/app/lib/types";

export type { PendingInvite, TeamMember, TeamRole };

export type InviteRecord = {
  id: string;
  workspaceId: string;
  email: string;
  role: TeamRole;
  expiresAt: number;
  acceptedAt: number | null;
};

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function listMembers(workspaceId: string): TeamMember[] {
  return db
    .prepare(
      `SELECT u.id, u.name, u.email, m.role, p.status,
              (SELECT COUNT(*) FROM conversations c
               WHERE c.workspace_id = m.workspace_id
                 AND c.assignee_user_id = u.id
                 AND c.status != 'resolved') AS open_count
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN agent_presence p
         ON p.workspace_id = m.workspace_id AND p.user_id = u.id
       WHERE m.workspace_id = ?
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                u.name`,
    )
    .all(workspaceId)
    .map((row) => ({
      id: String(row.id),
      name: String(row.name),
      email: String(row.email),
      role: String(row.role) as TeamRole,
      presence: (row.status ? String(row.status) : "away") as TeamMember["presence"],
      openConversations: Number(row.open_count ?? 0),
    }));
}

export function listInvites(workspaceId: string): PendingInvite[] {
  const now = Date.now();
  return db
    .prepare(
      `SELECT id, email, role, created_at, expires_at
       FROM invites
       WHERE workspace_id = ? AND accepted_at IS NULL
       ORDER BY created_at DESC`,
    )
    .all(workspaceId)
    .map((row) => ({
      id: String(row.id),
      email: String(row.email),
      role: String(row.role) as TeamRole,
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at),
      expired: Number(row.expires_at) <= now,
    }));
}

/** Creates an invite and returns the one-time link; only the hash is stored. */
export function createInvite({
  workspaceId,
  email,
  role,
  createdBy,
}: {
  workspaceId: string;
  email: string;
  role: TeamRole;
  createdBy: string;
}) {
  const id = randomUUID();
  const token = randomBytes(24).toString("base64url");
  const now = Date.now();

  db.prepare(
    `INSERT INTO invites
       (id, workspace_id, email, role, token_hash, created_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    workspaceId,
    email.toLowerCase(),
    role,
    hashInviteToken(token),
    createdBy,
    now,
    now + INVITE_TTL_MS,
  );

  return { id, token };
}

export function revokeInvite(workspaceId: string, inviteId: string) {
  return db
    .prepare("DELETE FROM invites WHERE id = ? AND workspace_id = ?")
    .run(inviteId, workspaceId).changes;
}

/** Whether an invite can still be used, evaluated once per request. */
export function inviteStatus(invite: InviteRecord) {
  return {
    expired: invite.expiresAt <= Date.now(),
    used: Boolean(invite.acceptedAt),
  };
}

export function findInvite(token: string): InviteRecord | null {
  const row = db
    .prepare(
      `SELECT id, workspace_id, email, role, expires_at, accepted_at
       FROM invites WHERE token_hash = ?`,
    )
    .get(hashInviteToken(token));

  if (!row) return null;

  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    email: String(row.email),
    role: String(row.role) as TeamRole,
    expiresAt: Number(row.expires_at),
    acceptedAt: row.accepted_at ? Number(row.accepted_at) : null,
  };
}

/**
 * Accepts an invite for a signed-in person. The invite's email is what decides
 * who may use it, so a forwarded link cannot add a different account.
 */
export function acceptInvite(token: string, userId: string, userEmail: string) {
  const invite = findInvite(token);
  if (!invite) return { ok: false as const, error: "That invitation no longer exists." };
  if (invite.acceptedAt) {
    return { ok: false as const, error: "That invitation has already been used." };
  }
  if (invite.expiresAt <= Date.now()) {
    return { ok: false as const, error: "That invitation has expired." };
  }
  if (invite.email !== userEmail.toLowerCase()) {
    return {
      ok: false as const,
      error: `This invitation is for ${invite.email}. Sign in with that address to accept it.`,
    };
  }

  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT OR IGNORE INTO memberships (workspace_id, user_id, role) VALUES (?, ?, ?)",
    ).run(invite.workspaceId, userId, invite.role);
    db.prepare(
      "UPDATE invites SET accepted_at = ?, accepted_by = ? WHERE id = ?",
    ).run(Date.now(), userId, invite.id);
    db.prepare(
      `INSERT INTO agent_presence (workspace_id, user_id, status, updated_at)
       VALUES (?, ?, 'available', ?)
       ON CONFLICT(workspace_id, user_id) DO NOTHING`,
    ).run(invite.workspaceId, userId, Date.now());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { ok: true as const, workspaceId: invite.workspaceId };
}

export function changeMemberRole(
  workspaceId: string,
  userId: string,
  role: Exclude<TeamRole, "owner">,
) {
  return db
    .prepare("UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?")
    .run(role, workspaceId, userId).changes;
}

export function removeMember(workspaceId: string, userId: string) {
  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE conversations SET assignee_user_id = NULL
       WHERE workspace_id = ? AND assignee_user_id = ? AND status != 'resolved'`,
    ).run(workspaceId, userId);
    db.prepare(
      "DELETE FROM agent_presence WHERE workspace_id = ? AND user_id = ?",
    ).run(workspaceId, userId);
    const result = db
      .prepare("DELETE FROM memberships WHERE workspace_id = ? AND user_id = ?")
      .run(workspaceId, userId);
    db.exec("COMMIT");
    return result.changes;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function ownerCount(workspaceId: string) {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM memberships WHERE workspace_id = ? AND role = 'owner'",
    )
    .get(workspaceId);
  return Number(row?.n ?? 0);
}
