"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { requireUser } from "@/app/lib/auth/auth";
import { createRoom } from "@/app/lib/rooms/store";
import {
  BLOCK_KINDS,
  conflictsFor,
  isValidTimeZone,
  validateBlock,
  zonedTimeLabel,
  type BlockKind,
  type WeeklyHours,
} from "./rules";
import {
  deleteBlock,
  insertBlock,
  listBlocks,
  saveWeeklyHours,
  setUserTimeZone,
  weeklyHours,
} from "./store";

export type BlockResult =
  | { ok: true; notice: string | null }
  | { ok: false; error: string };

/**
 * Books a block for the signed-in person. The server re-checks the window and
 * clashes the browser already warned about, because a stale tab must not be
 * able to write a double booking.
 */
export async function createBlockAction(input: {
  title: string;
  kind: string;
  startAt: number;
  endAt: number;
  note?: string;
}): Promise<BlockResult> {
  const user = await requireUser();
  const kind = (BLOCK_KINDS as string[]).includes(input.kind)
    ? (input.kind as BlockKind)
    : "focus";

  // The window belongs to the booker, so it is read in their own zone.
  const hours = weeklyHours(user.workspaceId, user.id);
  const problem = validateBlock(
    {
      title: input.title,
      startAt: input.startAt,
      endAt: input.endAt,
      hours,
    },
    user.timeZone,
  );
  if (problem) return { ok: false, error: problem };

  const from = Math.min(input.startAt, input.endAt) - 1;
  const to = Math.max(input.startAt, input.endAt) + 1;
  const blocks = listBlocks(user.workspaceId, from, to);

  const mine = conflictsFor(
    { userId: user.id, startAt: input.startAt, endAt: input.endAt },
    blocks,
    { sameUserOnly: true },
  );
  if (mine.length > 0) {
    return {
      ok: false,
      error: `That clashes with “${mine[0].title}” at ${zonedTimeLabel(
        mine[0].startAt,
        user.timeZone,
      )}.`,
    };
  }

  const roomId =
    kind === "meeting"
      ? createRoom({
          id: randomUUID(),
          workspaceId: user.workspaceId,
          name: input.title.trim(),
          createdBy: user.id,
        })
      : null;

  insertBlock({
    id: randomUUID(),
    workspaceId: user.workspaceId,
    userId: user.id,
    title: input.title.trim(),
    kind,
    startAt: input.startAt,
    endAt: input.endAt,
    note: input.note?.trim() ? input.note.trim() : null,
    roomId,
  });

  const theirs = conflictsFor(
    { userId: user.id, startAt: input.startAt, endAt: input.endAt },
    blocks,
  ).filter((block) => block.userId !== user.id);

  refresh();

  return {
    ok: true,
    notice: theirs.length
      ? `Overlaps ${theirs[0].userName}’s “${theirs[0].title}”. They can see it on the team lane.`
      : null,
  };
}

export async function deleteBlockAction(id: string): Promise<BlockResult> {
  const user = await requireUser();

  if (!deleteBlock(user.workspaceId, id, user.id)) {
    return { ok: false, error: "That block is not yours to remove." };
  }

  refresh();
  return { ok: true, notice: null };
}

/**
 * Saves the working window for the chosen weekdays. Everything else becomes a
 * boundary that the grid shades and refuses to book into.
 */
export async function saveHoursAction(input: {
  days: number[];
  startMinute: number;
  endMinute: number;
}): Promise<BlockResult> {
  const user = await requireUser();

  if (input.endMinute <= input.startMinute) {
    return { ok: false, error: "Your day has to end after it starts." };
  }
  if (input.startMinute < 0 || input.endMinute > 24 * 60) {
    return { ok: false, error: "Pick times between 00:00 and 24:00." };
  }

  const days = input.days.filter((day) => day >= 0 && day <= 6);
  const hours = Array.from({ length: 7 }, (_, weekday) =>
    days.includes(weekday)
      ? { startMinute: input.startMinute, endMinute: input.endMinute }
      : null,
  ) as WeeklyHours;

  saveWeeklyHours(user.workspaceId, user.id, hours);
  refresh();
  return { ok: true, notice: null };
}

/**
 * Switches the zone this person's calendar is read in. Blocks are stored as
 * instants, so nothing moves; their wall-clock labels and their working window
 * are re-read against the new zone.
 */
export async function saveTimeZoneAction(timeZone: string): Promise<BlockResult> {
  const user = await requireUser();

  if (!isValidTimeZone(timeZone)) {
    return { ok: false, error: "That time zone is not recognised." };
  }
  if (timeZone === user.timeZone) {
    return { ok: true, notice: null };
  }

  if (!setUserTimeZone(user.workspaceId, user.id, timeZone)) {
    return { ok: false, error: "That time zone could not be saved." };
  }

  refresh();
  return { ok: true, notice: `Calendar now shows times in ${timeZone}.` };
}
