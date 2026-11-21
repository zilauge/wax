import "server-only";

import { db } from "@/app/lib/db/db";

export type Room = { id: string; name: string };

export function createRoom(input: {
  id: string;
  workspaceId: string;
  name: string;
  createdBy: string;
}) {
  db.prepare(
    `INSERT OR IGNORE INTO rooms (id, workspace_id, name, created_by, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(input.id, input.workspaceId, input.name, input.createdBy, Date.now());
  return input.id;
}

/**
 * Resolves a room the caller may enter. A meeting is also a room: opening
 * `/rooms/<meeting id>` creates the durable row the first time it is used, so
 * scheduled meetings do not need a second record.
 */
export function roomInWorkspace(roomId: string, workspaceId: string): Room | null {
  const row = db
    .prepare(
      "SELECT id, name FROM rooms WHERE id = ? AND workspace_id = ? AND closed_at IS NULL",
    )
    .get(roomId, workspaceId);

  if (row) return { id: String(row.id), name: String(row.name) };

  const meeting = db
    .prepare("SELECT id, title FROM meetings WHERE id = ? AND workspace_id = ?")
    .get(roomId, workspaceId);

  if (!meeting) return null;

  createRoom({
    id: String(meeting.id),
    workspaceId,
    name: String(meeting.title),
    createdBy: "system",
  });

  return { id: String(meeting.id), name: String(meeting.title) };
}

/** Rooms created in the last day, so the meetings tab can offer a way back in. */
export function recentRooms(workspaceId: string) {
  return db
    .prepare(
      `SELECT id, name, created_at FROM rooms
       WHERE workspace_id = ? AND closed_at IS NULL
       ORDER BY created_at DESC LIMIT 8`,
    )
    .all(workspaceId)
    .map((row) => ({
      id: String(row.id),
      name: String(row.name),
      createdAt: Number(row.created_at),
    }));
}
