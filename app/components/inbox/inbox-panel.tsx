"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { startRoomAction } from "@/app/lib/rooms/actions";
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
  ContactAvatar,
  activeChipClass,
  chipClass,
  iconButtonClass,
  idleChipClass,
} from "@/app/components/shared/ui";
import {
  FilterIcon,
  PhoneIcon,
  SearchIcon,
  SendIcon,
  VideoIcon,
} from "@/app/components/shared/icons";

const statusStyles: Record<Conversation["status"], string> = {
  open: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  pending: "border-amber-400/25 bg-amber-400/10 text-amber-300",
  resolved: "border-fg/10 bg-fg/5 text-slate-400",
};

const slaStyles: Record<"due" | "breached" | "met", string> = {
  due: "border-sky-400/25 bg-sky-400/10 text-sky-300",
  breached: "border-rose-400/25 bg-rose-400/10 text-rose-300",
  met: "border-fg/10 bg-fg/5 text-slate-400",
};

const statusDot: Record<Conversation["status"], string> = {
  open: "bg-emerald-400",
  pending: "bg-amber-400",
  resolved: "bg-slate-500",
};

const selectClass =
  "cursor-pointer rounded-md border border-fg/[0.08] bg-fg/[0.04] px-1.5 py-0.5 text-[11px] text-slate-200 focus:outline-none";

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
  onExportContact: () => void;
  onDeleteContact: () => void;
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
  onRetry: (messageId: string) => void;
  retrying: string | null;
  noteMode: boolean;
  onNoteModeChange: (value: boolean) => void;
  agents: Agent[];
  queues: Queue[];
  onAssign: (conversationId: string, userId: string) => void;
  onMoveQueue: (conversationId: string, queueId: string) => void;
  onStatusChange: (
    conversationId: string,
    status: Conversation["status"],
  ) => void;
  workflowError: string | null;
  currentUserId: string;
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
  onExportContact,
  onDeleteContact,
  onSelect,
  draft,
  onDraftChange,
  onSend,
  onSendTemplate,
  sending,
  sendError,
  onRetry,
  retrying,
  noteMode,
  onNoteModeChange,
  agents,
  queues,
  onAssign,
  onMoveQueue,
  onStatusChange,
  workflowError,
  currentUserId,
}: InboxPanelProps) {
  const activeChannel = channelMap[active.channel];
  const threadCount = conversations.filter(
    (conversation) => conversation.contact.id === active.contact.id,
  ).length;
  const mergeCandidates = contacts.filter(
    (contact) => contact.id !== active.contact.id,
  );

  const [unreadOnly, setUnreadOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<
    "all" | "unassigned" | "mine" | "breaching"
  >("all");
  const [templateName, setTemplateName] = useState("");
  const [templateLanguage, setTemplateLanguage] = useState("en_US");
  const [templateParams, setTemplateParams] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const visible = conversations
    .filter((conversation) => {
      if (view === "unassigned") return !conversation.assigneeId;
      if (view === "mine") return conversation.assigneeId === currentUserId;
      if (view === "breaching") return conversation.sla?.state === "breached";
      return true;
    })
    .filter((conversation) => (unreadOnly ? conversation.unread > 0 : true))
    .filter((conversation) => {
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      const last = threads[conversation.id].at(-1)?.text ?? "";
      return `${conversation.contact.name} ${conversation.contact.handle} ${conversation.topic} ${last}`
        .toLowerCase()
        .includes(needle);
    });

  // The clock is read after mount (and once a minute) so rendering stays pure
  // and hydration sees the same markup on both sides.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, [active.id]);

  // Desk triage without the mouse: move through the filtered queue, resolve,
  // claim, switch between reply and note, and jump to the filter. It is bound to
  // the window so it works after the person clicks anywhere in the panel, and
  // it stays out of the way while a field has focus.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = Boolean(
        target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable),
      );

      if (typing) {
        if (event.key === "Escape") target?.blur();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const index = visible.findIndex(
        (conversation) => conversation.id === active.id,
      );

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        const next = visible[Math.min(index + 1, visible.length - 1)];
        if (next) onSelect(next.id);
        return;
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        const previous = visible[Math.max(index - 1, 0)];
        if (previous) onSelect(previous.id);
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === "e") {
        event.preventDefault();
        onStatusChange(active.id, "resolved");
        return;
      }
      if (event.key === "a") {
        event.preventDefault();
        onAssign(active.id, currentUserId);
        return;
      }
      if (event.key === "n") {
        event.preventDefault();
        onNoteModeChange(!noteMode);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    active.id,
    currentUserId,
    noteMode,
    onAssign,
    onNoteModeChange,
    onSelect,
    onStatusChange,
    visible,
  ]);

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
      <div className="border-b border-fg/[0.06] bg-fg/[0.012] lg:border-r lg:border-b-0">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-fg/[0.06] px-3 py-2.5">
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
            onClick={() => setUnreadOnly((value) => !value)}
            aria-label="Show unread only"
            aria-pressed={unreadOnly}
            title={unreadOnly ? "Showing unread only" : "Show unread only"}
            className={`ml-auto rounded-md p-1 ${
              unreadOnly
                ? "bg-indigo-500/20 text-indigo-200"
                : "text-slate-500 hover:text-slate-200"
            }`}
          >
            <FilterIcon className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="px-3 pt-2.5 pb-1">
          <label className="flex items-center gap-2 rounded-full border border-fg/[0.09] bg-fg/[0.03] px-3 py-1.5 transition-colors focus-within:border-indigo-400/40">
            <SearchIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search contacts…"
              aria-label="Search contacts"
              className="w-full bg-transparent text-[12px] text-slate-200 placeholder:text-slate-500 focus:outline-none"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-1 px-3 py-2">
          {(
            [
              ["all", "All"],
              ["unassigned", "Unassigned"],
              ["mine", "Mine"],
              ["breaching", "Breaching"],
            ] as const
          ).map(([id, label]) => {
            const total =
              id === "all"
                ? conversations.length
                : id === "unassigned"
                  ? conversations.filter((item) => !item.assigneeId).length
                  : id === "mine"
                    ? conversations.filter((item) => item.assigneeId === currentUserId)
                        .length
                    : conversations.filter((item) => item.sla?.state === "breached")
                        .length;
            const selected = view === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setView(id);
                  window.history.replaceState(null, "", `?view=${id}`);
                }}
                aria-pressed={selected}
                className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                  selected
                    ? "border-indigo-400/25 bg-indigo-500/15 text-indigo-100"
                    : "border-fg/[0.06] bg-fg/[0.01] text-slate-500 hover:border-fg/[0.1] hover:text-slate-300"
                }`}
              >
                {label}
                <span className="ml-1 text-slate-500">{total}</span>
              </button>
            );
          })}
        </div>

        <p className="px-3.5 pb-2 text-[9.5px] tracking-wide text-slate-600">
          j/k move · e resolve · a claim · n note · / search
        </p>

        <ul className="max-h-[42vh] divide-y divide-fg/[0.04] overflow-y-auto lg:max-h-[540px]">
          {visible.length === 0 && (
            <li className="px-4 py-10 text-center text-xs text-slate-500">
              {unreadOnly
                ? "No unread conversations in this filter."
                : "No conversations match this filter."}
            </li>
          )}
          {visible.map((conversation) => {
            const channel = channelMap[conversation.channel];
            const isActive = conversation.id === active.id;
            const last = threads[conversation.id].at(-1);
            const preview = last
              ? `${last.author === "agent" ? "You: " : ""}${last.text}`
              : conversation.topic;
            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  className={`flex w-full gap-3 px-3.5 py-3 text-left transition-colors ${
                    isActive
                      ? "bg-indigo-500/[0.09] shadow-[inset_2px_0_0_0_rgba(129,140,248,0.85)]"
                      : "hover:bg-fg/[0.03]"
                  }`}
                >
                  <span className="relative shrink-0">
                    <ContactAvatar seed={conversation.contact.id} />
                    <span
                      className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--wax-base)] ${statusDot[conversation.status]}`}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-[12.5px] font-semibold text-fg">
                        {conversation.contact.name}
                      </span>
                      {conversation.contact.demo && (
                        <span className="shrink-0 rounded-full border border-violet-400/25 bg-violet-400/10 px-1 text-[8.5px] font-medium tracking-wide text-violet-200 uppercase">
                          Demo
                        </span>
                      )}
                      <span className="ml-auto shrink-0 text-[10px] text-slate-500">
                        {conversation.lastAt}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      <span
                        aria-label={channel.name}
                        title={channel.name}
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: channel.color }}
                      />
                      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
                        {preview}
                      </span>
                      {conversation.unread > 0 && (
                        <span className="wax-pop flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-indigo-500 px-1 text-[10px] font-semibold text-white">
                          {conversation.unread}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex min-h-[560px] flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-fg/[0.06] px-4 py-3">
          <span className="relative shrink-0">
            <ContactAvatar seed={active.contact.id} size="sm" />
            <span
              className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--wax-base)] ${statusDot[active.status]}`}
            />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-fg">
              {active.contact.name}
              {active.contact.demo && (
                <span className="rounded-full border border-violet-400/25 bg-violet-400/10 px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-violet-200 uppercase">
                  Demo
                </span>
              )}
            </p>
            <p className="truncate text-[11px] text-slate-500">
              {active.status === "open" ? (
                <span className="text-emerald-300">online</span>
              ) : (
                <span className="capitalize">{active.status}</span>
              )}
              {" · "}
              {activeChannel.name}
              {active.contact.company ? ` · ${active.contact.company}` : ""}
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
            <Link
              href="/calls"
              aria-label="Open the call queue"
              title="Answering needs a phone channel — connect one in settings"
              className={iconButtonClass}
            >
              <PhoneIcon className="h-3.5 w-3.5" />
            </Link>
            <form action={startRoomAction}>
              <input
                type="hidden"
                name="name"
                value={`Room with ${active.contact.name}`}
              />
              <button
                type="submit"
                aria-label="Start a video room with this contact"
                title="Open a browser-to-browser room for this contact"
                className={iconButtonClass}
              >
                <VideoIcon className="h-3.5 w-3.5" />
              </button>
            </form>
            <button
              type="button"
              onClick={onExportContact}
              title="Download everything stored about this contact"
              className="rounded-md border border-fg/[0.08] px-2 py-1 text-[10px] text-slate-400 transition-colors hover:text-fg"
            >
              Export
            </button>
            <button
              type="button"
              onClick={onDeleteContact}
              title="Delete this contact and its history"
              className="rounded-md border border-rose-400/25 px-2 py-1 text-[10px] text-rose-300/90 transition-colors hover:bg-rose-500/10"
            >
              Delete
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

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-fg/[0.06] px-4 py-2 text-[11px] text-slate-500">
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

        <div className="wax-stagger flex-1 space-y-3.5 overflow-y-auto px-4 py-5">
          <div className="flex items-center gap-2">
            <span className="h-px flex-1 bg-fg/[0.06]" />
            <span className="text-[10px] tracking-[0.12em] text-slate-600 uppercase">
              Today · {activeChannel.name}
            </span>
            <span className="h-px flex-1 bg-fg/[0.06]" />
          </div>
          {activeMessages.map((message) => {
            const mine = message.author === "agent";
            return (
              <div
                key={message.id}
                className={`flex gap-2.5 ${mine ? "flex-row-reverse" : ""}`}
              >
                <div className={`max-w-[76%] ${mine ? "ml-auto text-right" : ""}`}>
                  <div
                    className={`rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                      message.internal
                        ? "rounded-br-sm border border-amber-400/25 bg-amber-400/[0.08] text-amber-100"
                        : mine
                          ? "rounded-br-sm bg-[var(--wax-bubble-out)] text-fg shadow-[inset_0_0_0_1px_rgba(16,185,129,0.14)]"
                          : "rounded-bl-sm border border-fg/[0.07] bg-fg/[0.045] text-slate-100"
                    }`}
                  >
                    {message.internal && (
                      <span className="mb-1 block text-[9px] font-semibold tracking-[0.12em] text-amber-300/80 uppercase">
                        Internal note · not sent to the customer
                      </span>
                    )}
                    {message.text}
                  </div>
                  <p className="mt-1 text-[10px] text-slate-600">
                    {message.time} · {channelMap[message.channel]?.name ?? "Channel"}{" "}
                    {message.internal ? (
                      "Team only"
                    ) : !mine ? (
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
                  {mine && !message.internal && message.status === "failed" && (
                    <button
                      type="button"
                      onClick={() => onRetry(message.id)}
                      disabled={retrying === message.id}
                      className="mt-1 rounded-md border border-rose-400/30 px-2 py-0.5 text-[10px] text-rose-200 hover:bg-rose-500/10 disabled:opacity-60"
                    >
                      {retrying === message.id
                        ? "Retrying…"
                        : message.retryCount
                          ? `Retry · attempt ${message.retryCount + 1}`
                          : "Retry"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {active.channel === "x" && activeChannel.inboundNote && (
          <p
            role="note"
            className="border-t border-fg/[0.06] bg-amber-400/[0.06] px-4 py-2.5 text-[11px] leading-relaxed text-amber-200/90"
          >
            <span className="font-semibold">Replies only.</span>{" "}
            {activeChannel.inboundNote}
          </p>
        )}

        {windowClosed && !noteMode && active.channel === "whatsapp" ? (
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
            className="border-t border-fg/[0.06] px-4 py-3"
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
            <div className="mt-2 grid gap-2 rounded-xl border border-fg/[0.08] bg-fg/[0.03] p-3 sm:grid-cols-[1fr_120px] lg:grid-cols-[1fr_110px_140px]">
              <input
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                placeholder="Template name"
                aria-label="Template name"
                className="rounded-lg border border-fg/[0.08] bg-black/20 px-2.5 py-1.5 text-[12px] text-slate-100 placeholder:text-slate-500 focus:border-indigo-500/40 focus:outline-none"
              />
              <input
                value={templateLanguage}
                onChange={(event) => setTemplateLanguage(event.target.value)}
                placeholder="en_US"
                aria-label="Template language"
                className="rounded-lg border border-fg/[0.08] bg-black/20 px-2.5 py-1.5 font-mono text-[12px] text-slate-100 placeholder:text-slate-500 focus:border-indigo-500/40 focus:outline-none"
              />
              <input
                value={templateParams}
                onChange={(event) => setTemplateParams(event.target.value)}
                placeholder="Body values, comma separated"
                aria-label="Template body values"
                className="rounded-lg border border-fg/[0.08] bg-black/20 px-2.5 py-1.5 text-[12px] text-slate-100 placeholder:text-slate-500 focus:border-indigo-500/40 focus:outline-none sm:col-span-2 lg:col-span-1"
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
          <form
            onSubmit={onSend}
            className="sticky bottom-0 z-10 border-t border-fg/[0.06] bg-[var(--wax-ink)]/95 px-4 py-3 backdrop-blur"
          >
            <div className="flex items-center gap-2 rounded-full border border-fg/[0.09] bg-fg/[0.03] py-1.5 pr-1.5 pl-2 transition-colors focus-within:border-indigo-400/40">
              <button
                type="button"
                onClick={() => onNoteModeChange(!noteMode)}
                aria-pressed={noteMode}
                title="Write an internal note the customer never sees"
                className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                  noteMode
                    ? "bg-amber-400/15 text-amber-200"
                    : "text-slate-500 hover:bg-fg/[0.05] hover:text-slate-300"
                }`}
              >
                Note
              </button>
              <input
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                placeholder={
                  noteMode
                    ? "Write a note for your team…"
                    : `Reply on ${activeChannel.name}…`
                }
                aria-label={noteMode ? "Internal note" : "Message"}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={sending}
                aria-label={noteMode ? "Save note" : "Send message"}
                title={noteMode ? "Save note" : "Send"}
                className={`wax-press grid h-8 w-8 shrink-0 place-items-center rounded-full text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  noteMode
                    ? "bg-amber-500 hover:bg-amber-400"
                    : "bg-indigo-500 hover:bg-indigo-400"
                }`}
              >
                <SendIcon className="h-4 w-4" />
              </button>
            </div>
            {windowClosed && !noteMode && (
              <p className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[10px] leading-relaxed text-amber-200">
                {active.channel === "instagram"
                  ? "Instagram only accepts free-form replies within 24 hours of the customer's last message. The provider may reject this reply."
                  : "The reply window for this conversation is closed."}
              </p>
            )}
            {!windowClosed && !noteMode && windowHoursLeft !== null && (
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
