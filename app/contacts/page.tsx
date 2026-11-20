import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/app/lib/auth/auth";
import { getWorkspaceData } from "@/app/lib/workspace/store";
import { Avatar, ChannelTile, initials } from "@/app/components/shared/ui";

export const metadata: Metadata = { title: "Contacts — Wax" };

// Reads the session and the database on every request.
export const instant = false;

export default async function ContactsPage() {
  const user = await requireUser();
  const data = await getWorkspaceData(user.workspaceId);

  return (
    <div className="min-h-screen bg-[#08090b] px-4 py-10 text-slate-200">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] text-slate-500">{user.workspaceName}</p>
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              Contacts
            </h1>
          </div>
          <Link
            href="/inbox"
            className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-xs font-medium text-slate-300 transition-colors hover:text-white"
          >
            Back to inbox
          </Link>
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
          {data.contacts.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-sm font-medium text-slate-200">No contacts yet</p>
              <p className="mx-auto mt-1.5 max-w-sm text-[11px] leading-relaxed text-slate-500">
                A contact is created automatically the first time someone messages
                a connected channel — one person, one timeline across channels.
              </p>
              <Link
                href="/connect"
                className="mt-4 inline-flex rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-2 text-[11px] font-medium text-indigo-200 transition-colors hover:bg-indigo-500/20"
              >
                Connect a channel
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.04]">
              {data.contacts.map((contact) => (
                <li
                  key={contact.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <Avatar
                    initials={initials(contact.name)}
                    color={contact.color}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-white">
                      {contact.name}
                    </p>
                    <p className="truncate text-[11px] text-slate-500">
                      {contact.company || contact.handle}
                    </p>
                  </div>
                  <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    {contact.identities.map((identity) => {
                      const channel = data.channels.find(
                        (item) => item.id === identity.channel,
                      );
                      return (
                        <span
                          key={identity.id}
                          className="flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.03] px-2 py-0.5 text-[10px] text-slate-300"
                        >
                          {channel && (
                            <ChannelTile channel={channel} size="sm" />
                          )}
                          {identity.address}
                        </span>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
