/**
 * Calendar arithmetic, kept free of React and the database so the boundary and
 * conflict rules can be tested directly.
 *
 * Times are epoch milliseconds throughout; a block never crosses midnight,
 * which is enforced in `validateBlock`.
 */

export type BlockKind = "focus" | "meeting" | "admin" | "break";

export const BLOCK_KINDS: BlockKind[] = ["focus", "meeting", "admin", "break"];

export type TimeBlock = {
  id: string;
  userId: string;
  userName: string;
  title: string;
  kind: BlockKind;
  startAt: number;
  endAt: number;
  note: string | null;
  roomId: string | null;
};

export type WorkingWindow = { startMinute: number; endMinute: number };

/** Index 0 is Monday, matching how the week grid is laid out. */
export type WeeklyHours = (WorkingWindow | null)[];

export const DEFAULT_WINDOW: WorkingWindow = {
  startMinute: 9 * 60,
  endMinute: 17 * 60,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(ts: number) {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Monday-based weekday index. */
export function weekdayIndex(ts: number) {
  return (new Date(ts).getDay() + 6) % 7;
}

/** Midnight on the Monday of the week containing `ts`. */
export function startOfWeek(ts: number) {
  return startOfDay(ts) - weekdayIndex(ts) * DAY_MS;
}

export function addDays(ts: number, days: number) {
  return ts + days * DAY_MS;
}

export function defaultWeeklyHours(): WeeklyHours {
  return Array.from({ length: 7 }, (_, weekday) =>
    weekday === 5 || weekday === 6 ? null : { ...DEFAULT_WINDOW },
  );
}

/** `YYYY-MM-DD` in local time, for week links. */
export function isoDay(ts: number) {
  const date = new Date(ts);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/** Parses the `?week=` value; anything unrecognised falls back to today. */
export function parseWeekParam(value: string | undefined) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return Date.now();

  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    12,
  );
  return Number.isNaN(date.getTime()) ? Date.now() : date.getTime();
}

/** Everything the week view needs about which week to show. */
export function calendarWindow(week: string | undefined) {
  const today = startOfDay(Date.now());
  const weekStart = startOfWeek(parseWeekParam(week));

  return {
    today,
    weekStart,
    weekLabel: weekLabel(weekStart),
    prevWeek: isoDay(addDays(weekStart, -7)),
    nextWeek: isoDay(addDays(weekStart, 7)),
    thisWeek: isoDay(startOfWeek(today)),
  };
}

export function weekLabel(weekStart: number) {
  const format = (ts: number) =>
    new Date(ts).toLocaleDateString([], { day: "numeric", month: "short" });
  return `${format(weekStart)} – ${format(addDays(weekStart, 6))}`;
}

export function minutesToLabel(minute: number) {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function timeLabel(ts: number) {
  const date = new Date(ts);
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

export function overlaps(
  a: { startAt: number; endAt: number },
  b: { startAt: number; endAt: number },
) {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

/** Blocks that collide with `candidate`, optionally only for one person. */
export function conflictsFor(
  candidate: { id?: string; userId?: string; startAt: number; endAt: number },
  blocks: TimeBlock[],
  options: { sameUserOnly?: boolean } = {},
) {
  return blocks.filter(
    (block) =>
      block.id !== candidate.id &&
      (!options.sameUserOnly || block.userId === candidate.userId) &&
      overlaps(block, candidate),
  );
}

/**
 * Whether a block falls outside the person's working window. Used to draw the
 * boundary and to tell someone they are booking into their own off-hours.
 */
export function outsideWorkingHours(
  startAt: number,
  endAt: number,
  hours: WeeklyHours,
) {
  const dayStart = startOfDay(startAt);
  const window = hours[weekdayIndex(startAt)];
  if (!window) return true;
  return (
    endAt > dayStart + DAY_MS ||
    startAt < dayStart + window.startMinute * 60_000 ||
    endAt > dayStart + window.endMinute * 60_000
  );
}

/** Gaps inside a working window that a day's blocks leave free. */
export function freeRanges(
  dayBlocks: { startAt: number; endAt: number }[],
  window: WorkingWindow | null,
  dayStart: number,
): { startAt: number; endAt: number }[] {
  if (!window) return [];

  const busy = dayBlocks
    .map((block) => ({
      startAt: Math.max(block.startAt, dayStart + window.startMinute * 60_000),
      endAt: Math.min(block.endAt, dayStart + window.endMinute * 60_000),
    }))
    .filter((block) => block.startAt < block.endAt)
    .sort((a, b) => a.startAt - b.startAt);

  const ranges: { startAt: number; endAt: number }[] = [];
  let cursor = dayStart + window.startMinute * 60_000;
  const end = dayStart + window.endMinute * 60_000;

  for (const block of busy) {
    if (block.startAt > cursor) ranges.push({ startAt: cursor, endAt: block.startAt });
    cursor = Math.max(cursor, block.endAt);
  }
  if (cursor < end) ranges.push({ startAt: cursor, endAt: end });

  return ranges;
}

/** A message to show before saving, or null when the block is usable. */
export function validateBlock(input: {
  title: string;
  startAt: number;
  endAt: number;
  hours: WeeklyHours;
}) {
  const title = input.title.trim();

  if (!title) return "Give the block a title.";
  if (title.length > 120) return "Keep the title under 120 characters.";
  if (!Number.isFinite(input.startAt) || !Number.isFinite(input.endAt)) {
    return "Pick a start and end time.";
  }
  if (input.endAt <= input.startAt) return "The block must end after it starts.";
  if (input.endAt - input.startAt > 12 * 60 * 60 * 1000) {
    return "Blocks are limited to 12 hours.";
  }
  if (startOfDay(input.startAt) !== startOfDay(input.endAt)) {
    return "A block has to start and end on the same day.";
  }
  if (outsideWorkingHours(input.startAt, input.endAt, input.hours)) {
    return "That time is outside your working hours. Adjust your hours first if you meant to work then.";
  }
  return null;
}
