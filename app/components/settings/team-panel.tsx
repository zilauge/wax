"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Avatar, initials } from "@/app/components/shared/ui";
import type { PendingInvite, TeamMember, TeamRole } from "@/app/lib/team/store";
import {
  changeMemberRoleAction,
  inviteMemberAction,
  removeMemberAction,
  revokeInviteAction,
} from "@/app/lib/team/actions";

const roleLabels: Record<TeamRole, string> = {
  owner: "Owner",
  admin: "Admin",
  agent: "Agent",
};

const selectClass =
  "cursor-pointer rounded-md border border-fg/[0.08] bg-fg/[0.04] px-1.5 py-0.5 text-[11px] text-slate-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Members, roles and pending invitations. Invitations are links: the workspace
 * never sends mail, so the owner copies the link to the person directly. Only
 * the token hash is stored, which is why the link is shown exactly once.
 */
export default function TeamPanel({
  members,
  invites,
  currentUserId,
  canManage,
  isOwner,
}: {
  members: TeamMember[];
  invites: PendingInvite[];
  currentUserId: string;
  canManage: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [pending, startPending] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<TeamRole, "owner">>("agent");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function invite(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    startPending(async () => {
      const result = await inviteMemberAction({ email, role });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.token) {
        setInviteLink(`${window.location.origin}/invite/${result.token}`);
      }
      setEmail("");
      setNotice(`Invitation created for ${email.trim()}.`);
      router.refresh();
    });
  }

  async function copyLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy the link from the field instead.");
    }
  }

  function changeRole(userId: string, next: Exclude<TeamRole, "owner">) {
    setError(null);
    startPending(async () => {
      const result = await changeMemberRoleAction(userId, next);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function remove(userId: string, name: string) {
    if (!window.confirm(`Remove ${name} from this workspace?`)) return;
    setError(null);
    startPending(async () => {
      const result = await removeMemberAction(userId);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function revoke(id: string) {
    setError(null);
    startPending(async () => {
      const result = await revokeInviteAction(id);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <section className="py-2">
      <p className="wax-eyebrow px-4 pt-2 pb-1">Team · {members.length}</p>

      <ul className="divide-y divide-fg/[0.04]">
        {members.map((member) => (
          <li
            key={member.id}
            className="flex flex-wrap items-center gap-3 px-4 py-2.5"
          >
            <Avatar initials={initials(member.name)} color="#6366f1" size="sm" />
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-fg">
                {member.name}
                {member.id === currentUserId && (
                  <span className="ml-1.5 text-[10px] text-slate-500">you</span>
                )}
              </p>
              <p className="truncate text-[10px] text-slate-500">{member.email}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[10px] text-slate-500 capitalize">
                {member.presence} · {member.openConversations} open
              </span>
              {isOwner && member.role !== "owner" && member.id !== currentUserId ? (
                <select
                  value={member.role}
                  onChange={(event) =>
                    changeRole(
                      member.id,
                      event.target.value as Exclude<TeamRole, "owner">,
                    )
                  }
                  disabled={pending}
                  aria-label={`Role for ${member.name}`}
                  className={selectClass}
                >
                  <option value="admin">Admin</option>
                  <option value="agent">Agent</option>
                </select>
              ) : (
                <span className="rounded-md border border-fg/[0.08] px-1.5 py-0.5 text-[10px] text-slate-300">
                  {roleLabels[member.role]}
                </span>
              )}
              {canManage && member.role !== "owner" && member.id !== currentUserId && (
                <button
                  type="button"
                  onClick={() => remove(member.id, member.name)}
                  disabled={pending}
                  className="rounded-md px-1.5 py-0.5 text-[10px] text-slate-500 hover:text-rose-300 disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {canManage && (
        <form onSubmit={invite} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="teammate@company.com"
            aria-label="Email to invite"
            className="min-w-0 flex-1 rounded-lg border border-fg/[0.08] bg-black/25 px-3 py-1.5 text-[11px] text-fg transition-colors placeholder:text-slate-600 focus:border-indigo-400/40 focus:outline-none"
          />
          <select
            value={role}
            onChange={(event) =>
              setRole(event.target.value as Exclude<TeamRole, "owner">)
            }
            aria-label="Invitation role"
            className={selectClass}
          >
            {isOwner && <option value="admin">Admin</option>}
            <option value="agent">Agent</option>
          </select>
          <button
            type="submit"
            disabled={pending || !email.trim()}
            className="wax-press rounded-lg bg-gradient-to-b from-indigo-500 to-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] transition-colors hover:from-indigo-400 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Create invite link
          </button>
        </form>
      )}

      {inviteLink && (
        <div className="mx-4 mb-2 rounded-lg border border-indigo-500/25 bg-indigo-500/10 p-2.5">
          <p className="text-[10px] text-indigo-200">
            Share this link once — it is not shown again. It expires in 7 days
            and only works for the invited address.
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              readOnly
              value={inviteLink}
              aria-label="Invitation link"
              onFocus={(event) => event.currentTarget.select()}
                              className="min-w-0 flex-1 rounded-md border border-fg/[0.08] bg-black/25 px-2 py-1 font-mono text-[10px] text-slate-300"
            />
            <button
              type="button"
              onClick={copyLink}
              className="rounded-md border border-fg/[0.12] px-2 py-1 text-[10px] text-slate-200 hover:bg-fg/[0.06]"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {invites.length > 0 && (
        <ul className="divide-y divide-fg/[0.04] border-t border-fg/[0.06]">
          {invites.map((pendingInvite) => (
            <li
              key={pendingInvite.id}
              className="flex flex-wrap items-center gap-3 px-4 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-[11px] text-slate-200">
                  {pendingInvite.email}
                </p>
                <p className="text-[10px] text-slate-500">
                  {roleLabels[pendingInvite.role]} ·{" "}
                  {pendingInvite.expired
                    ? "expired"
                    : `expires ${new Date(pendingInvite.expiresAt).toLocaleDateString([], { day: "numeric", month: "short" })}`}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300">
                  {pendingInvite.expired ? "Expired" : "Pending"}
                </span>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => revoke(pendingInvite.id)}
                    disabled={pending}
                    className="rounded-md px-1.5 py-0.5 text-[10px] text-slate-500 hover:text-rose-300 disabled:opacity-50"
                  >
                    Revoke
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {notice && (
        <p className="px-4 pb-2 text-[10px] text-emerald-300">{notice}</p>
      )}
      {error && <p className="px-4 pb-2 text-[10px] text-rose-400">{error}</p>}
      {!canManage && (
        <p className="px-4 pb-2 text-[10px] text-slate-500">
          Only owners and admins can invite teammates.
        </p>
      )}
    </section>
  );
}
