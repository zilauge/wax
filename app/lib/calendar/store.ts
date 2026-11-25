import "server-only";

import { db } from "@/app/lib/db/db";
import {
  defaultWeeklyHours,
  resolveTimeZone,
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
    userTimeZone: row.user_timezone ? text(row.user_timezone) : null,
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
      `SELECT b.id, b.user_id, u.name AS user_name, u.timezone AS user_timezone,
              b.title, b.kind, b.start_at, b.end_at, b.note, b.room_id
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

/** The server clock, read outside the component so rendering stays pure. */
export function calendarNow() {
  return Date.now();
}

export type CalendarTeamMember = {
  id: string;
  name: string;
  timeZone: string;
  hours: WeeklyHours;
};

/**
 * Teammates with the zone their calendar is read in and their own working
 * window. The team lane needs both: a block in Tokyo is only "today" in Tokyo.
 */
export function listCalendarTeam(workspaceId: string): CalendarTeamMember[] {
  return db
    .prepare(
      `SELECT u.id, u.name, u.timezone
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ?
       ORDER BY u.name`,
    )
    .all(workspaceId)
    .map((row) => ({
      id: String(row.id),
      name: String(row.name),
      timeZone: resolveTimeZone(row.timezone ? String(row.timezone) : null),
      hours: weeklyHours(workspaceId, String(row.id)),
    }));
}

/** Sets the caller's own zone; the membership check keeps it workspace-scoped. */
export function setUserTimeZone(
  workspaceId: string,
  userId: string,
  timeZone: string,
) {
  const member = db
    .prepare("SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ?")
    .get(workspaceId, userId);
  if (!member) return 0;

  return db
    .prepare("UPDATE users SET timezone = ? WHERE id = ?")
    .run(timeZone, userId).changes;
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
