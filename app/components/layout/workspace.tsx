"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  Channel,
  ChannelId,
  Conversation,
  Message,
  PresenceStatus,
  RealtimeEvent,
  WorkspaceData,
  WorkspaceUser,
} from "@/app/lib/types";
import { signOutAction } from "@/app/lib/auth/actions";
import {
  linkContactIdentityAction,
  mergeContactsAction,
  unlinkContactIdentityAction,
} from "@/app/lib/contacts/actions";
import {
  sendMessageAction,
  sendTemplateAction,
} from "@/app/lib/inbox/actions";
import {
  assignCallAction,
  assignConversationAction,
  moveCallToQueueAction,
  moveToQueueAction,
  setConversationStatusAction,
  setPresenceAction,
} from "@/app/lib/workspace/actions";
import {
  ArrowUpRightIcon,
  BellIcon,
  CalendarIcon,
  ChartIcon,
  CheckIcon,
  InboxIcon,
  MoreIcon,
  PhoneIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  UsersIcon,
  VideoIcon,
} from "@/app/components/shared/icons";
import { Avatar, ChannelTile, LiveDot, initials } from "@/app/components/shared/ui";
import type { TimeBlock, WeeklyHours } from "@/app/lib/calendar/rules";
import CalendarPanel from "@/app/components/calendar/calendar-panel";
import InboxPanel from "@/app/components/inbox/inbox-panel";
import CallsPanel from "@/app/components/calls/calls-panel";
import MeetingsPanel from "@/app/components/meetings/meetings-panel";
import RightRail from "@/app/components/layout/right-rail";
import SettingsPanel from "@/app/components/settings/settings-panel";

export type DeskTab = "inbox" | "calendar" | "calls" | "meetings" | "settings";
type TabId = DeskTab;

export type CalendarData = {
  blocks: TimeBlock[];
  hours: WeeklyHours;
  agents: { id: string; name: string }[];
  today: number;
  weekStart: number;
  weekLabel: string;
  prevWeek: string;
  nextWeek: string;
  thisWeek: string;
};

const tabs: { id: TabId; label: string; icon: typeof InboxIcon }[] = [
  { id: "inbox", label: "Inbox", icon: InboxIcon },
  { id: "calendar", label: "Calendar", icon: CalendarIcon },
  { id: "calls", label: "Calls", icon: PhoneIcon },
  { id: "meetings", label: "Meetings", icon: VideoIcon },
];

const presenceDot: Record<PresenceStatus, string> = {
  available: "bg-emerald-400",
  busy: "bg-amber-400",
  away: "bg-slate-500",
};

const secondaryNav: {
  label: string;
  icon: typeof UsersIcon;
  href: string;
  active?: TabId;
}[] = [
  { label: "Contacts", icon: UsersIcon, href: "/contacts" },
  { label: "Analytics", icon: ChartIcon, href: "/analytics" },
  { label: "Settings", icon: SettingsIcon, href: "/settings", active: "settings" },
];

function matchesFilters(
  conversation: Conversation,
  channel: ChannelId | "all",
  needle: string,
) {
  if (channel !== "all" && conversation.channel !== channel) return false;
  if (!needle) return true;

  return [
    conversation.contact.name,
    conversation.topic,
    conversation.contact.company,
  ].some((field) => field.toLowerCase().includes(needle));
}

export default function Workspace({
  data,
  user,
  tab,
  initialChannel = "all",
  notice = null,
  calendar = null,
}: {
  data: WorkspaceData;
  user: WorkspaceUser;
  tab: DeskTab;
  initialChannel?: ChannelId | "all";
  notice?: string | null;
  calendar?: CalendarData | null;
}) {
  const {
    channels,
    connections,
    conversations,
    contacts,
    calls,
    meetings,
    agents,
    queues,
    telegram,
    channelAudit,
    metrics,
    summary,
  } = data;
  const router = useRouter();

  const channelMap = useMemo(
    () =>
      Object.fromEntries(
        channels.map((channel) => [channel.id, channel]),
      ) as Record<ChannelId, Channel>,
    [channels],
  );

  const tabCounts: Record<TabId, number> = {
    inbox: summary.openConversations,
    calls: summary.callsInProgress,
    meetings: summary.meetingsToday,
    calendar: 0,
    settings: 0,
  };

  const [channelFilter, setChannelFilter] = useState<ChannelId | "all">(
    initialChannel,
  );
  const [selectedId, setSelectedId] = useState(conversations[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [optimistic, setOptimistic] = useState<Record<string, Message[]>>({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [activity, setActivity] = useState<RealtimeEvent[]>([]);
  const [bellOpen, setBellOpen] = useState(false);

  // Live channel: the server pushes messages, assignments, status changes and
  // SLA ticks, and every one refreshes the server-rendered dashboard. That is
  // what keeps the tab badges, the bell count and the SLA labels current
  // without a manual reload. Reconnection is handled by EventSource itself.
  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource("/api/events");

    const scheduleRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        router.refresh();
      }, 200);
    };

    source.onopen = () => setLive(true);
    source.onerror = () => setLive(false);
    source.onmessage = (message) => {
      let event: RealtimeEvent;
      try {
        event = JSON.parse(message.data) as RealtimeEvent;
      } catch {
        return;
      }

      if (event.kind === "ready") {
        setLive(true);
        return;
      }

      // Relative deadlines move with the clock, not only with writes.
      if (event.kind === "tick") {
        if (document.visibilityState === "visible") scheduleRefresh();
        return;
      }

      setActivity((previous) => [event, ...previous].slice(0, 12));
      scheduleRefresh();
    };

    return () => {
      source.close();
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [router]);

  const me = agents.find((agent) => agent.id === user.id);
  const [presence, setPresence] = useState<PresenceStatus>(
    me?.presence ?? "away",
  );

  // Server messages plus any reply still in flight; ids from the server win.
  const threads = useMemo(() => {
    const map: Record<string, Message[]> = {};
    for (const conversation of conversations) {
      const known = new Set(conversation.messages.map((message) => message.id));
      const pending = (optimistic[conversation.id] ?? []).filter(
        (message) => !known.has(message.id),
      );
      map[conversation.id] = [...conversation.messages, ...pending];
    }
    return map;
  }, [conversations, optimistic]);

  const needle = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      conversations.filter((conversation) =>
        matchesFilters(conversation, channelFilter, needle),
      ),
    [conversations, channelFilter, needle],
  );

  const active =
    conversations.find((conversation) => conversation.id === selectedId) ??
    conversations[0];
  const activeContact = active
    ? (contacts.find((contact) => contact.id === active.contact.id) ?? null)
    : null;

  // One customer history: every thread that belongs to the same contact, merged
  // chronologically and labelled with the channel each message came from.
  const customerHistory = useMemo(() => {
    if (!active) return [];
    const related = conversations.filter(
      (conversation) => conversation.contact.id === active.contact.id,
    );
    if (related.length <= 1) return threads[active.id] ?? [];
    return related
      .flatMap((conversation) => threads[conversation.id] ?? [])
      .sort((a, b) => a.at - b.at);
  }, [active, conversations, threads]);

  const totalUnread = channels.reduce((sum, channel) => sum + channel.unread, 0);

  function selectChannelFilter(next: ChannelId | "all") {
    setChannelFilter(next);
    const candidate = conversations.find((conversation) =>
      matchesFilters(conversation, next, needle),
    );
    if (candidate) setSelectedId(candidate.id);
  }

  async function changeAssignee(conversationId: string, userId: string) {
    setWorkflowError(null);
    const result = await assignConversationAction(
      conversationId,
      userId || null,
    );
    if (!result.ok) {
      setWorkflowError(result.error);
      return;
    }
    router.refresh();
  }

  async function changeQueue(conversationId: string, queueId: string) {
    setWorkflowError(null);
    const result = await moveToQueueAction(conversationId, queueId);
    if (!result.ok) {
      setWorkflowError(result.error);
      return;
    }
    router.refresh();
  }

  async function changeStatus(
    conversationId: string,
    status: Conversation["status"],
  ) {
    setWorkflowError(null);
    const result = await setConversationStatusAction(conversationId, status);
    if (!result.ok) {
      setWorkflowError(result.error);
      return;
    }
    router.refresh();
  }

  async function changePresence(status: PresenceStatus) {
    const previous = presence;
    setPresence(status);
    const result = await setPresenceAction(status);
    if (!result.ok) {
      setPresence(previous);
      setWorkflowError(result.error);
      return;
    }
    router.refresh();
  }

  async function linkIdentity(channel: ChannelId, address: string) {
    if (!activeContact) return;
    setWorkflowError(null);
    setIdentityBusy(true);
    const result = await linkContactIdentityAction(
      activeContact.id,
      channel,
      address,
    );
    setIdentityBusy(false);
    if (!result.ok) {
      setWorkflowError(result.error);
      return;
    }
    router.refresh();
  }

  async function unlinkIdentity(identityId: string) {
    setWorkflowError(null);
    setIdentityBusy(true);
    const result = await unlinkContactIdentityAction(identityId);
    setIdentityBusy(false);
    if (!result.ok) {
      setWorkflowError(result.error);
      return;
    }
    router.refresh();
  }

  async function mergeContact(targetContactId: string) {
    if (!activeContact) return;
    setWorkflowError(null);
    setIdentityBusy(true);
    const result = await mergeContactsAction(
      activeContact.id,
      targetContactId,
    );
    setIdentityBusy(false);
    if (!result.ok) {
      setWorkflowError(result.error);
      return;
    }
    router.refresh();
  }

  async function changeCallAssignee(callId: string, userId: string) {
    setWorkflowError(null);
    const result = await assignCallAction(callId, userId || null);
    if (!result.ok) {
      setWorkflowError(result.error);
      return;
    }
    router.refresh();
  }

  async function changeCallQueue(callId: string, queueId: string) {
    setWorkflowError(null);
    const result = await moveCallToQueueAction(callId, queueId);
    if (!result.ok) {
      setWorkflowError(result.error);
      return;
    }
    router.refresh();
  }

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !active || sending) return;

    setSending(true);
    setSendError(null);

    const nonce =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}`;
    const result = await sendMessageAction(active.id, text, nonce);
    setSending(false);

    if (!result.ok) {
      setSendError(result.error);
      return;
    }

    setOptimistic((previous) => ({
      ...previous,
      [active.id]: [...(previous[active.id] ?? []), result.message],
    }));
    setDraft("");
    router.refresh();
  }

  async function sendTemplate(input: {
    name: string;
    language: string;
    params: string[];
  }) {
    if (!active || sending) return;

    setSending(true);
    setSendError(null);

    const nonce =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}`;
    const result = await sendTemplateAction(active.id, input, nonce);
    setSending(false);

    if (!result.ok) {
      setSendError(result.error);
      return;
    }

    setOptimistic((previous) => ({
      ...previous,
      [active.id]: [...(previous[active.id] ?? []), result.message],
    }));
    router.refresh();
  }

  return (
    <div className="flex min-h-screen bg-[#08090b] text-slate-200">
      <aside className="sticky top-0 hidden h-screen w-[258px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0a0b0f] px-4 py-5 lg:flex">
        <div className="flex items-center gap-2.5 px-1">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-sm font-bold text-white shadow-lg shadow-indigo-500/20">
            w
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight text-white">Wax</p>
            <p className="text-[11px] text-slate-500">Omnichannel desk</p>
          </div>
        </div>

        <Link
          href="/settings"
          title="Workspace settings"
          className="mt-5 flex w-full items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-[10px] font-semibold text-white">
            {initials(user.workspaceName)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-white">
              {user.workspaceName}
            </span>
            <span className="block text-[10px] text-slate-500">Service desk</span>
          </span>
          <ArrowUpRightIcon className="h-3.5 w-3.5 text-slate-500" />
        </Link>

        <nav className="mt-6 space-y-1">
          {tabs.map((item) => {
            const Icon = item.icon;
            const isActive = tab === item.id;
            return (
              <Link
                key={item.id}
                href={`/${item.id}`}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-white/[0.07] font-medium text-white"
                    : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1 text-left">{item.label}</span>
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] ${
                    isActive
                      ? "bg-indigo-500/20 text-indigo-200"
                      : "bg-white/[0.06] text-slate-400"
                  }`}
                >
                  {tabCounts[item.id]}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-6 mb-2 flex items-center justify-between px-3">
          <span className="text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
            Channels
          </span>
          <Link
            href="/connect"
            aria-label="Connect a channel"
            title="Connect a channel"
            className="rounded-md p-1 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200"
          >
            <PlusIcon className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="space-y-0.5">
          {channels.map((channel) => (
            <button
              key={channel.id}
              type="button"
              onClick={() => {
                router.push(`/inbox?channel=${channel.id}`);
              }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-xs transition-colors hover:bg-white/[0.04] ${
                channelFilter === channel.id ? "bg-white/[0.05]" : ""
              }`}
            >
              <ChannelTile channel={channel} size="sm" />
              <span className="min-w-0 flex-1 truncate text-slate-300">
                {channel.name}
              </span>
              {channel.connected ? (
                channel.unread > 0 ? (
                  <span className="rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[10px] text-slate-300">
                    {channel.unread}
                  </span>
                ) : (
                  <CheckIcon className="h-3 w-3 text-emerald-400/70" />
                )
              ) : (
                <span
                  className={`text-[10px] font-medium ${
                    user.role === "agent"
                      ? "text-slate-500"
                      : "text-indigo-400"
                  }`}
                >
                  {user.role === "agent" ? "Not linked" : "Connect"}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="mt-6 space-y-0.5 border-t border-white/[0.06] pt-4">
          {secondaryNav.map((item) => {
            const Icon = item.icon;
            const isActive = item.active === tab;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-white/[0.07] font-medium text-white"
                    : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="mt-auto flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <span className="relative">
            <Avatar initials={initials(user.name)} color="#6366f1" size="sm" />
            <span
              className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0a0b0f] ${presenceDot[presence]}`}
            />
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-xs font-medium text-white">{user.name}</p>
            <select
              value={presence}
              onChange={(event) =>
                changePresence(event.target.value as PresenceStatus)
              }
              aria-label="Your presence"
              className="w-full cursor-pointer appearance-none bg-transparent text-[10px] text-slate-400 capitalize focus:outline-none"
            >
              <option value="available">Available · {user.role}</option>
              <option value="busy">Busy · {user.role}</option>
              <option value="away">Away · {user.role}</option>
            </select>
          </div>
          <MoreIcon className="h-4 w-4 text-slate-500" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] px-4 py-3.5 lg:px-6">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-xs font-bold text-white lg:hidden">
            w
          </span>
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight text-white sm:text-lg">
              {tab === "settings"
                ? "Settings"
                : tabs.find((item) => item.id === tab)?.label}
            </h1>
            <p className="text-[11px] text-slate-500">
              {totalUnread} unread across {channels.length} channels · signed in
              as {user.email}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <label className="hidden items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-slate-400 transition-colors focus-within:border-indigo-500/40 md:flex">
              <SearchIcon className="h-4 w-4" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search people, topics, channels"
                className="w-56 bg-transparent text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none"
              />
            </label>
            <span className="hidden items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1.5 text-[11px] font-medium text-emerald-300 sm:flex">
              <LiveDot />
              {summary.callsInProgress} calls live
            </span>
            {summary.breachedSlas > 0 && (
              <span
                className="hidden items-center gap-1.5 rounded-full border border-rose-400/20 bg-rose-400/10 px-2.5 py-1.5 text-[11px] font-medium text-rose-300 sm:flex"
                title="Unresolved conversations past their first-reply deadline"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                {summary.breachedSlas} SLA breached
              </span>
            )}
            <div className="relative">
              <button
                type="button"
                aria-label={`Notifications${totalUnread > 0 ? `: ${totalUnread} unread` : ""}`}
                aria-expanded={bellOpen}
                onClick={() => setBellOpen((open) => !open)}
                title={
                  live
                    ? "Live updates connected"
                    : "Reconnecting to live updates…"
                }
                className="relative rounded-xl border border-white/[0.07] bg-white/[0.03] p-2 text-slate-400 transition-colors hover:text-white"
              >
                <BellIcon className="h-4 w-4" />
                <span
                  className={`absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full ${
                    live ? "bg-emerald-400" : "bg-slate-500"
                  }`}
                />
                {totalUnread > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-500 px-1 text-[10px] font-semibold text-white">
                    {totalUnread > 99 ? "99+" : totalUnread}
                  </span>
                )}
              </button>

              {bellOpen && (
                <div className="absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0d0e12] shadow-xl shadow-black/40">
                  <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
                    <p className="text-[11px] font-semibold tracking-[0.1em] text-slate-400 uppercase">
                      Live activity
                    </p>
                    <span
                      className={`flex items-center gap-1.5 text-[10px] ${
                        live ? "text-emerald-300" : "text-slate-500"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          live ? "bg-emerald-400" : "bg-slate-500"
                        }`}
                      />
                      {live ? "Live" : "Offline"}
                    </span>
                  </div>
                  <ul className="max-h-64 divide-y divide-white/[0.04] overflow-y-auto">
                    {activity.length === 0 ? (
                      <li className="px-3 py-6 text-center text-[11px] text-slate-500">
                        No new activity yet.
                      </li>
                    ) : (
                      activity.map((event, index) => (
                        <li
                          key={`${event.at}-${index}`}
                          className="px-3 py-2"
                        >
                          <p className="text-[11px] text-slate-200">
                            {event.text}
                          </p>
                          <p className="mt-0.5 text-[10px] text-slate-500">
                            {new Date(event.at).toLocaleTimeString("en-GB", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </li>
                      ))
                    )}
                  </ul>
                  <div className="border-t border-white/[0.06] px-3 py-2 text-[10px] text-slate-500">
                    {totalUnread} unread · {summary.breachedSlas} SLA breached
                  </div>
                </div>
              )}
            </div>
            <form action={signOutAction}>
              <button
                type="submit"
                className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-indigo-500/40 hover:text-white"
              >
                Sign out
              </button>
            </form>
            <Avatar initials={initials(user.name)} color="#6366f1" size="sm" />
          </div>
        </header>

        <main className="flex-1 space-y-4 p-4 lg:p-6">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <div
                key={metric.label}
                className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4"
              >
                <p className="text-[11px] text-slate-500">{metric.label}</p>
                <p className="mt-1.5 text-2xl font-semibold tracking-tight text-white">
                  {metric.value}
                </p>
                <p
                  className={`mt-1 text-[11px] ${
                    metric.tone === "up" ? "text-emerald-400/80" : "text-slate-500"
                  }`}
                >
                  {metric.delta}
                </p>
              </div>
            ))}
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <section className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
              {tab === "inbox" && !active && (
                <div className="px-6 py-16 text-center">
                  <InboxIcon className="mx-auto h-7 w-7 text-slate-600" />
                  <p className="mt-3 text-sm font-medium text-slate-200">
                    No conversations yet
                  </p>
                  <p className="mx-auto mt-1.5 max-w-sm text-[11px] leading-relaxed text-slate-500">
                    Inbound messages land here as soon as a channel is connected.
                    Link Instagram, WhatsApp, SMS, Discord or Telegram to get
                    started.
                  </p>
                  <Link
                    href="/connect"
                    className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-2 text-[11px] font-medium text-indigo-200 transition-colors hover:bg-indigo-500/20"
                  >
                    Connect a channel
                  </Link>
                </div>
              )}
              {tab === "inbox" && active && (
                <InboxPanel
                  channels={channels}
                  conversations={filtered}
                  channelMap={channelMap}
                  channelFilter={channelFilter}
                  onChannelFilter={selectChannelFilter}
                  active={active}
                  activeMessages={customerHistory}
                  threads={threads}
                  contacts={contacts}
                  identities={activeContact?.identities ?? []}
                  identityBusy={identityBusy}
                  onLinkIdentity={linkIdentity}
                  onUnlinkIdentity={unlinkIdentity}
                  onMergeContact={mergeContact}
                  onSelect={setSelectedId}
                  draft={draft}
                  onDraftChange={setDraft}
                  onSend={sendMessage}
                  onSendTemplate={sendTemplate}
                  sending={sending}
                  sendError={sendError}
                  agents={agents}
                  queues={queues}
                  onAssign={changeAssignee}
                  onMoveQueue={changeQueue}
                  onStatusChange={changeStatus}
                  workflowError={workflowError}
                />
              )}
              {tab === "calendar" && calendar && (
                <CalendarPanel
                  blocks={calendar.blocks}
                  hours={calendar.hours}
                  agents={calendar.agents}
                  me={{ id: user.id, name: user.name }}
                  today={calendar.today}
                  weekStart={calendar.weekStart}
                  weekLabel={calendar.weekLabel}
                  prevWeek={calendar.prevWeek}
                  nextWeek={calendar.nextWeek}
                  thisWeek={calendar.thisWeek}
                />
              )}
              {tab === "calls" && (
                <CallsPanel
                  calls={calls}
                  channelMap={channelMap}
                  agents={agents}
                  queues={queues}
                  onAssign={changeCallAssignee}
                  onMoveQueue={changeCallQueue}
                  workflowError={workflowError}
                />
              )}
              {tab === "meetings" && (
                <MeetingsPanel
                  meetings={meetings}
                  channelMap={channelMap}
                  summary={summary}
                />
              )}
              {tab === "settings" && (
                <SettingsPanel
                  user={user}
                  telegram={telegram}
                  channels={channels}
                  connections={connections}
                  channelAudit={channelAudit}
                  notice={notice}
                />
              )}
            </section>

            <RightRail
              meetings={meetings}
              calls={calls}
              channels={channels}
              channelMap={channelMap}
              agents={agents}
              queues={queues}
              onViewCalls={() => router.push("/calls")}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
