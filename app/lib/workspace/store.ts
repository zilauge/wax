import "server-only";

import { connection } from "next/server";
import { telegramConfigured } from "@/app/lib/channels/telegram";
import { listConnections } from "@/app/lib/channels/connections";
import { getProvider } from "@/app/lib/channels/providers";
import { resolveTelegramBindingForWorkspace } from "@/app/lib/channels/telegram-binding";
import { db } from "@/app/lib/db/db";
import type {
  Agent,
  Call,
  Channel,
  ChannelId,
  Conversation,
  Meeting,
  Message,
  Metric,
  PresenceStatus,
  Queue,
  TelegramRouting,
  Sla,
  Summary,
  WorkspaceContact,
  WorkspaceData,
} from "@/app/lib/types";

type Row = Record<string, unknown>;

const MINUTE = 60_000;

function text(value: unknown) {
  return String(value ?? "");
}

function relativeTime(timestamp: number) {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / MINUTE));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function clockTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * First-response SLA. A conversation is met once an agent has replied, due
 * while the clock runs, and breached after the queue's deadline passes.
 */
function slaFor(
  status: string,
  firstResponseAt: number | null,
  dueAt: number | null,
): Sla | null {
  if (status === "resolved") return null;
  if (firstResponseAt) return { state: "met", label: "First reply sent" };
  if (!dueAt) return null;

  const remaining = dueAt - Date.now();

  if (remaining >= 0) {
    const minutes = Math.floor(remaining / 60_000);
    const seconds = Math.round((remaining % 60_000) / 1000);
    return {
      state: "due",
      label: minutes > 0 ? `Reply in ${minutes}m` : `Reply in ${seconds}s`,
    };
  }

  const overdue = Math.abs(remaining);
  const minutes = Math.max(1, Math.round(overdue / 60_000));
  return {
    state: "breached",
    label: minutes > 60
      ? `Overdue ${Math.round(minutes / 60)}h`
      : `Overdue ${minutes}m`,
  };
}

function toMessage(row: Row): Message {
  return {
    id: text(row.id),
    author: text(row.author) === "agent" ? "agent" : "contact",
    text: text(row.body),
    time: clockTime(Number(row.created_at)),
    at: Number(row.created_at),
    channel: text(row.channel_id) as ChannelId,
    status: text(row.status) === "failed" ? "failed" : "sent",
    error: row.error ? text(row.error) : null,
  };
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

/** Median time from a customer's first message to the first agent reply. */
function medianFirstReply(rowsByConversation: Map<string, Row[]>) {
  const gaps: number[] = [];

  for (const rows of rowsByConversation.values()) {
    const inbound = rows.find((row) => text(row.author) === "contact");
    if (!inbound) continue;
    const reply = rows.find(
      (row) =>
        text(row.author) === "agent" &&
        Number(row.created_at) >= Number(inbound.created_at),
    );
    if (reply) {
      gaps.push((Number(reply.created_at) - Number(inbound.created_at)) / 1000);
    }
  }

  if (gaps.length === 0) return "—";

  gaps.sort((a, b) => a - b);
  const middle = Math.floor(gaps.length / 2);
  const median =
    gaps.length % 2 === 0 ? (gaps[middle - 1] + gaps[middle]) / 2 : gaps[middle];
  const minutes = Math.floor(median / 60);
  const seconds = Math.round(median % 60);

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** Loads everything the dashboard renders for one workspace. */
export async function getWorkspaceData(
  workspaceId: string,
): Promise<WorkspaceData> {
  // Relative timestamps are computed at request time, not during prerendering.
  await connection();

  const channelRows = db
    .prepare(
      "SELECT id, name, handle, monogram, color, connected FROM channels WHERE workspace_id = ? ORDER BY rowid",
    )
    .all(workspaceId);

  const conversationRows = db
    .prepare(
      `SELECT c.id, c.channel_id, c.contact_id, c.topic, c.status, c.assignee_user_id, c.unread, c.last_at,
              c.queue_id, c.first_response_at, c.sla_due_at,
              q.name AS queue_name, q.color AS queue_color,
              u.name AS assignee_name,
              ct.name AS contact_name, ct.handle AS contact_handle,
              ct.company AS contact_company, ct.color AS contact_color
       FROM conversations c
       JOIN contacts ct ON ct.id = c.contact_id
       LEFT JOIN queues q ON q.id = c.queue_id
       LEFT JOIN users u ON u.id = c.assignee_user_id
       WHERE c.workspace_id = ?
       ORDER BY c.last_at DESC`,
    )
    .all(workspaceId);

  const messageRows = db
    .prepare(
      `SELECT m.id, m.conversation_id, m.author, m.body, m.created_at, m.status, m.error,
              c.channel_id AS channel_id
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.workspace_id = ?
       ORDER BY m.created_at ASC`,
    )
    .all(workspaceId);

  const messagesByConversation = groupBy(
    messageRows,
    (row) => text(row.conversation_id),
  );

  const conversations: Conversation[] = conversationRows.map((row) => ({
    id: text(row.id),
    channel: text(row.channel_id) as ChannelId,
    contact: {
      id: text(row.contact_id),
      name: text(row.contact_name),
      handle: text(row.contact_handle),
      company: text(row.contact_company),
      color: text(row.contact_color),
    },
    topic: text(row.topic),
    status: text(row.status) as Conversation["status"],
    assigneeId: row.assignee_user_id ? text(row.assignee_user_id) : null,
    assigneeName: row.assignee_name ? text(row.assignee_name) : null,
    queueId: row.queue_id ? text(row.queue_id) : null,
    queueName: row.queue_name ? text(row.queue_name) : null,
    queueColor: row.queue_color ? text(row.queue_color) : null,
    sla: slaFor(
      text(row.status),
      row.first_response_at ? Number(row.first_response_at) : null,
      row.sla_due_at ? Number(row.sla_due_at) : null,
    ),
    lastAt: relativeTime(Number(row.last_at)),
    unread: Number(row.unread),
    messages: (messagesByConversation.get(text(row.id)) ?? []).map(toMessage),
  }));

  const contactRows = db
    .prepare(
      "SELECT id, name, handle, company, color FROM contacts WHERE workspace_id = ? ORDER BY name",
    )
    .all(workspaceId);

  const identityRows = db
    .prepare(
      `SELECT id, contact_id, channel_id, address FROM contact_identities
       WHERE workspace_id = ? ORDER BY created_at, rowid`,
    )
    .all(workspaceId);

  const identitiesByContact = groupBy(identityRows, (row) =>
    text(row.contact_id),
  );
  const conversationsByContact = groupBy(conversationRows, (row) =>
    text(row.contact_id),
  );

  const contacts: WorkspaceContact[] = contactRows.map((row) => {
    const id = text(row.id);
    const identities = (identitiesByContact.get(id) ?? []).map((identity) => ({
      id: text(identity.id),
      channel: text(identity.channel_id) as ChannelId,
      address: text(identity.address),
    }));
    const latest = conversationsByContact.get(id)?.[0];

    return {
      id,
      name: text(row.name),
      handle: text(row.handle),
      company: text(row.company),
      color: text(row.color),
      channel: latest
        ? (text(latest.channel_id) as ChannelId)
        : (identities[0]?.channel ?? "telegram"),
      identities,
    };
  });

  const connections = listConnections(workspaceId);

  const channels: Channel[] = channelRows.map((row) => {
    const id = text(row.id) as ChannelId;
    const unread = conversations
      .filter((conversation) => conversation.channel === id)
      .reduce((total, conversation) => total + conversation.unread, 0);
    const provider = getProvider(id);
    const connection = connections.find((item) => item.channel === id);

    return {
      id,
      name: text(row.name),
      handle: text(row.handle),
      monogram: text(row.monogram),
      color: text(row.color),
      // Telegram is usable once the bot token exists; a social channel only
      // after its OAuth callback stored a linked account.
      connected: id === "telegram" ? telegramConfigured() : Boolean(connection),
      configured:
        id === "telegram"
          ? telegramConfigured()
          : Boolean(provider?.configured()),
      unread,
    };
  });

  const calls: Call[] = db
    .prepare(
      `SELECT c.id, c.caller, c.company, c.hold, c.channel_id, c.direction, c.state,
              c.queue_id, q.name AS queue_name, q.color AS queue_color,
              c.assignee_user_id, u.name AS assignee_name
       FROM calls c
       LEFT JOIN queues q ON q.id = c.queue_id
       LEFT JOIN users u ON u.id = c.assignee_user_id
       WHERE c.workspace_id = ?
       ORDER BY c.position`,
    )
    .all(workspaceId)
    .map((row) => ({
      id: text(row.id),
      caller: text(row.caller),
      company: text(row.company),
      hold: text(row.hold),
      channel: text(row.channel_id) as ChannelId,
      direction: text(row.direction) as Call["direction"],
      state: text(row.state) as Call["state"],
      queueId: row.queue_id ? text(row.queue_id) : null,
      queueName: row.queue_name ? text(row.queue_name) : null,
      queueColor: row.queue_color ? text(row.queue_color) : null,
      assigneeId: row.assignee_user_id ? text(row.assignee_user_id) : null,
      assigneeName: row.assignee_name ? text(row.assignee_name) : null,
    }));

  const meetings: Meeting[] = db
    .prepare(
      `SELECT id, title, starts_at, duration, host, attendees, status, channel_id
       FROM meetings WHERE workspace_id = ? ORDER BY position`,
    )
    .all(workspaceId)
    .map((row) => ({
      id: text(row.id),
      title: text(row.title),
      startsAt: text(row.starts_at),
      duration: text(row.duration),
      host: text(row.host),
      attendees: JSON.parse(text(row.attendees)) as string[],
      status: text(row.status) as Meeting["status"],
      channel: text(row.channel_id) as ChannelId,
    }));

  const agents: Agent[] = db
    .prepare(
      `SELECT u.id, u.name, m.role, p.status
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN agent_presence p
         ON p.workspace_id = m.workspace_id AND p.user_id = m.user_id
       WHERE m.workspace_id = ?
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name`,
    )
    .all(workspaceId)
    .map((row) => ({
      id: text(row.id),
      name: text(row.name),
      role: text(row.role) as Agent["role"],
      presence: (row.status ? text(row.status) : "away") as PresenceStatus,
      active: conversations.filter(
        (conversation) =>
          conversation.assigneeId === text(row.id) &&
          conversation.status !== "resolved",
      ).length,
    }));

  const queues: Queue[] = db
    .prepare(
      "SELECT id, name, sla_minutes, color FROM queues WHERE workspace_id = ? ORDER BY position",
    )
    .all(workspaceId)
    .map((row) => {
      const id = text(row.id);
      const open = conversations.filter(
        (conversation) =>
          conversation.queueId === id && conversation.status !== "resolved",
      );

      return {
        id,
        name: text(row.name),
        slaMinutes: Number(row.sla_minutes),
        color: text(row.color),
        open: open.length,
        breaching: open.filter((conversation) => conversation.sla?.state === "breached")
          .length,
      };
    });

  const binding = resolveTelegramBindingForWorkspace(workspaceId);
  const telegram: TelegramRouting = {
    bound: Boolean(binding),
    botUsername: binding?.botUsername ?? null,
    boundAt: binding?.boundAt
      ? new Date(binding.boundAt).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : null,
    tokenConfigured: telegramConfigured(),
  };

  const summary: Summary = {
    openConversations: conversations.filter(
      (conversation) => conversation.status !== "resolved",
    ).length,
    callsInProgress: calls.length,
    meetingsToday: meetings.length,
    breachedSlas: conversations.filter(
      (conversation) => conversation.sla?.state === "breached",
    ).length,
  };

  const waitingCalls = calls.filter((call) => call.state === "waiting").length;
  const liveMeetings = meetings.filter(
    (meeting) => meeting.status === "live",
  ).length;

  const metrics: Metric[] = [
    {
      label: "Open conversations",
      value: String(summary.openConversations),
      delta: `${conversations.length} conversations in total`,
      tone: "up",
    },
    {
      label: "Median first reply",
      value: medianFirstReply(messagesByConversation),
      delta: "measured from stored messages",
      tone: "up",
    },
    {
      label: "Calls in progress",
      value: String(summary.callsInProgress),
      delta: `${waitingCalls} waiting in queue`,
      tone: "neutral",
    },
    {
      label: "Meetings today",
      value: String(summary.meetingsToday),
      delta: `${liveMeetings} live now`,
      tone: "neutral",
    },
  ];

  return {
    channels,
    connections,
    conversations,
    contacts,
    calls,
    meetings,
    agents,
    queues,
    telegram,
    metrics,
    summary,
  };
}
