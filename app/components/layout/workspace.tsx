"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
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
import { UserButton } from "@clerk/nextjs";
import {
  deleteContactData,
  exportContactData,
} from "@/app/lib/privacy/actions";
import {
  linkContactIdentityAction,
  mergeContactsAction,
  unlinkContactIdentityAction,
} from "@/app/lib/contacts/actions";
import {
  retryMessageAction,
  sendMessageAction,
  sendNoteAction,
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
  ClockIcon,
  InboxIcon,
  MoreIcon,
  PanelLeftIcon,
  PhoneIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  UsersIcon,
  VideoIcon,
} from "@/app/components/shared/icons";
import {
  Avatar,
  BrandMark,
  ChannelTile,
  LiveDot,
  initials,
} from "@/app/components/shared/ui";
import inboxArt from "@/app/images/svgs/icon-inbox.svg";
import chatBanner from "@/app/images/breadcrumb/ChatBc.png";
import supportBanner from "@/app/images/background/customer-support-img.png";
import type { TimeBlock, WeeklyHours } from "@/app/lib/calendar/rules";
import type { CalendarTeamMember } from "@/app/lib/calendar/store";
import CalendarPanel from "@/app/components/calendar/calendar-panel";
import DeskSearch from "./desk-search";
import ThemeToggle from "./theme-toggle";
import InboxPanel from "@/app/components/inbox/inbox-panel";
import ContactRail from "@/app/components/inbox/contact-rail";
import ContactsPanel from "@/app/components/contacts/contacts-panel";
import AnalyticsPanel, {
  type AnalyticsReport,
} from "@/app/components/analytics/analytics-panel";
import CallsPanel from "@/app/components/calls/calls-panel";
import MeetingsPanel from "@/app/components/meetings/meetings-panel";
import RightRail from "@/app/components/layout/right-rail";
import SettingsPanel from "@/app/components/settings/settings-panel";
import SlaAlerts from "@/app/components/layout/sla-alerts";

export type DeskTab =
  | "inbox"
  | "calendar"
  | "calls"
  | "meetings"
  | "contacts"
  | "analytics"
  | "settings";
type TabId = DeskTab;

export type CalendarData = {
  blocks: TimeBlock[];
  hours: WeeklyHours;
  team: CalendarTeamMember[];
  /** The viewer's IANA zone: labels and day edges are read in it. */
  timeZone: string;
  /** Server instant for the team lane's per-member "today". */
  nowTs: number;
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
  { id: "contacts", label: "Contacts", icon: UsersIcon },
  { id: "analytics", label: "Analytics", icon: ChartIcon },
];

const presenceDot: Record<PresenceStatus, string> = {
  available: "bg-emerald-400",
  busy: "bg-amber-400",
  away: "bg-slate-500",
};

/** One icon per overview metric, in the reading order the store builds them. */
const metricIcons: Record<string, typeof InboxIcon> = {
  "Open conversations": InboxIcon,
  "Median first reply": ClockIcon,
  "Calls in progress": PhoneIcon,
  "Meetings today": VideoIcon,
};

/**
 * The rail is fixed on desktop, so hiding it is a layout preference rather than
 * component state: it lives on the html element (restored before paint by the
 * root layout) and the stylesheet moves the content column for it.
 */
function applySidebar(hidden: boolean) {
  const value = hidden ? "hidden" : "shown";
  document.documentElement.dataset.sidebar = value;
  try {
    localStorage.setItem("wax-sidebar", value);
  } catch {
    // Private mode: the rail still hides for this page view.
  }
}

const secondaryNav: {
  label: string;
  icon: typeof UsersIcon;
  href: string;
  active?: TabId;
}[] = [
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
    conversation.contact.handle,
    conversation.topic,
    conversation.contact.company,
    conversation.channel,
  ].some((field) => field.toLowerCase().includes(needle));
}

export default function Workspace({
  data,
  user,
  tab,
  initialChannel = "all",
  initialQuery = "",
  initialConversation = "",
  notice = null,
  calendar = null,
  analytics = null,
}: {
  data: WorkspaceData;
  user: WorkspaceUser;
  tab: DeskTab;
  initialChannel?: ChannelId | "all";
  initialQuery?: string;
  initialConversation?: string;
  notice?: string | null;
  calendar?: CalendarData | null;
  analytics?: AnalyticsReport | null;
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
    contacts: contacts.length,
    analytics: 0,
    settings: 0,
  };

  const [channelFilter, setChannelFilter] = useState<ChannelId | "all">(
    initialChannel,
  );
  const [selectedId, setSelectedId] = useState(
    initialConversation || conversations[0]?.id || "",
  );
  const [query, setQuery] = useState(initialQuery);
  const [draft, setDraft] = useState("");
  const [optimistic, setOptimistic] = useState<Record<string, Message[]>>({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [activity, setActivity] = useState<RealtimeEvent[]>([]);
  const [bellOpen, setBellOpen] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);
  const [noteMode, setNoteMode] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

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

  // One search covers the three things the placeholder promises: people,
  // threads and channels. Results are links, so a query can be shared.
  const searchMatches = useMemo(() => {
    if (!needle) return { conversations: [], contacts: [], channels: [] };
    return {
      conversations: conversations
        .filter((conversation) => matchesFilters(conversation, "all", needle))
        .slice(0, 5),
      contacts: contacts
        .filter((contact) =>
          [
            contact.name,
            contact.handle,
            contact.company,
            ...contact.identities.map((identity) => identity.address),
          ].some((field) => field.toLowerCase().includes(needle)),
        )
        .slice(0, 3),
      channels: channels
        .filter((channel) =>
          `${channel.name} ${channel.id}`.toLowerCase().includes(needle),
        )
        .slice(0, 3),
    };
  }, [needle, conversations, contacts, channels]);

  function runSearch() {
    const value = query.trim();
    if (!value) return;
    router.push(`/inbox?q=${encodeURIComponent(value)}`);
  }

  function clearSearch() {
    setQuery("");
    const url = new URL(window.location.href);
    if (url.searchParams.has("q") || url.searchParams.has("conversation")) {
      url.searchParams.delete("q");
      url.searchParams.delete("conversation");
      router.replace(`${url.pathname}${url.search}`);
    }
  }

  function openConversation(id: string) {
    setSelectedId(id);
    setQuery("");
    router.push(`/inbox?conversation=${id}`);
  }

  function searchFor(name: string) {
    setQuery(name);
    router.push(`/inbox?q=${encodeURIComponent(name)}`);
  }

  function filterChannel(id: ChannelId) {
    setQuery("");
    setChannelFilter(id);
    router.push(`/inbox?channel=${id}`);
  }

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
  const demoContacts = contacts.filter((contact) => contact.demo).length;

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

    if (noteMode) {
      const note = await sendNoteAction(active.id, text);
      setSending(false);
      if (!note.ok) {
        setSendError(note.error);
        return;
      }
      setOptimistic((previous) => ({
        ...previous,
        [active.id]: [...(previous[active.id] ?? []), note.message],
      }));
      setDraft("");
      router.refresh();
      return;
    }

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

  async function exportContact() {
    if (!active) return;
    setWorkflowError(null);
    const result = await exportContactData(active.contact.id);
    if (!result.ok) {
      setWorkflowError(result.error);
      return;
    }

    const blob = new Blob([JSON.stringify(result.data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${active.contact.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-export.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function deleteContact() {
    if (!active) return;
    if (
      !window.confirm(
        `Delete ${active.contact.name}, every thread and every message? This cannot be undone.`,
      )
    ) {
      return;
    }
    setWorkflowError(null);
    const result = await deleteContactData(active.contact.id);
    if (!result.ok) {
      setWorkflowError(result.error);
      return;
    }
    router.refresh();
  }

  async function retryMessage(messageId: string) {
    if (retrying) return;
    setRetrying(messageId);
    setSendError(null);
    const result = await retryMessageAction(messageId);
    setRetrying(null);

    if (!result.ok) {
      setSendError(result.error);
      return;
    }

    // The retried row keeps its id, so swap it in rather than appending.
    if (active) {
      setOptimistic((previous) => ({
        ...previous,
        [active.id]: (previous[active.id] ?? []).map((message) =>
          message.id === messageId ? result.message : message,
        ),
      }));
    }
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

  // Quick commands for the palette: navigation plus the two triage actions that
  // otherwise need a trip to the conversation header.
  const paletteActions = [
    ...tabs.map((item) => ({
      label: `Go to ${item.label}`,
      hint: "Section",
      run: () => router.push(`/${item.id}`),
    })),
    {
      label: "Go to Settings",
      hint: "Section",
      run: () => router.push("/settings"),
    },
    ...(active
      ? [
          {
            label: `Assign ${active.contact.name} to me`,
            hint: "Triage",
            run: () => void changeAssignee(active.id, user.id),
          },
          {
            label: `Resolve ${active.contact.name}`,
            hint: "Triage",
            run: () => void changeStatus(active.id, "resolved"),
          },
        ]
      : []),
  ];

  // Keyboard: ⌘K/Ctrl+K jumps to search, Alt+1…5 switches sections and "?"
  // lists the shortcuts. Nothing fires while the person is typing in a field.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = Boolean(
        target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable),
      );

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        const input = document.getElementById(
          "desk-search-input",
        ) as HTMLInputElement | null;
        if (input) input.focus();
        else setMobileSearch(true);
        return;
      }

      if (event.key === "Escape") {
        setShortcutsOpen(false);
        return;
      }

      if (typing) return;

      if (event.altKey && /^[1-6]$/.test(event.key)) {
        const target = tabs[Number(event.key) - 1];
        if (target) {
          event.preventDefault();
          router.push(`/${target.id}`);
        }
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return (
    <div className="wax-app flex min-h-screen text-slate-200">
      <aside className="wax-sidebar wax-sidebar-shell fixed top-0 bottom-0 left-0 z-30 hidden h-screen w-[268px] flex-col overflow-y-auto border-r border-fg/[0.06] px-3 py-5 lg:flex">
        <div className="flex items-center gap-2.5 px-2">
          <BrandMark />
          <div className="leading-tight">
            <p className="text-[15px] font-semibold tracking-tight text-fg">Wax</p>
            <p className="text-[10px] font-medium tracking-[0.12em] text-slate-500 uppercase">
              Omnichannel
            </p>
          </div>
          <span className="ml-auto flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-2 py-0.5 text-[9px] font-semibold tracking-[0.06em] text-emerald-300 uppercase">
            <span className="h-1 w-1 rounded-full bg-emerald-400" />
            Live
          </span>
          <button
            type="button"
            onClick={() => applySidebar(true)}
            aria-label="Hide sidebar"
            title="Hide sidebar"
            className="wax-press rounded-md p-1 text-slate-500 transition-colors hover:bg-fg/5 hover:text-slate-200"
          >
            <PanelLeftIcon className="h-4 w-4" />
          </button>
        </div>

        <Link
          href="/settings"
          title="Workspace settings"
          className="wax-press mt-5 flex w-full items-center gap-2.5 rounded-xl border border-fg/[0.07] bg-fg/[0.022] px-2.5 py-2.5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors hover:border-fg/[0.12] hover:bg-fg/[0.05]"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/15 text-[10px] font-semibold text-indigo-200 ring-1 ring-indigo-400/25 ring-inset">
            {initials(user.workspaceName)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium text-fg">
              {user.workspaceName}
            </span>
            <span className="block truncate text-[10px] text-slate-500">
              Service desk
            </span>
          </span>
          <ArrowUpRightIcon className="h-3.5 w-3.5 text-slate-500" />
        </Link>

        <p className="wax-eyebrow mt-6 mb-1.5 px-2.5">Desk</p>
        <nav className="space-y-0.5">
          {tabs.map((item) => {
            const Icon = item.icon;
            const isActive = tab === item.id;
            return (
              <Link
                key={item.id}
                href={`/${item.id}`}
                aria-current={isActive ? "page" : undefined}
                className={`group relative flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-[7px] text-[13px] transition-colors ${
                  isActive
                    ? "bg-fg/[0.07] font-medium text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                    : "text-slate-400 hover:bg-fg/[0.035] hover:text-slate-200"
                }`}
              >
                {isActive && (
                  <span className="absolute top-1/2 left-0 h-4 w-[2.5px] -translate-y-1/2 rounded-r-full bg-indigo-400 shadow-[0_0_10px_1px_rgba(129,140,248,0.55)]" />
                )}
                <Icon
                  className={`h-4 w-4 ${
                    isActive
                      ? "text-indigo-300"
                      : "text-slate-500 group-hover:text-slate-300"
                  }`}
                />
                <span className="flex-1 text-left">{item.label}</span>
                <span
                  className={`wax-num rounded-md px-1.5 py-0.5 text-[10px] ${
                    isActive
                      ? "bg-indigo-500/20 text-indigo-100 ring-1 ring-indigo-400/25 ring-inset"
                      : "text-slate-500"
                  }`}
                >
                  {tabCounts[item.id]}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-6 mb-1.5 flex items-center justify-between px-2.5">
          <span className="wax-eyebrow">Channels</span>
          <Link
            href="/connect"
            aria-label="Connect a channel"
            title="Connect a channel"
            className="rounded-md p-1 text-slate-500 transition-colors hover:bg-fg/5 hover:text-slate-200"
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
              className={`group flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-[6px] text-left text-[12px] transition-colors ${
                channelFilter === channel.id
                  ? "bg-fg/[0.06] text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                  : "text-slate-300 hover:bg-fg/[0.035]"
              }`}
            >
              <ChannelTile channel={channel} size="sm" />
              <span className="min-w-0 flex-1 truncate text-slate-300">
                {channel.name}
              </span>
              {channel.connected ? (
                channel.unread > 0 ? (
                  <span className="wax-num rounded-md bg-fg/[0.07] px-1.5 py-0.5 text-[10px] text-slate-200">
                    {channel.unread}
                  </span>
                ) : (
                  <CheckIcon className="h-3 w-3 text-emerald-400/60" />
                )
              ) : (
                <span
                  className={`text-[10px] font-medium ${
                    user.role === "agent"
                      ? "text-slate-500"
                      : "text-slate-500 transition-colors group-hover:text-indigo-300"
                  }`}
                >
                  {user.role === "agent" ? "Not linked" : "Connect"}
                </span>
              )}
            </button>
          ))}
        </div>

        <p className="wax-eyebrow mt-6 mb-1.5 px-2.5">Workspace</p>
        <div className="space-y-0.5">
          {secondaryNav.map((item) => {
            const Icon = item.icon;
            const isActive = item.active === tab;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`wax-press group flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-[7px] text-[13px] transition-colors ${
                  isActive
                    ? "bg-fg/[0.07] font-medium text-fg"
                    : "text-slate-400 hover:bg-fg/[0.035] hover:text-slate-200"
                }`}
              >
                <Icon
                  className={`h-4 w-4 ${
                    isActive ? "text-indigo-300" : "text-slate-500"
                  }`}
                />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="mt-auto flex items-center gap-2.5 rounded-xl border border-fg/[0.07] bg-fg/[0.022] px-2.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <span className="relative">
            <Avatar initials={initials(user.name)} color="#6366f1" size="sm" />
            <span
              className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0a0b0f] ${presenceDot[presence]}`}
            />
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-xs font-medium text-fg">{user.name}</p>
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

      <div className="wax-content flex min-w-0 flex-1 flex-col">
        <header className="wax-header wax-enter-soft sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-fg/[0.06] px-4 py-3 backdrop-blur-xl lg:px-7">
          <span className="lg:hidden">
            <BrandMark size="sm" />
          </span>
          <button
            type="button"
            onClick={() => applySidebar(false)}
            aria-label="Show sidebar"
            title="Show sidebar"
            className="wax-sidebar-open wax-press hidden h-8 w-8 items-center justify-center rounded-lg border border-fg/[0.07] bg-fg/[0.03] text-slate-400 transition-colors hover:border-fg/[0.14] hover:text-fg"
          >
            <PanelLeftIcon className="h-4 w-4" />
          </button>
          <div className="leading-tight">
            <p className="wax-eyebrow">Desk</p>
            <p className="mt-1 truncate text-[13px] font-semibold tracking-tight text-fg">
              {user.workspaceName}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileSearch((open) => !open)}
              aria-label="Open search"
              aria-expanded={mobileSearch}
              className="wax-press rounded-xl border border-fg/[0.07] bg-fg/[0.03] p-2 text-slate-400 transition-colors hover:text-fg md:hidden"
            >
              <SearchIcon className="h-4 w-4" />
            </button>
            <DeskSearch
              variant="inline"
              query={query}
              needle={needle}
              matches={searchMatches}
              channelMap={channelMap}
              onQueryChange={setQuery}
              onOpenConversation={openConversation}
              onSearchFor={searchFor}
              onFilterChannel={filterChannel}
              onRunSearch={runSearch}
              onClear={clearSearch}
              onDismiss={() => setMobileSearch(false)}
              actions={paletteActions}
            />
            <span className="hidden items-center gap-1.5 rounded-full border border-emerald-400/15 bg-emerald-400/[0.07] px-2.5 py-1 text-[11px] font-medium text-emerald-300 sm:flex">
              <LiveDot />
              <span className="wax-num">{summary.callsInProgress}</span> calls live
            </span>
            {summary.breachedSlas > 0 && (
              <span
                className="hidden items-center gap-1.5 rounded-full border border-rose-400/20 bg-rose-400/[0.08] px-2.5 py-1 text-[11px] font-medium text-rose-300 sm:flex"
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
                className="wax-press relative grid h-9 w-9 place-items-center rounded-xl border border-fg/[0.07] bg-fg/[0.03] text-slate-400 transition-colors hover:border-fg/[0.14] hover:bg-fg/[0.06] hover:text-fg"
              >
                <BellIcon className="h-4 w-4" />
                <span
                  className={`absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full ${
                    live ? "bg-emerald-400" : "bg-slate-500"
                  }`}
                />
                {totalUnread > 0 && (
                  <span className="wax-pop absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-500 px-1 text-[10px] font-semibold text-white">
                    {totalUnread > 99 ? "99+" : totalUnread}
                  </span>
                )}
              </button>

              {bellOpen && (
                <div className="wax-drop absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-2xl border border-fg/[0.09] bg-[var(--wax-raised)] shadow-[0_30px_60px_-24px_rgba(0,0,0,1)]">
                  <div className="flex items-center justify-between border-b border-fg/[0.06] px-3 py-2">
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
                  <ul className="wax-stagger max-h-64 divide-y divide-fg/[0.04] overflow-y-auto">
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
                  <div className="border-t border-fg/[0.06] px-3 py-2 text-[10px] text-slate-500">
                    {totalUnread} unread · {summary.breachedSlas} SLA breached
                  </div>
                </div>
              )}
            </div>
            <ThemeToggle />
            <UserButton />
          </div>
        </header>

        {mobileSearch && (
          <div className="wax-drop border-b border-fg/[0.06] px-4 py-3 md:hidden">
            <DeskSearch
              variant="sheet"
              query={query}
              needle={needle}
              matches={searchMatches}
              channelMap={channelMap}
              onQueryChange={setQuery}
              onOpenConversation={openConversation}
              onSearchFor={searchFor}
              onFilterChannel={filterChannel}
              onRunSearch={runSearch}
              onClear={clearSearch}
              onDismiss={() => setMobileSearch(false)}
              actions={paletteActions}
            />
          </div>
        )}

        <main className="mx-auto w-full max-w-[1560px] flex-1 space-y-5 p-4 pb-28 lg:p-7">
          <section className="wax-banner wax-enter-soft">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-fg">
                  {tab === "settings"
                    ? "Settings"
                    : tabs.find((item) => item.id === tab)?.label}
                </h1>
                <p className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
                  <Link
                    href="/inbox"
                    className="transition-colors hover:text-fg"
                  >
                    Home
                  </Link>
                  <span aria-hidden className="text-slate-600">
                    •
                  </span>
                  <span className="text-slate-300">
                    {tab === "settings"
                      ? "Settings"
                      : tabs.find((item) => item.id === tab)?.label}
                  </span>
                </p>
              </div>
              <div className="flex items-end gap-4">
                <p className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                  <span>
                    <span className="wax-num text-slate-200">{totalUnread}</span>{" "}
                    unread across {channels.length} channels
                  </span>
                  {demoContacts > 0 && (
                    <Link
                      href="/contacts"
                      title="Seeded showroom contacts for exploring the desk"
                      className="rounded-full border border-violet-400/25 bg-violet-400/10 px-2 py-0.5 text-[10px] font-medium text-violet-200 transition-colors hover:bg-violet-400/15"
                    >
                      {demoContacts} demo {demoContacts === 1 ? "contact" : "contacts"}
                    </Link>
                  )}
                </p>
                <Image
                  src={tab === "inbox" ? chatBanner : supportBanner}
                  alt=""
                  priority
                  className="pointer-events-none hidden h-14 w-auto select-none sm:block"
                />
              </div>
            </div>
          </section>
          <div className="flex justify-end empty:hidden">
            <SlaAlerts conversations={conversations} />
          </div>
          <section className="wax-stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => {
              const Icon = metricIcons[metric.label] ?? ChartIcon;
              return (
                <div
                  key={metric.label}
                  className="wax-lift group relative overflow-hidden rounded-2xl border border-fg/[0.07] bg-gradient-to-b from-fg/[0.045] to-fg/[0.008] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -top-14 -right-8 h-24 w-24 rounded-full bg-indigo-500/[0.09] blur-2xl transition-colors duration-300 group-hover:bg-indigo-500/[0.16]"
                  />
                  <div className="relative flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="wax-eyebrow">{metric.label}</p>
                      <p className="wax-num mt-3 text-[26px] leading-none font-semibold text-fg">
                        {metric.value}
                      </p>
                    </div>
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-indigo-400/25 bg-indigo-500/[0.12] text-indigo-500">
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                  </div>
                  <p
                    className={`relative mt-3 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      metric.tone === "up" ? "wax-pill-up" : "wax-pill-neutral"
                    }`}
                  >
                    {metric.delta}
                  </p>
                </div>
              );
            })}
          </section>

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            {/* Keyed by tab so switching sections plays the entrance again. */}
            <section key={tab} className="wax-panel wax-enter overflow-hidden">
              {tab === "inbox" && !active && (
                <div className="px-6 py-16 text-center">
                  <Image
                    src={inboxArt}
                    alt=""
                    width={48}
                    height={48}
                    unoptimized
                    className="mx-auto h-12 w-12"
                  />
                  <p className="mt-4 text-sm font-medium text-slate-100">
                    No conversations yet
                  </p>
                  <p className="mx-auto mt-1.5 max-w-sm text-[11px] leading-relaxed text-slate-500">
                    Inbound messages land here as soon as a channel is connected.
                    Link Instagram, WhatsApp, SMS, Discord or Telegram to get
                    started.
                  </p>
                  <Link
                    href="/connect"
                    className="wax-press mt-5 inline-flex items-center gap-1.5 rounded-xl border border-indigo-400/25 bg-indigo-500/[0.12] px-3.5 py-2 text-[11px] font-semibold text-indigo-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors hover:bg-indigo-500/20"
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
                  onExportContact={exportContact}
                  onDeleteContact={deleteContact}
                  onSelect={setSelectedId}
                  draft={draft}
                  onDraftChange={setDraft}
                  onSend={sendMessage}
                  onSendTemplate={sendTemplate}
                  sending={sending}
                  sendError={sendError}
                  onRetry={retryMessage}
                  retrying={retrying}
                  noteMode={noteMode}
                  onNoteModeChange={setNoteMode}
                  agents={agents}
                  queues={queues}
                  onAssign={changeAssignee}
                  onMoveQueue={changeQueue}
                  onStatusChange={changeStatus}
                  workflowError={workflowError}
                  currentUserId={user.id}
                />
              )}
              {tab === "calendar" && calendar && (
                <CalendarPanel
                  blocks={calendar.blocks}
                  hours={calendar.hours}
                  team={calendar.team}
                  timeZone={calendar.timeZone}
                  nowTs={calendar.nowTs}
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
              {tab === "contacts" && (
                <ContactsPanel contacts={contacts} channels={channels} />
              )}
              {tab === "analytics" &&
                (analytics ? (
                  <AnalyticsPanel report={analytics} metrics={metrics} />
                ) : (
                  <p className="px-6 py-16 text-center text-xs text-slate-500">
                    Analytics is unavailable right now.
                  </p>
                ))}
              {tab === "settings" && (
                <SettingsPanel
                  user={user}
                  telegram={telegram}
                  channels={channels}
                  connections={connections}
                  channelAudit={channelAudit}
                  members={data.members}
                  invites={data.invites}
                  audit={data.audit}
                  jobs={data.jobs}
                  agents={agents}
                  queues={queues}
                  summary={summary}
                  notice={notice}
                />
              )}
            </section>

            {/* The inbox keeps the right column for the open conversation's
                contact and queue facts; every other tab keeps the desk rail. */}
            {tab === "inbox" ? (
              <ContactRail
                contact={active.contact}
                conversation={active}
                identities={activeContact?.identities ?? []}
                channelMap={channelMap}
              />
            ) : (
              <RightRail
                meetings={meetings}
                calls={calls}
                channels={channels}
                channelMap={channelMap}
                agents={agents}
                queues={queues}
                onViewCalls={() => router.push("/calls")}
              />
            )}
          </div>
        </main>
      </div>

      <Link
        href="/settings"
        aria-label="Workspace settings"
        title="Workspace settings"
        className="wax-press fixed right-6 bottom-6 z-30 hidden h-12 w-12 place-items-center rounded-full bg-gradient-to-b from-indigo-400 to-indigo-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_18px_40px_-18px_rgba(45,72,170,0.95)] transition-colors hover:from-indigo-300 hover:to-indigo-500 lg:grid"
      >
        <SettingsIcon className="h-5 w-5" />
      </Link>

      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-fg/[0.08] bg-[var(--wax-ink)] pb-[env(safe-area-inset-bottom)] shadow-[0_-20px_50px_-30px_rgba(0,0,0,1)] backdrop-blur-xl lg:hidden"
      >
        {tabs.map((item) => {
          const Icon = item.icon;
          const isActive = tab === item.id;
          return (
            <Link
              key={item.id}
              href={`/${item.id}`}
              aria-current={isActive ? "page" : undefined}
              className={`wax-press relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] transition-colors ${
                isActive ? "text-fg" : "text-slate-500"
              }`}
            >
              <span
                aria-hidden
                className="wax-nav-marker absolute top-0 h-0.5 w-8 rounded-full bg-indigo-400"
              />
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {shortcutsOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
          className="wax-modal-backdrop fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4"
          onClick={() => setShortcutsOpen(false)}
        >
          <div
            className="wax-modal-card w-full max-w-sm rounded-2xl border border-fg/[0.09] bg-[var(--wax-raised)] p-5 text-slate-200 shadow-[0_40px_80px_-40px_rgba(0,0,0,1)]"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-sm font-semibold text-fg">Keyboard shortcuts</p>
            <ul className="mt-3 space-y-1.5 text-[11px]">
              {[
                ["⌘K / Ctrl K", "Focus search"],
                ["Alt + 1…6", "Inbox, calendar, calls, meetings, contacts, analytics"],
                ["j / k", "Move through the inbox queue"],
                ["e", "Resolve the open conversation"],
                ["a", "Assign it to you"],
                ["n", "Switch between reply and internal note"],
                ["/", "Search the queue"],
                ["Enter", "Open the first search result"],
                ["Esc", "Clear search or close this panel"],
                ["?", "Show these shortcuts"],
              ].map(([keys, label]) => (
                <li key={keys} className="flex items-center justify-between gap-3">
                  <span className="text-slate-400">{label}</span>
                  <kbd className="rounded border border-fg/[0.1] bg-fg/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                    {keys}
                  </kbd>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setShortcutsOpen(false)}
              className="wax-press mt-4 w-full rounded-lg bg-indigo-500 px-3 py-2 text-[11px] font-semibold text-white hover:bg-indigo-400"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
