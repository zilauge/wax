"use client";

import { useEffect, useState } from "react";
import type {
  Agent,
  Channel,
  ChannelId,
  ContactIdentity,
  Conversation,
  Message,
  Queue,
  WorkspaceContact,
} from "@/app/lib/types";
import ContactIdentityStrip from "@/app/components/inbox/contact-identity-strip";
import {
  ChannelTile,
  Avatar,
  activeChipClass,
  chipClass,
  iconButtonClass,
  idleChipClass,
  initials,
} from "@/app/components/shared/ui";
import {
  FilterIcon,
  MicIcon,
  MoreIcon,
  PaperclipIcon,
  PhoneIcon,
  SendIcon,
  SmileIcon,
  VideoIcon,
} from "@/app/components/shared/icons";

const statusStyles: Record<Conversation["status"], string> = {
  open: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  pending: "border-amber-400/25 bg-amber-400/10 text-amber-300",
  resolved: "border-white/10 bg-white/5 text-slate-400",
};

const slaStyles: Record<"due" | "breached" | "met", string> = {
  due: "border-sky-400/25 bg-sky-400/10 text-sky-300",
  breached: "border-rose-400/25 bg-rose-400/10 text-rose-300",
  met: "border-white/10 bg-white/5 text-slate-400",
};

const selectClass =
  "cursor-pointer rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-slate-200 focus:outline-none";

type InboxPanelProps = {
  channels: Channel[];
  conversations: Conversation[];
  channelMap: Record<ChannelId, Channel>;
  channelFilter: ChannelId | "all";
  onChannelFilter: (value: ChannelId | "all") => void;
  active: Conversation;
  activeMessages: Message[];
  threads: Record<string, Message[]>;
  contacts: WorkspaceContact[];
  identities: ContactIdentity[];
  identityBusy: boolean;
  onLinkIdentity: (channel: ChannelId, address: string) => void;
  onUnlinkIdentity: (identityId: string) => void;
  onMergeContact: (targetContactId: string) => void;
  onSelect: (id: string) => void;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (event: React.FormEvent) => void;
  onSendTemplate: (input: {
    name: string;
    language: string;
    params: string[];
  }) => void;
  sending: boolean;
  sendError: string | null;
  agents: Agent[];
  queues: Queue[];
  onAssign: (conversationId: string, userId: string) => void;
  onMoveQueue: (conversationId: string, queueId: string) => void;
  onStatusChange: (
    conversationId: string,
    status: Conversation["status"],
  ) => void;
  workflowError: string | null;
};

export default function InboxPanel({
  channels,
  conversations,
  channelMap,
  channelFilter,
  onChannelFilter,
  active,
  activeMessages,
  threads,
  contacts,
  identities,
  identityBusy,
  onLinkIdentity,
  onUnlinkIdentity,
  onMergeContact,
  onSelect,
  draft,
  onDraftChange,
  onSend,
  onSendTemplate,
  sending,
  sendError,
  agents,
  queues,
  onAssign,
  onMoveQueue,
  onStatusChange,
  workflowError,
}: InboxPanelProps) {
  const activeChannel = channelMap[active.channel];
  const contactInitials = initials(active.contact.name);
  const threadCount = conversations.filter(
    (conversation) => conversation.contact.id === active.contact.id,
  ).length;
  const mergeCandidates = contacts.filter(
    (contact) => contact.id !== active.contact.id,
  );

  const [templateName, setTemplateName] = useState("");
  const [templateLanguage, setTemplateLanguage] = useState("en_US");
  const [templateParams, setTemplateParams] = useState("");

  // The clock is read after mount (and once a minute) so rendering stays pure
  // and hydration sees the same markup on both sides.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, [active.id]);

  const windowClosed =
    now !== null &&
    active.replyWindowEndsAt !== null &&
    active.replyWindowEndsAt <= now;
  const windowHoursLeft =
    now === null || active.replyWindowEndsAt === null
      ? null
      : Math.max(0, Math.ceil((active.replyWindowEndsAt - now) / 3_600_000));

  return (
    <div className="grid lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="border-b border-white/[0.06] lg:border-r lg:border-b-0">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.06] px-3 py-2.5">
          <button
            type="button"
            onClick={() => onChannelFilter("all")}
            className={`${chipClass} ${
              channelFilter === "all" ? activeChipClass : idleChipClass
            }`}
          >
            All
          </button>
          {channels.map((channel) => (
            <button
              key={channel.id}
              type="button"
              onClick={() => onChannelFilter(channel.id)}
              className={`${chipClass} ${
                channelFilter === channel.id ? activeChipClass : idleChipClass
              }`}
            >
              <span
                className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
                style={{ backgroundColor: channel.color }}
              />
              {channel.name}
            </button>
          ))}
          <button
            type="button"
            aria-label="Filter conversations"
            className="ml-auto rounded-md p-1 text-slate-500 hover:text-slate-200"
          >
            <FilterIcon className="h-3.5 w-3.5" />
          </button>
        </div>

        <ul className="max-h-[540px] divide-y divide-white/[0.04] overflow-y-auto">
          {conversations.length === 0 && (
            <li className="px-4 py-10 text-center text-xs text-slate-500">
              No conversations match this filter.
            </li>
          )}
          {conversations.map((conversation) => {
            const channel = channelMap[conversation.channel];
            const isActive = conversation.id === active.id;
            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  className={`flex w-full gap-3 px-3 py-3 text-left transition-colors ${
                    isActive ? "bg-indigo-500/[0.09]" : "hover:bg-white/[0.03]"
                  }`}
                >
                  <span className="relative">
                    <Avatar
                      initials={initials(conversation.contact.name)}
                      color={conversation.contact.color}
                    />
                    <span className="absolute -right-1 -bottom-1 rounded-md bg-[#0d0e12] p-0.5">
                      <ChannelTile channel={channel} size="sm" />
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-medium text-white">
                        {conversation.contact.name}
                      </span>
                      <span className="ml-auto shrink-0 text-[10px] text-slate-500">
                        {conversation.lastAt}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                      {conversation.topic}
                    </span>
                    <span className="mt-1 flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
                        {threads[conversation.id].at(-1)?.text}
                      </span>
                      {conversation.unread > 0 && (
                        <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-indigo-500 px-1 text-[10px] font-semibold text-white">
                          {conversation.unread}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-[10px] text-slate-600">
                      {channel.name} · {conversation.assigneeName ?? "Unassigned"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex min-h-[560px] flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] px-4 py-3">
          <Avatar
            initials={contactInitials}
            color={active.contact.color}
            size="sm"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">
              {active.contact.name}
            </p>
            <p className="truncate text-[11px] text-slate-500">
              {active.contact.handle} · {active.contact.company}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <select
              value={active.status}
              onChange={(event) =>
                onStatusChange(
                  active.id,
                  event.target.value as Conversation["status"],
                )
              }
              aria-label="Conversation status"
              className={`cursor-pointer appearance-none rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize focus:outline-none ${statusStyles[active.status]}`}
            >
              <option value="open">Open</option>
              <option value="pending">Pending</option>
              <option value="resolved">Resolved</option>
            </select>
            <button
              type="button"
              aria-label="Start a call"
              className={iconButtonClass}
            >
              <PhoneIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Start a video meeting"
              className={iconButtonClass}
            >
              <VideoIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="More actions"
              className={iconButtonClass}
            >
              <MoreIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <ContactIdentityStrip
          identities={identities}
          channels={channels}
          mergeCandidates={mergeCandidates}
          threadCount={threadCount}
          busy={identityBusy}
          error={workflowError}
          onLink={onLinkIdentity}
          onUnlink={onUnlinkIdentity}
          onMerge={onMergeContact}
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/[0.06] px-4 py-2 text-[11px] text-slate-500">
          <label className="flex items-center gap-1.5">
            Queue
            <select
              value={active.queueId ?? ""}
              onChange={(event) => onMoveQueue(active.id, event.target.value)}
              disabled={!active.queueId}
              aria-label="Queue"
              className={selectClass}
            >
              {queues.map((queue) => (
                <option key={queue.id} value={queue.id}>
                  {queue.name} · {queue.slaMinutes}m SLA
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5">
            Assigned to
            <select
              value={active.assigneeId ?? ""}
              onChange={(event) => onAssign(active.id, event.target.value)}
              aria-label="Assignee"
              className={selectClass}
            >
              <option value="">Unassigned</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>

          {active.sla && (
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${slaStyles[active.sla.state]}`}
            >
              {active.sla.label}
            </span>
          )}

          {workflowError && (
            <span className="text-[10px] text-rose-400">{workflowError}</span>
          )}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
          <div className="flex items-center gap-2">
            <span className="h-px flex-1 bg-white/[0.06]" />
            <span className="text-[10px] tracking-[0.12em] text-slate-600 uppercase">
              Today · {activeChannel.name}
            </span>
            <span className="h-px flex-1 bg-white/[0.06]" />
          </div>
          {activeMessages.map((message) => {
            const mine = message.author === "agent";
            return (
              <div
                key={message.id}
                className={`flex gap-2.5 ${mine ? "flex-row-reverse" : ""}`}
              >
                {!mine && (
                  <Avatar
                    initials={contactInitials}
                    color={active.contact.color}
                    size="xs"
                  />
                )}
                <div className={`max-w-[76%] ${mine ? "text-right" : ""}`}>
                  <div
                    className={`rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                      mine
                        ? "rounded-br-md bg-indigo-500/90 text-white"
                        : "rounded-bl-md border border-white/[0.06] bg-white/[0.04] text-slate-200"
                    }`}
                  >
                    {message.text}
                  </div>
                  <p className="mt-1 text-[10px] text-slate-600">
                    {message.time} · {channelMap[message.channel]?.name ?? "Channel"}{" "}
                    {!mine ? (
                      "DM"
                    ) : message.status === "failed" ? (
                      <span className="text-rose-400">
                        Not delivered
                        {message.error ? ` · ${message.error}` : ""}
                      </span>
                    ) : message.status === "read" ? (
                      "Read"
                    ) : message.status === "delivered" ? (
                      "Delivered"
                    ) : (
                      "Sent"
                    )}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {active.channel === "x" && activeChannel.inboundNote && (
          <p
            role="note"
            className="border-t border-white/[0.06] bg-amber-400/[0.06] px-4 py-2.5 text-[11px] leading-relaxed text-amber-200/90"
          >
            <span className="font-semibold">Replies only.</span>{" "}
            {activeChannel.inboundNote}
          </p>
        )}

        {windowClosed && active.channel === "whatsapp" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!templateName.trim() || sending) return;
              onSendTemplate({
                name: templateName,
                language: templateLanguage,
                params: templateParams.split(","),
              });
            }}
            className="border-t border-white/[0.06] px-4 py-3"
          >
            <p className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
              WhatsApp&apos;s 24-hour reply window closed{" "}
              {active.replyWindowEndsAt
                ? new Date(active.replyWindowEndsAt).toLocaleString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "earlier"}
              . Only an approved template can be sent now.
            </p>
            <div className="mt-2 grid gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 sm:grid-cols-[1fr_120px] lg:grid-cols-[1fr_110px_140px]">
              <input
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                placeholder="Template name"
                aria-label="Template name"
                className="rounded-lg border border-white/[0.08] bg-black/20 px-2.5 py-1.5 text-[12px] text-slate-100 placeholder:text-slate-500 focus:border-indigo-500/40 focus:outline-none"
              />
              <input
                value={templateLanguage}
                onChange={(event) => setTemplateLanguage(event.target.value)}
                placeholder="en_US"
                aria-label="Template language"
                className="rounded-lg border border-white/[0.08] bg-black/20 px-2.5 py-1.5 font-mono text-[12px] text-slate-100 placeholder:text-slate-500 focus:border-indigo-500/40 focus:outline-none"
              />
              <input
                value={templateParams}
                onChange={(event) => setTemplateParams(event.target.value)}
                placeholder="Body values, comma separated"
                aria-label="Template body values"
                className="rounded-lg border border-white/[0.08] bg-black/20 px-2.5 py-1.5 text-[12px] text-slate-100 placeholder:text-slate-500 focus:border-indigo-500/40 focus:outline-none sm:col-span-2 lg:col-span-1"
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-[10px] text-slate-500">
                The name and language must match the template approved in Meta
                Business Manager.
              </p>
              <button
                type="submit"
                disabled={sending || !templateName.trim()}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sending ? "Sending…" : "Send template"}
                <SendIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            {sendError && (
              <p
                role="alert"
                className="mt-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300"
              >
                {sendError}
              </p>
            )}
          </form>
        ) : (
          <form onSubmit={onSend} className="border-t border-white/[0.06] px-4 py-3">
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 focus-within:border-indigo-500/40">
              <input
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                placeholder={`Reply on ${activeChannel.name}…`}
                className="w-full bg-transparent text-[13px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
              />
              <div className="mt-2 flex items-center gap-1">
                {[
                  { label: "Attach a file", Icon: PaperclipIcon },
                  { label: "Insert an emoji", Icon: SmileIcon },
                  { label: "Record a voice note", Icon: MicIcon },
                ].map(({ label, Icon }) => (
                  <button
                    key={label}
                    type="button"
                    aria-label={label}
                    className="rounded-md p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-200"
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                ))}
                <button
                  type="submit"
                  disabled={sending}
                  className="ml-auto flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {sending ? "Sending…" : "Send"}
                  <SendIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {windowClosed && (
              <p className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[10px] leading-relaxed text-amber-200">
                {active.channel === "instagram"
                  ? "Instagram only accepts free-form replies within 24 hours of the customer's last message. The provider may reject this reply."
                  : "The reply window for this conversation is closed."}
              </p>
            )}
            {!windowClosed && windowHoursLeft !== null && (
              <p className="mt-2 text-[10px] text-slate-500">
                Free-form replies close in about {windowHoursLeft}h; after that
                an approved template is required.
              </p>
            )}
            {sendError && (
              <p
                role="alert"
                className="mt-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300"
              >
                {sendError}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
