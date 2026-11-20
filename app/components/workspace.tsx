"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  Channel,
  ChannelId,
  Conversation,
  Message,
  PresenceStatus,
  WorkspaceData,
  WorkspaceUser,
} from "../lib/types";
import { signOutAction } from "../lib/auth-actions";
import { sendMessageAction } from "../lib/inbox-actions";
import {
  assignConversationAction,
  moveToQueueAction,
  setPresenceAction,
} from "../lib/workspace-actions";
import {
  ArrowUpRightIcon,
  BellIcon,
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
} from "./icons";
import { Avatar, ChannelTile, LiveDot, initials } from "./ui";
import InboxPanel from "./inbox-panel";
import CallsPanel from "./calls-panel";
import MeetingsPanel from "./meetings-panel";
import RightRail from "./right-rail";
import SettingsPanel from "./settings-panel";

type TabId = "inbox" | "calls" | "meetings" | "settings";

const tabs: { id: TabId; label: string; icon: typeof InboxIcon }[] = [
  { id: "inbox", label: "Inbox", icon: InboxIcon },
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
  tab?: TabId;
}[] = [
  { label: "Contacts", icon: UsersIcon },
  { label: "Analytics", icon: ChartIcon },
  { label: "Settings", icon: SettingsIcon, tab: "settings" },
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
}: {
  data: WorkspaceData;
  user: WorkspaceUser;
}) {
  const {
    channels,
    conversations,
    calls,
    meetings,
    agents,
    queues,
    telegram,
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
    settings: 0,
  };

  const [tab, setTab] = useState<TabId>("inbox");
  const [channelFilter, setChannelFilter] = useState<ChannelId | "all">("all");
  const [selectedId, setSelectedId] = useState(conversations[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [optimistic, setOptimistic] = useState<Record<string, Message[]>>({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);

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

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !active || sending) return;

    setSending(true);
    setSendError(null);

    const result = await sendMessageAction(active.id, text);
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

        <button
          type="button"
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
        </button>

        <nav className="mt-6 space-y-1">
          {tabs.map((item) => {
            const Icon = item.icon;
            const isActive = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
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
              </button>
            );
          })}
        </nav>

        <div className="mt-6 mb-2 flex items-center justify-between px-3">
          <span className="text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
            Channels
          </span>
          <button
            type="button"
            aria-label="Connect a channel"
            className="rounded-md p-1 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200"
          >
            <PlusIcon className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="space-y-0.5">
          {channels.map((channel) => (
            <button
              key={channel.id}
              type="button"
              onClick={() => {
                setTab("inbox");
                selectChannelFilter(channel.id);
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
                <span className="text-[10px] font-medium text-indigo-400">
                  Connect
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="mt-6 space-y-0.5 border-t border-white/[0.06] pt-4">
          {secondaryNav.map((item) => {
            const Icon = item.icon;
            const isActive = item.tab === tab;
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  if (item.tab) setTab(item.tab);
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-white/[0.07] font-medium text-white"
                    : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
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
            <button
              type="button"
              aria-label="Notifications"
              className="relative rounded-xl border border-white/[0.07] bg-white/[0.03] p-2 text-slate-400 transition-colors hover:text-white"
            >
              <BellIcon className="h-4 w-4" />
              <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-indigo-400" />
            </button>
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
              {tab === "inbox" && active && (
                <InboxPanel
                  channels={channels}
                  conversations={filtered}
                  channelMap={channelMap}
                  channelFilter={channelFilter}
                  onChannelFilter={selectChannelFilter}
                  active={active}
                  activeMessages={threads[active.id] ?? []}
                  threads={threads}
                  onSelect={setSelectedId}
                  draft={draft}
                  onDraftChange={setDraft}
                  onSend={sendMessage}
                  sending={sending}
                  sendError={sendError}
                  agents={agents}
                  queues={queues}
                  onAssign={changeAssignee}
                  onMoveQueue={changeQueue}
                  workflowError={workflowError}
                />
              )}
              {tab === "calls" && <CallsPanel calls={calls} channelMap={channelMap} />}
              {tab === "meetings" && (
                <MeetingsPanel
                  meetings={meetings}
                  channelMap={channelMap}
                  summary={summary}
                />
              )}
              {tab === "settings" && (
                <SettingsPanel user={user} telegram={telegram} />
              )}
            </section>

            <RightRail
              meetings={meetings}
              calls={calls}
              channels={channels}
              channelMap={channelMap}
              agents={agents}
              queues={queues}
              onViewCalls={() => setTab("calls")}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
