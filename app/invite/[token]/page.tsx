import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getSessionUser } from "@/app/lib/auth/auth";
import { db } from "@/app/lib/db/db";
import { findInvite, inviteStatus } from "@/app/lib/team/store";
import { acceptInviteAndOpenAction } from "@/app/lib/team/actions";
import inviteArt from "@/app/images/breadcrumb/emailSv.png";

export const metadata: Metadata = { title: "Workspace invitation — Wax" };

export const instant = false;

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const { token } = await params;
  const user = await getSessionUser();
  const invite = findInvite(token);

  const workspace = invite
    ? (db
        .prepare("SELECT name FROM workspaces WHERE id = ?")
        .get(invite.workspaceId) as { name: string } | undefined)
    : undefined;

  const status = invite ? inviteStatus(invite) : { expired: false, used: false };
  const { expired, used } = status;
  const matches = Boolean(
    invite && user && invite.email === user.email.toLowerCase(),
  );

  return (
    <main className="flex min-h-screen items-center justify-center wax-app px-4 py-10 text-slate-200">
      <section className="w-full max-w-md rounded-2xl border border-fg/[0.08] bg-fg/[0.02] p-6">
        <Image
          src={inviteArt}
          alt=""
          width={72}
          height={72}
          priority
          className="h-16 w-16"
        />
        <p className="mt-4 text-[11px] text-slate-500">
          {workspace ? workspace.name : "Workspace invitation"}
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-fg">
          {!invite
            ? "This invitation is not valid"
            : used
              ? "This invitation was already used"
              : expired
                ? "This invitation has expired"
                : `Join as ${invite.role}`}
        </h1>

        {invite && !used && !expired && (
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            The invitation is for <span className="text-slate-200">{invite.email}</span>.
            {user && !matches && (
              <>
                {" "}
                You are signed in as{" "}
                <span className="text-slate-200">{user.email}</span>, so this
                link cannot be accepted from this account.
              </>
            )}
          </p>
        )}

        {error === "1" && (
          <p className="mt-3 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
            That invitation could not be accepted from this account.
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {invite && !used && !expired && matches && (
            <form action={acceptInviteAndOpenAction.bind(null, token)}>
              <button
                type="submit"
                className="rounded-xl bg-gradient-to-r from-indigo-500 via-purple-500 to-fuchsia-500 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-indigo-500/20 transition-opacity hover:opacity-95"
              >
                Accept and open the desk
              </button>
            </form>
          )}

          {!user && (
            <>
              <Link
                href="/sign-in"
                className="rounded-xl bg-gradient-to-r from-indigo-500 via-purple-500 to-fuchsia-500 px-4 py-2.5 text-xs font-semibold text-white"
              >
                Sign in to accept
              </Link>
              <Link
                href="/sign-up"
                className="rounded-xl border border-fg/[0.08] bg-fg/[0.03] px-4 py-2.5 text-xs font-medium text-slate-300 hover:text-fg"
              >
                Create that account
              </Link>
            </>
          )}

          <Link
            href="/inbox"
            className="rounded-xl border border-fg/[0.08] bg-fg/[0.03] px-4 py-2.5 text-xs font-medium text-slate-300 hover:text-fg"
          >
            Back to the desk
          </Link>
        </div>

        {!user && invite && (
          <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
            Sign in with {invite.email}, then reopen this link to accept it.
          </p>
        )}
      </section>
    </main>
  );
}
