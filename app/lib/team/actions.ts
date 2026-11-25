"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireUser } from "@/app/lib/auth/auth";
import { publishWorkspaceEvent } from "@/app/lib/workspace/realtime";
import {
  acceptInvite,
  changeMemberRole,
  createInvite,
  findInvite,
  listMembers,
  ownerCount,
  removeMember,
  revokeInvite,
  type TeamRole,
} from "./store";

export type TeamResult =
  | { ok: true; token?: string }
  | { ok: false; error: string };

function canManage(role: string) {
  return role === "owner" || role === "admin";
}

/** Adds a pending invitation; the token is returned once, to build the link. */
export async function inviteMemberAction(input: {
  email: string;
  role: TeamRole;
}): Promise<TeamResult> {
  const user = await requireUser();
  if (!canManage(user.role)) {
    return { ok: false, error: "Only owners and admins can invite teammates." };
  }

  const email = input.email.trim().toLowerCase();
  const role = input.role;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (role !== "admin" && role !== "agent") {
    return { ok: false, error: "Invite someone as an admin or an agent." };
  }
  if (role === "admin" && user.role !== "owner") {
    return { ok: false, error: "Only an owner can invite another admin." };
  }

  const already = listMembers(user.workspaceId).find(
    (member) => member.email.toLowerCase() === email,
  );
  if (already) {
    return { ok: false, error: `${already.name} is already on this workspace.` };
  }

  const { token } = createInvite({
    workspaceId: user.workspaceId,
    email,
    role,
    createdBy: user.id,
  });

  publishWorkspaceEvent(user.workspaceId, {
    kind: "presence",
    text: `${user.name} invited ${email}`,
  });

  refresh();
  return { ok: true, token };
}

export async function revokeInviteAction(inviteId: string): Promise<TeamResult> {
  const user = await requireUser();
  if (!canManage(user.role)) {
    return { ok: false, error: "Only owners and admins can revoke invitations." };
  }

  const removed = revokeInvite(user.workspaceId, inviteId);
  if (!removed) return { ok: false, error: "That invitation is already gone." };

  refresh();
  return { ok: true };
}

export async function changeMemberRoleAction(
  userId: string,
  role: Exclude<TeamRole, "owner">,
): Promise<TeamResult> {
  const user = await requireUser();
  if (user.role !== "owner") {
    return { ok: false, error: "Only an owner can change roles." };
  }
  if (role !== "admin" && role !== "agent") {
    return { ok: false, error: "Choose admin or agent." };
  }
  if (userId === user.id) {
    return { ok: false, error: "You cannot change your own role." };
  }

  const changed = changeMemberRole(user.workspaceId, userId, role);
  if (!changed) return { ok: false, error: "That person is not on this workspace." };

  publishWorkspaceEvent(user.workspaceId, {
    kind: "presence",
    text: `A teammate's role changed to ${role}`,
  });

  refresh();
  return { ok: true };
}

export async function removeMemberAction(userId: string): Promise<TeamResult> {
  const user = await requireUser();
  if (!canManage(user.role)) {
    return { ok: false, error: "Only owners and admins can remove teammates." };
  }
  if (userId === user.id) {
    return { ok: false, error: "You cannot remove yourself." };
  }

  const target = listMembers(user.workspaceId).find((member) => member.id === userId);
  if (!target) return { ok: false, error: "That person is not on this workspace." };

  if (target.role === "owner" && ownerCount(user.workspaceId) <= 1) {
    return { ok: false, error: "A workspace needs at least one owner." };
  }
  if (user.role === "admin" && target.role !== "agent") {
    return { ok: false, error: "Only an owner can remove an owner or admin." };
  }

  const removed = removeMember(user.workspaceId, userId);
  if (!removed) return { ok: false, error: "That person is not on this workspace." };

  publishWorkspaceEvent(user.workspaceId, {
    kind: "presence",
    text: `${target.name} was removed from the workspace`,
  });

  refresh();
  return { ok: true };
}

/** Called from the invitation link; the invite's email decides who may join. */
export async function acceptInviteAction(token: string): Promise<TeamResult> {
  const user = await requireUser();

  // The signed-in account must be the invited address; the store enforces it,
  // this only produces the friendlier message before that check runs.
  const invite = findInvite(token);
  if (!invite) return { ok: false, error: "That invitation no longer exists." };

  const result = acceptInvite(token, user.id, user.email);
  if (!result.ok) return { ok: false, error: result.error };

  refresh();
  return { ok: true };
}

export async function acceptInviteAndOpenAction(token: string): Promise<void> {
  const result = await acceptInviteAction(token);
  if (!result.ok) {
    redirect(`/invite/${encodeURIComponent(token)}?error=1`);
  }
  redirect("/inbox");
}
