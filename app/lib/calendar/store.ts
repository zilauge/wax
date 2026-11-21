import "server-only";

import { db } from "@/app/lib/db/db";
import {
  defaultWeeklyHours,
  type BlockKind,
  type TimeBlock,
  type WeeklyHours,
} from "./rules";

function text(value: unknown) {
  return value == null ? "" : String(value);
}

function toBlock(row: Record<string, unknown>): TimeBlock {
  return {
    id: text(row.id),
    userId: text(row.user_id),
    userName: text(row.user_name),
    title: text(row.title),
    kind: text(row.kind) as BlockKind,
    startAt: Number(row.start_at),
    endAt: Number(row.end_at),
    note: row.note ? text(row.note) : null,
    roomId: row.room_id ? text(row.room_id) : null,
  };
}

/** Blocks overlapping a window, across the whole workspace for team views. */
export function listBlocks(workspaceId: string, from: number, to: number) {
  return db
    .prepare(
      `SELECT b.id, b.user_id, u.name AS user_name, b.title, b.kind,
              b.start_at, b.end_at, b.note, b.room_id
       FROM calendar_blocks b
       JOIN users u ON u.id = b.user_id
       WHERE b.workspace_id = ? AND b.start_at < ? AND b.end_at > ?
       ORDER BY b.start_at`,
    )
    .all(workspaceId, to, from)
    .map((row) => toBlock(row as Record<string, unknown>));
}

export function insertBlock(input: {
  id: string;
  workspaceId: string;
  userId: string;
  title: string;
  kind: BlockKind;
  startAt: number;
  endAt: number;
  note: string | null;
  roomId: string | null;
}) {
  db.prepare(
    `INSERT INTO calendar_blocks
       (id, workspace_id, user_id, title, kind, start_at, end_at, note, room_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.workspaceId,
    input.userId,
    input.title,
    input.kind,
    input.startAt,
    input.endAt,
    input.note,
    input.roomId,
    Date.now(),
  );
}

/** Only the person who booked a block can remove it. */
export function deleteBlock(workspaceId: string, id: string, userId: string) {
  return (
    db
      .prepare(
        "DELETE FROM calendar_blocks WHERE workspace_id = ? AND id = ? AND user_id = ?",
      )
      .run(workspaceId, id, userId).changes > 0
  );
}

export function weeklyHours(workspaceId: string, userId: string): WeeklyHours {
  const rows = db
    .prepare(
      "SELECT weekday, start_minute, end_minute FROM calendar_hours WHERE workspace_id = ? AND user_id = ?",
    )
    .all(workspaceId, userId);

  if (rows.length === 0) return defaultWeeklyHours();

  const hours = defaultWeeklyHours().map(() => null) as WeeklyHours;
  for (const row of rows) {
    const weekday = Number(row.weekday);
    if (weekday < 0 || weekday > 6) continue;
    hours[weekday] = {
      startMinute: Number(row.start_minute),
      endMinute: Number(row.end_minute),
    };
  }
  return hours;
}

/** Replaces the whole week, so clearing a day is the same write as moving it. */
export function saveWeeklyHours(
  workspaceId: string,
  userId: string,
  hours: WeeklyHours,
) {
  db.prepare(
    "DELETE FROM calendar_hours WHERE workspace_id = ? AND user_id = ?",
  ).run(workspaceId, userId);

  const insert = db.prepare(
    `INSERT INTO calendar_hours (workspace_id, user_id, weekday, start_minute, end_minute)
     VALUES (?, ?, ?, ?, ?)`,
  );

  hours.forEach((window, weekday) => {
    if (!window) return;
    insert.run(workspaceId, userId, weekday, window.startMinute, window.endMinute);
  });
}
