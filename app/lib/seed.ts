import "server-only";

import { randomUUID } from "node:crypto";
import { db } from "./db";
import type { ChannelId } from "./types";

type SeedMessage = { author: "agent" | "contact"; text: string; minutesAgo: number };

type SeedConversation = {
  channel: ChannelId;
  contact: { name: string; handle: string; company: string; color: string };
  topic: string;
  status: "open" | "pending" | "resolved";
  queue: "support" | "sales";
  /** Only the account owner exists as a real agent, so the rest start unassigned. */
  assignee: "owner" | null;
  unread: number;
  messages: SeedMessage[];
};

const queues = [
  { key: "support" as const, name: "Support", slaMinutes: 15, color: "#22c55e" },
  { key: "sales" as const, name: "Sales", slaMinutes: 60, color: "#6366f1" },
];

const channels: { id: ChannelId; name: string; handle: string; monogram: string; color: string; connected: boolean }[] = [
  { id: "instagram", name: "Instagram", handle: "@wax.hq", monogram: "Ig", color: "#e1306c", connected: true },
  { id: "tiktok", name: "TikTok", handle: "@waxstudio", monogram: "Tk", color: "#25f4ee", connected: true },
  { id: "whatsapp", name: "WhatsApp", handle: "+1 415 555 0134", monogram: "Wa", color: "#25d366", connected: true },
  { id: "x", name: "X", handle: "@waxapp", monogram: "X", color: "#e7e9ea", connected: true },
  { id: "telegram", name: "Telegram", handle: "@waxsupport", monogram: "Tg", color: "#2aabee", connected: false },
  { id: "youtube", name: "YouTube", handle: "Wax Studio", monogram: "Yt", color: "#ff0033", connected: false },
];

const conversations: SeedConversation[] = [
  {
    channel: "whatsapp",
    contact: {
      name: "Amara Okafor",
      handle: "+234 803 555 0198",
      company: "Northwind Retail",
      color: "#f59e0b",
    },
    topic: "Enterprise rollout — 240 seats",
    status: "open",
    queue: "sales",
    assignee: "owner",
    unread: 3,
    messages: [
      { author: "contact", text: "Hi! We spoke last week about moving our support team onto Wax. Procurement signed off on 240 seats.", minutesAgo: 8 },
      { author: "agent", text: "Amara, that is great news. I can hold the annual pricing we quoted until Friday.", minutesAgo: 5 },
      { author: "contact", text: "Perfect. Can we get a call tomorrow at 11:00 to walk through the WhatsApp and Telegram routing?", minutesAgo: 3 },
      { author: "contact", text: "Also sending the vendor form here — our legal team needs it back signed.", minutesAgo: 2 },
    ],
  },
  {
    channel: "instagram",
    contact: {
      name: "Diego Marín",
      handle: "@diego.builds",
      company: "Creator, 412k followers",
      color: "#8b5cf6",
    },
    topic: "Partnership for the launch stream",
    status: "pending",
    queue: "sales",
    assignee: null,
    unread: 1,
    messages: [
      { author: "contact", text: "Loved the demo reel. I'd be up for co-hosting the launch stream on the 24th.", minutesAgo: 19 },
      { author: "agent", text: "That would be brilliant. Sending over the run-of-show now — 45 minutes, two segments.", minutesAgo: 12 },
      { author: "contact", text: "Got it. Can we do a 15 minute tech check in the studio room the day before?", minutesAgo: 11 },
    ],
  },
  {
    channel: "x",
    contact: {
      name: "Lena Fischer",
      handle: "@lenafischer",
      company: "HelpDesk Weekly",
      color: "#06b6d4",
    },
    topic: "Reviewing the call recording export",
    status: "open",
    queue: "support",
    assignee: "owner",
    unread: 0,
    messages: [
      { author: "contact", text: "Public post: does Wax export call transcripts with speaker labels? Writing this up today.", minutesAgo: 32 },
      { author: "agent", text: "Yes — transcripts, speaker labels, and the recording, all in one export. I'll DM you a sample.", minutesAgo: 26 },
      { author: "contact", text: "Sample received, that's exactly what I needed. Thanks for the quick reply.", minutesAgo: 22 },
    ],
  },
  {
    channel: "telegram",
    contact: {
      name: "Yusuf Karim",
      handle: "@yka_ops",
      company: "Meridian Logistics",
      color: "#22c55e",
    },
    topic: "Webhook keeps retrying the delivery status",
    status: "pending",
    queue: "support",
    assignee: null,
    unread: 2,
    messages: [
      { author: "contact", text: "Our webhook is receiving the same delivery event four or five times. Any idea why?", minutesAgo: 49 },
      { author: "agent", text: "Most likely a slow 200 response on your side — we retry after 5s. Can you return 200 before processing?", minutesAgo: 42 },
      { author: "contact", text: "Trying that now. If it still fails, can we jump on a quick call?", minutesAgo: 38 },
    ],
  },
  {
    channel: "tiktok",
    contact: {
      name: "Sofia Reyes",
      handle: "@sofiareyes",
      company: "Retail buyer, 96k followers",
      color: "#ec4899",
    },
    topic: "Where do I find the pricing page?",
    status: "resolved",
    queue: "sales",
    assignee: null,
    unread: 0,
    messages: [
      { author: "contact", text: "Saw the stitch video — where's the pricing page? The link in bio goes to the blog.", minutesAgo: 68 },
      { author: "agent", text: "Good catch, the bio link was stale. Fixed it and here's the direct link: wax.app/pricing", minutesAgo: 62 },
      { author: "contact", text: "Perfect, thank you!", minutesAgo: 61 },
    ],
  },
  {
    channel: "youtube",
    contact: {
      name: "Marcus Devlin",
      handle: "Comment on “Omnichannel in 6 minutes”",
      company: "Subscriber since 2023",
      color: "#f43f5e",
    },
    topic: "Question about SIP trunking",
    status: "open",
    queue: "support",
    assignee: null,
    unread: 0,
    messages: [
      { author: "contact", text: "Does Wax support bringing our own SIP trunk, or do we have to use your numbers?", minutesAgo: 130 },
      { author: "agent", text: "Both. Bring your own trunk via BYOC, or use our numbers in 42 countries. Happy to walk through it.", minutesAgo: 122 },
    ],
  },
];

const calls: {
  caller: string;
  company: string;
  hold: string;
  channel: ChannelId;
  direction: string;
  state: string;
  queue: "support" | "sales";
  assignee: "owner" | null;
}[] = [
  { caller: "Amara Okafor", company: "Northwind Retail", hold: "0:42", channel: "whatsapp", direction: "inbound", state: "on call", queue: "support", assignee: "owner" },
  { caller: "Hélène Dubois", company: "Lumière Studios", hold: "1:12", channel: "telegram", direction: "inbound", state: "waiting", queue: "sales", assignee: null },
  { caller: "Tomás Silva", company: "Vertex Health", hold: "0:08", channel: "x", direction: "inbound", state: "ringing", queue: "support", assignee: null },
  { caller: "Priya Raman", company: "Wax (outbound)", hold: "—", channel: "instagram", direction: "outbound", state: "waiting", queue: "sales", assignee: null },
];

const meetings = [
  { title: "Northwind rollout kickoff", startsAt: "18:04", duration: "45 min", host: "Amara Okafor", attendees: ["AO", "YK", "PR"], status: "live", channel: "whatsapp" },
  { title: "Creator launch stream rehearsal", startsAt: "11:30", duration: "30 min", host: "Diego Marín", attendees: ["DM", "PR"], status: "next", channel: "instagram" },
  { title: "Meridian webhook triage", startsAt: "13:00", duration: "20 min", host: "Yusuf Karim", attendees: ["YK", "SM"], status: "scheduled", channel: "telegram" },
  { title: "Weekly support review", startsAt: "16:15", duration: "40 min", host: "Internal", attendees: ["PR", "SM", "YO"], status: "scheduled", channel: "x" },
];

/**
 * Creates a workspace for a new account, with a populated desk so the dashboard
 * has something to show. Every account gets its own copy — nothing is shared.
 */
export function provisionWorkspace({
  userId,
  userName,
  companyName,
}: {
  userId: string;
  userName: string;
  companyName: string;
}) {
  const workspaceId = randomUUID();
  const now = Date.now();
  const workspaceName =
    companyName.trim() ||
    `${userName.split(" ")[0] || "New"}'s workspace`;

  db.prepare(
    "INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)",
  ).run(workspaceId, workspaceName, now);

  db.prepare(
    "INSERT INTO memberships (workspace_id, user_id, role) VALUES (?, ?, 'owner')",
  ).run(workspaceId, userId);

  const insertChannel = db.prepare(
    "INSERT INTO channels (workspace_id, id, name, handle, monogram, color, connected) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  for (const channel of channels) {
    insertChannel.run(
      workspaceId,
      channel.id,
      channel.name,
      channel.handle,
      channel.monogram,
      channel.color,
      channel.connected ? 1 : 0,
    );
  }

  const insertQueue = db.prepare(
    "INSERT INTO queues (id, workspace_id, name, sla_minutes, color, position) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const queueIds: Record<string, { id: string; slaMinutes: number }> = {};
  queues.forEach((queue, index) => {
    const id = randomUUID();
    insertQueue.run(
      id,
      workspaceId,
      queue.name,
      queue.slaMinutes,
      queue.color,
      index,
    );
    queueIds[queue.key] = { id, slaMinutes: queue.slaMinutes };
  });

  db.prepare(
    "INSERT INTO agent_presence (workspace_id, user_id, status, updated_at) VALUES (?, ?, 'available', ?)",
  ).run(workspaceId, userId, now);

  const insertContact = db.prepare(
    "INSERT INTO contacts (id, workspace_id, name, handle, company, color) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertConversation = db.prepare(
    `INSERT INTO conversations
       (id, workspace_id, channel_id, contact_id, topic, status, assignee_user_id,
        queue_id, first_response_at, sla_due_at, unread, last_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertMessage = db.prepare(
    "INSERT INTO messages (id, conversation_id, author, body, created_at, status) VALUES (?, ?, ?, ?, ?, 'sent')",
  );

  for (const seed of conversations) {
    const contactId = randomUUID();
    insertContact.run(
      contactId,
      workspaceId,
      seed.contact.name,
      seed.contact.handle,
      seed.contact.company,
      seed.contact.color,
    );

    const conversationId = randomUUID();
    const lastAt = now - Math.min(...seed.messages.map((m) => m.minutesAgo)) * 60_000;
    const queue = queueIds[seed.queue];
    const resolved = seed.status === "resolved";

    insertConversation.run(
      conversationId,
      workspaceId,
      seed.channel,
      contactId,
      seed.topic,
      seed.status,
      seed.assignee === "owner" ? userId : null,
      queue.id,
      resolved ? lastAt : null,
      resolved ? null : lastAt + queue.slaMinutes * 60_000,
      seed.unread,
      lastAt,
    );

    for (const message of seed.messages) {
      insertMessage.run(
        randomUUID(),
        conversationId,
        message.author,
        message.text,
        now - message.minutesAgo * 60_000,
      );
    }
  }

  const insertCall = db.prepare(
    "INSERT INTO calls (id, workspace_id, caller, company, hold, channel_id, direction, state, queue_id, assignee_user_id, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  calls.forEach((call, index) => {
    insertCall.run(
      randomUUID(),
      workspaceId,
      call.caller,
      call.company,
      call.hold,
      call.channel,
      call.direction,
      call.state,
      queueIds[call.queue].id,
      call.assignee === "owner" ? userId : null,
      index,
    );
  });

  const insertMeeting = db.prepare(
    "INSERT INTO meetings (id, workspace_id, title, starts_at, duration, host, attendees, status, channel_id, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  meetings.forEach((meeting, index) => {
    insertMeeting.run(
      randomUUID(),
      workspaceId,
      meeting.title,
      meeting.startsAt,
      meeting.duration,
      meeting.host,
      JSON.stringify(meeting.attendees),
      meeting.status,
      meeting.channel,
      index,
    );
  });

  return workspaceId;
}
