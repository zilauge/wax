import Link from "next/link";
import type { Channel, WorkspaceContact } from "@/app/lib/types";
import { ChannelTile, ContactAvatar } from "@/app/components/shared/ui";

/**
 * The contacts directory, rendered inside the desk shell so the sidebar stays
 * available. Each person is one row with every address they are reachable at:
 * phone numbers and social handles share the same timeline.
 */
export default function ContactsPanel({
  contacts,
  channels,
}: {
  contacts: WorkspaceContact[];
  channels: Channel[];
}) {
  const channelMap = new Map(channels.map((channel) => [channel.id, channel]));

  if (contacts.length === 0) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="text-sm font-medium text-slate-200">No contacts yet</p>
        <p className="mx-auto mt-1.5 max-w-sm text-[11px] leading-relaxed text-slate-500">
          A contact is created automatically the first time someone messages a
          connected channel — one person, one timeline across channels.
        </p>
        <Link
          href="/connect"
          className="mt-4 inline-flex rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-2 text-[11px] font-medium text-indigo-200 transition-colors hover:bg-indigo-500/20"
        >
          Connect a channel
        </Link>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-fg/[0.04]">
      {contacts.map((contact) => {
        const phone = contact.identities.filter(
          (identity) => identity.channel === "sms" || identity.channel === "whatsapp",
        );
        const socials = contact.identities.filter(
          (identity) => identity.channel !== "sms" && identity.channel !== "whatsapp",
        );

        return (
          <li key={contact.id}>
            <Link
              href={
                contact.threadId
                  ? `/inbox?conversation=${contact.threadId}`
                  : `/inbox?q=${encodeURIComponent(contact.name)}`
              }
              title={`Open ${contact.name}'s conversations`}
              className="flex flex-wrap items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-fg/[0.03]"
            >
              <ContactAvatar seed={contact.id} />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate text-[13px] font-semibold text-fg">
                  {contact.name}
                  {contact.demo && (
                    <span
                      title="Seeded showroom contact, not a real customer"
                      className="rounded-full border border-violet-400/25 bg-violet-400/10 px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-violet-200 uppercase"
                    >
                      Demo
                    </span>
                  )}
                </p>
                <p className="truncate text-[11px] text-slate-500">
                  {contact.company || contact.handle}
                </p>
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                {contact.identities.map((identity) => {
                  const channel = channelMap.get(identity.channel);
                  return (
                    <span
                      key={identity.id}
                      title={`${channel?.name ?? identity.channel} · ${identity.address}`}
                      className="flex items-center gap-1.5 rounded-full border border-fg/[0.07] bg-fg/[0.03] py-0.5 pr-2 pl-0.5 text-[10px] text-slate-300"
                    >
                      {channel && <ChannelTile channel={channel} size="sm" />}
                      {identity.address}
                    </span>
                  );
                })}
              </div>

              <div className="flex w-full items-center gap-2 text-[10px] text-slate-500 sm:w-auto">
                {phone.length > 0 && (
                  <span className="rounded-full border border-fg/[0.07] px-2 py-0.5">
                    {phone.length} phone {phone.length === 1 ? "number" : "numbers"}
                  </span>
                )}
                {socials.length > 0 && (
                  <span className="rounded-full border border-fg/[0.07] px-2 py-0.5">
                    {socials.length} social {socials.length === 1 ? "link" : "links"}
                  </span>
                )}
                <span className="ml-auto inline-flex items-center gap-1 font-medium text-indigo-300">
                  Chat
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
