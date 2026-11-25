import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/app/lib/auth/auth";
import { getWorkspaceData } from "@/app/lib/workspace/store";
import ChannelManager from "@/app/components/onboarding/channel-manager";
import PhoneCard from "@/app/components/onboarding/phone-card";
import { BrandMark } from "@/app/components/shared/ui";

export const metadata: Metadata = { title: "Connect your accounts — Wax" };

export default async function ConnectPage() {
  const user = await requireUser();
  const data = await getWorkspaceData(user.workspaceId);

  return (
    <div className="wax-app min-h-screen px-4 py-10 text-slate-200">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <div className="leading-tight">
            <p className="text-sm font-semibold text-fg">Wax</p>
            <p className="text-[11px] text-slate-500">{user.workspaceName}</p>
          </div>
        </div>

        <p className="wax-eyebrow mt-9">Workspace setup</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">
          Connect your accounts
        </h1>
        <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-slate-400">
          Verify the mobile number used for calls, then link the social accounts
          this workspace should answer from. You can change all of this later in
          settings.
        </p>

        <div className="wax-panel wax-enter mt-6 overflow-hidden">
          <PhoneCard phone={user.phone} verified={user.phoneVerified} />
          <div className="border-t border-fg/[0.06]">
            <ChannelManager
              channels={data.channels}
              connections={data.connections}
              canManage={user.role !== "agent"}
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between gap-4">
          <Link
            href="/settings"
            className="text-xs text-slate-400 transition-colors hover:text-fg"
          >
            Manage later in settings
          </Link>
          <Link
            href="/inbox"
            className="wax-press wax-sheen inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-indigo-500 to-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_16px_34px_-20px_rgba(99,102,241,1)] transition-colors hover:from-indigo-400 hover:to-indigo-500"
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
