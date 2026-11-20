export type ChannelId =
  | "instagram"
  | "tiktok"
  | "whatsapp"
  | "x"
  | "telegram"
  | "youtube";

export type Channel = {
  id: ChannelId;
  name: string;
  handle: string;
  monogram: string;
  color: string;
  connected: boolean;
  unread: number;
};

export type MessageAuthor = "agent" | "contact";

export type MessageStatus = "sent" | "failed";

export type Message = {
  id: string;
  author: MessageAuthor;
  text: string;
  time: string;
  /** Delivery outcome for agent messages; seeded inbound messages are "sent". */
  status: MessageStatus;
  error?: string | null;
};

export type ConversationStatus = "open" | "pending" | "resolved";

export type Contact = {
  name: string;
  handle: string;
  company: string;
  color: string;
};

export type PresenceStatus = "available" | "busy" | "away";

/** A teammate in the current workspace, with live presence and workload. */
export type Agent = {
  id: string;
  name: string;
  role: "owner" | "admin" | "agent";
  presence: PresenceStatus;
  /** Conversations currently assigned to this person that are not resolved. */
  active: number;
};

export type Queue = {
  id: string;
  name: string;
  slaMinutes: number;
  color: string;
  /** Unresolved conversations sitting in this queue. */
  open: number;
  /** Of those, how many are past their first-reply deadline. */
  breaching: number;
};

/** First-response SLA state for one conversation. */
export type Sla = {
  state: "met" | "due" | "breached";
  label: string;
};

export type Conversation = {
  id: string;
  channel: ChannelId;
  contact: Contact;
  topic: string;
  status: ConversationStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  queueId: string | null;
  queueName: string | null;
  queueColor: string | null;
  sla: Sla | null;
  lastAt: string;
  unread: number;
  messages: Message[];
};

export type Meeting = {
  id: string;
  title: string;
  startsAt: string;
  duration: string;
  host: string;
  attendees: string[];
  status: "live" | "next" | "scheduled";
  channel: ChannelId;
};

export type Call = {
  id: string;
  caller: string;
  company: string;
  hold: string;
  channel: ChannelId;
  direction: "inbound" | "outbound";
  state: "ringing" | "waiting" | "on call";
  /** Calls use the same queue and assignee model as conversations. */
  queueId: string | null;
  queueName: string | null;
  queueColor: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
};

export type Metric = {
  label: string;
  value: string;
  delta: string;
  tone: "up" | "neutral";
};

/** The signed-in person, as handed to the client shell. */
export type WorkspaceUser = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "agent";
  workspaceName: string;
};

/** Headline totals that the metric cards and navigation badges share. */
export type Summary = {
  openConversations: number;
  callsInProgress: number;
  meetingsToday: number;
};

/** Which bot feeds this workspace, and whether outbound sending is configured. */
export type TelegramRouting = {
  bound: boolean;
  botUsername: string | null;
  boundAt: string | null;
  tokenConfigured: boolean;
};

/** Everything the dashboard renders, read from a single server-side load. */
export type WorkspaceData = {
  channels: Channel[];
  conversations: Conversation[];
  calls: Call[];
  meetings: Meeting[];
  agents: Agent[];
  queues: Queue[];
  telegram: TelegramRouting;
  metrics: Metric[];
  summary: Summary;
};
