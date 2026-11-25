import type { ReactNode } from "react";
import type {
  Channel,
  ChannelId,
  Contact,
  ContactIdentity,
  Conversation,
} from "@/app/lib/types";
import {
  ChannelTile,
  ContactAvatar,
} from "@/app/components/shared/ui";
import {
  ChevronDownIcon,
  ClockIcon,
  LayersIcon,
  MailIcon,
  UsersIcon,
} from "@/app/components/shared/icons";

const statusStyles: Record<
  Conversation["status"],
  { label: string; dot: string; pill: string }
> = {
  open: {
    label: "Open",
    dot: "bg-emerald-400",
    pill: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  },
  pending: {
    label: "Waiting on customer",
    dot: "bg-amber-400",
    pill: "border-amber-400/25 bg-amber-400/10 text-amber-300",
  },
  resolved: {
    label: "Resolved",
    dot: "bg-slate-500",
    pill: "border-fg/10 bg-fg/5 text-slate-400",
  },
};

const slaStyles: Record<"due" | "breached" | "met", string> = {
  due: "text-sky-300",
  breached: "text-rose-300",
  met: "text-emerald-300",
};

/** A collapsible band, like the INFORMATION / ATTACHMENTS groups in the mockup. */
function Section({
  title,
  children,
  open = false,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details open={open} className="group border-t border-fg/[0.06]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 bg-fg/[0.035] px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
          {title}
        </span>
        <ChevronDownIcon className="h-3.5 w-3.5 text-slate-500 transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-4 py-3">{children}</div>
    </details>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span className="mt-0.5 shrink-0 text-slate-500">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] text-slate-500">{label}</p>
        <p className="mt-0.5 break-words text-[12px] leading-snug text-slate-200">
          {value}
        </p>
      </div>
    </div>
  );
}

/**
 * The right column of the desk while a conversation is open: who the customer
 * is, every address they reach us from, and where this thread sits in the queue.
 */
export default function ContactRail({
  contact,
  conversation,
  identities,
  channelMap,
}: {
  contact: Contact;
  conversation: Conversation;
  identities: ContactIdentity[];
  channelMap: Record<ChannelId, Channel>;
}) {
  const status = statusStyles[conversation.status];

  return (
    <aside className="hidden space-y-4 xl:block">
      <div className="wax-panel overflow-hidden">
        <div className="flex flex-col items-center px-5 pt-7 pb-5 text-center">
          <ContactAvatar seed={contact.id} size="lg" />
          <p className="mt-3.5 flex items-center gap-1.5 text-sm font-semibold tracking-tight text-fg">
            {contact.name}
            {contact.demo && (
              <span
                title="Seeded showroom contact, not a real customer"
                className="rounded-full border border-violet-400/25 bg-violet-400/10 px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-violet-200 uppercase"
              >
                Demo
              </span>
            )}
            <span
              className={`h-2 w-2 rounded-full ${status.dot}`}
              title={status.label}
            />
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {contact.company || "No company on file"}
          </p>
          <span
            className={`mt-3 rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${status.pill}`}
          >
            {status.label}
          </span>
        </div>

        <Section title="Information" open>
          <Row
            icon={<MailIcon className="h-4 w-4" />}
            label="Handle"
            value={contact.handle}
          />
          <Row
            icon={<UsersIcon className="h-4 w-4" />}
            label="Company"
            value={contact.company || "Not set"}
          />
          {identities.length === 0 ? (
            <p className="mt-1 text-[11px] text-slate-500">
              No channel address linked yet.
            </p>
          ) : (
            identities.map((identity) => {
              const channel = channelMap[identity.channel];
              return (
                <div
                  key={identity.id}
                  className="flex items-center gap-2.5 py-1.5"
                >
                  <ChannelTile
                    channel={channel}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <p className="text-[10px] text-slate-500">
                      {channel.name}
                    </p>
                    <p className="truncate text-[12px] text-slate-200">
                      {identity.address}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </Section>

        <Section title="Conversation" open>
          <Row
            icon={<UsersIcon className="h-4 w-4" />}
            label="Assigned to"
            value={conversation.assigneeName ?? "Unassigned"}
          />
          <Row
            icon={<LayersIcon className="h-4 w-4" />}
            label="Queue"
            value={
              conversation.queueName ? (
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{
                      backgroundColor: conversation.queueColor ?? "#94a3b8",
                    }}
                  />
                  {conversation.queueName}
                </span>
              ) : (
                "No queue"
              )
            }
          />
          {conversation.sla && (
            <Row
              icon={<ClockIcon className="h-4 w-4" />}
              label="First reply"
              value={
                <span className={slaStyles[conversation.sla.state]}>
                  {conversation.sla.label}
                </span>
              }
            />
          )}
          <Row
            icon={<LayersIcon className="h-4 w-4" />}
            label="Unread"
            value={conversation.unread > 0 ? `${conversation.unread} new` : "All read"}
          />
        </Section>
      </div>
    </aside>
  );
}
