import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/app/lib/auth/auth";
import { getWorkspaceData } from "@/app/lib/workspace/store";
import ChannelManager from "@/app/components/onboarding/channel-manager";
import PhoneCard from "@/app/components/onboarding/phone-card";

export const metadata: Metadata = { title: "Connect your accounts — Wax" };

export default async function ConnectPage() {
  const user = await requireUser();
  const data = await getWorkspaceData(user.workspaceId);

  return (
    <div className="min-h-screen bg-[#08090b] px-4 py-10 text-slate-200">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-sm font-bold text-white">
            w
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-white">Wax</p>
            <p className="text-[11px] text-slate-500">{user.workspaceName}</p>
          </div>
        </div>

        <h1 className="mt-8 text-2xl font-semibold tracking-tight text-white">
          Connect your accounts
        </h1>
        <p className="mt-1.5 text-sm text-slate-400">
          Verify the mobile number used for calls, then link the social accounts
          this workspace should answer from. You can change all of this later in
          settings.
        </p>

        <div className="mt-6 divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
          <PhoneCard phone={user.phone} verified={user.phoneVerified} />
          <ChannelManager
            channels={data.channels}
            connections={data.connections}
            canManage={user.role !== "agent"}
          />
        </div>

        <div className="mt-6 flex items-center justify-between gap-4">
          <Link
            href="/settings"
            className="text-xs text-slate-400 transition-colors hover:text-white"
          >
            Manage later in settings
          </Link>
          <Link
            href="/inbox"
            className="rounded-xl bg-gradient-to-r from-indigo-500 via-purple-500 to-fuchsia-500 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-indigo-500/20 transition-opacity hover:opacity-95"
          >
            Go to the desk
          </Link>
        </div>
      </div>
    </div>
  );
}

// These routes read the session and the database on every request, so they
// intentionally block instead of producing a static shell.
export const instant = false;
