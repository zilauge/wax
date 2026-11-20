import "server-only";

import { randomUUID } from "node:crypto";
import { db } from "@/app/lib/db/db";
import type { ChannelId } from "@/app/lib/types";

/**
 * Channel catalogue for a new workspace. Nothing is marked connected: a social
 * account only becomes connected once its OAuth callback stores real tokens,
 * and Telegram only when a bot is bound and its token is configured.
 */
const channels: {
  id: ChannelId;
  name: string;
  monogram: string;
  color: string;
}[] = [
  { id: "instagram", name: "Instagram", monogram: "Ig", color: "#e1306c" },
  { id: "tiktok", name: "TikTok", monogram: "Tk", color: "#25f4ee" },
  { id: "whatsapp", name: "WhatsApp", monogram: "Wa", color: "#25d366" },
  { id: "x", name: "X", monogram: "X", color: "#e7e9ea" },
  { id: "telegram", name: "Telegram", monogram: "Tg", color: "#2aabee" },
  { id: "youtube", name: "YouTube", monogram: "Yt", color: "#ff0033" },
];

const queues = [
  { key: "support" as const, name: "Support", slaMinutes: 15, color: "#22c55e" },
  { key: "sales" as const, name: "Sales", slaMinutes: 60, color: "#6366f1" },
];

/**
 * Creates a workspace for a new account with its queues and channel catalogue,
 * and no conversations, calls or meetings. Every account starts with an empty
 * desk, so nothing on screen is fabricated.
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
    "INSERT INTO channels (workspace_id, id, name, handle, monogram, color, connected) VALUES (?, ?, ?, '', ?, ?, 0)",
  );
  for (const channel of channels) {
    insertChannel.run(
      workspaceId,
      channel.id,
      channel.name,
      channel.monogram,
      channel.color,
    );
  }

  const insertQueue = db.prepare(
    "INSERT INTO queues (id, workspace_id, name, sla_minutes, color, position) VALUES (?, ?, ?, ?, ?, ?)",
  );
  queues.forEach((queue, index) => {
    insertQueue.run(
      randomUUID(),
      workspaceId,
      queue.name,
      queue.slaMinutes,
      queue.color,
      index,
    );
  });

  db.prepare(
    "INSERT INTO agent_presence (workspace_id, user_id, status, updated_at) VALUES (?, ?, 'available', ?)",
  ).run(workspaceId, userId, now);

  return workspaceId;
}
