/**
 * Calendar arithmetic, kept free of React and the database so the boundary and
 * conflict rules can be tested directly.
 *
 * Times are epoch milliseconds throughout; a block never crosses midnight,
 * which is enforced in `validateBlock`.
 *
 * Every "wall clock" question — which day is it, what time is it, where does
 * midnight fall — is answered in an explicit IANA time zone. That is what makes
 * a block booked by someone in Nairobi line up correctly in a London teammate's
 * week view. Functions default to the runtime zone when none is given.
 */

export type BlockKind = "focus" | "meeting" | "admin" | "break";

export const BLOCK_KINDS: BlockKind[] = ["focus", "meeting", "admin", "break"];

export type TimeBlock = {
  id: string;
  userId: string;
  userName: string;
  /** The owner's zone, so a reading of this block can be shown in their time. */
  userTimeZone?: string | null;
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
const DAY_MINUTES = 24 * 60;

export function systemTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function isValidTimeZone(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Falls back to the runtime zone rather than throwing on stored junk. */
export function resolveTimeZone(value: string | null | undefined) {
  return isValidTimeZone(value) ? value : systemTimeZone();
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** Monday-based weekday index. */
  weekday: number;
};

/** The wall clock reading of `ts` in `timeZone`. */
export function partsIn(ts: number, timeZone: string): ZonedParts {
  const values: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(ts))) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const hour = Number(values.hour) % 24;

  return {
    year,
    month,
    day,
    hour,
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7,
  };
}

/** How far ahead of UTC the zone is at `ts`, in milliseconds. */
function offsetMs(ts: number, timeZone: string) {
  const parts = partsIn(ts, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/**
 * Converts a wall-clock instant (expressed as if it were UTC) to a real epoch.
 * Two passes settle the offset, including on the days DST changes.
 */
function wallToEpoch(wallMs: number, timeZone: string) {
  const firstGuess = wallMs - offsetMs(wallMs, timeZone);
  return wallMs - offsetMs(firstGuess, timeZone);
}

/** Midnight at the start of `ts`'s day, in `timeZone`. */
export function zonedDayStart(ts: number, timeZone: string) {
  const parts = partsIn(ts, timeZone);
  return wallToEpoch(Date.UTC(parts.year, parts.month - 1, parts.day), timeZone);
}

/** Day starts for `count` consecutive days beginning at `ts`'s day. */
export function zonedDayStarts(ts: number, timeZone: string, count = 7) {
  const parts = partsIn(ts, timeZone);
  return Array.from({ length: count }, (_, index) =>
    wallToEpoch(Date.UTC(parts.year, parts.month - 1, parts.day + index), timeZone),
  );
}

/** Adds calendar days to a day-start epoch without assuming 24-hour days. */
export function zonedAddDays(ts: number, days: number, timeZone: string) {
  const parts = partsIn(ts, timeZone);
  return wallToEpoch(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
    timeZone,
  );
}

export function zonedWeekday(ts: number, timeZone: string) {
  return partsIn(ts, timeZone).weekday;
}

/** Minutes since local midnight in `timeZone`. */
export function zonedMinutes(ts: number, timeZone: string) {
  const parts = partsIn(ts, timeZone);
  return parts.hour * 60 + parts.minute;
}

export function zonedTimeLabel(ts: number, timeZone: string) {
  const parts = partsIn(ts, timeZone);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

/** "GMT+3" style label for a zone at a given instant. */
export function zoneAbbreviation(ts: number, timeZone: string) {
  try {
    const part = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(new Date(ts))
      .find((entry) => entry.type === "timeZoneName");
    return part?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

export function startOfDay(ts: number, timeZone = systemTimeZone()) {
  return zonedDayStart(ts, timeZone);
}

/** Monday-based weekday index. */
export function weekdayIndex(ts: number, timeZone = systemTimeZone()) {
  return zonedWeekday(ts, timeZone);
}

/** Midnight on the Monday of the week containing `ts`. */
export function startOfWeek(ts: number, timeZone = systemTimeZone()) {
  const dayStart = startOfDay(ts, timeZone);
  return zonedAddDays(dayStart, -weekdayIndex(ts, timeZone), timeZone);
}

export function addDays(ts: number, days: number) {
  return ts + days * DAY_MS;
}

export function defaultWeeklyHours(): WeeklyHours {
  return Array.from({ length: 7 }, (_, weekday) =>
    weekday === 5 || weekday === 6 ? null : { ...DEFAULT_WINDOW },
  );
}

/** `YYYY-MM-DD` in the given zone, for week links. */
export function isoDay(ts: number, timeZone = systemTimeZone()) {
  const parts = partsIn(ts, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(
    parts.day,
  ).padStart(2, "0")}`;
}

/** Parses the `?week=` value; anything unrecognised falls back to today. */
export function parseWeekParam(value: string | undefined, timeZone = systemTimeZone()) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return Date.now();

  const wall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return Number.isNaN(wall) ? Date.now() : wallToEpoch(wall, timeZone);
}

/** Everything the week view needs about which week to show. */
export function calendarWindow(
  week: string | undefined,
  timeZone = systemTimeZone(),
) {
  const today = startOfDay(Date.now(), timeZone);
  const weekStart = startOfWeek(parseWeekParam(week, timeZone), timeZone);

  return {
    today,
    weekStart,
    weekLabel: weekLabel(weekStart, timeZone),
    prevWeek: isoDay(zonedAddDays(weekStart, -7, timeZone), timeZone),
    nextWeek: isoDay(zonedAddDays(weekStart, 7, timeZone), timeZone),
    thisWeek: isoDay(startOfWeek(today, timeZone), timeZone),
  };
}

export function weekLabel(weekStart: number, timeZone = systemTimeZone()) {
  const format = (ts: number) =>
    new Date(ts).toLocaleDateString([], {
      day: "numeric",
      month: "short",
      timeZone,
    });
  return `${format(weekStart)} – ${format(zonedAddDays(weekStart, 6, timeZone))}`;
}

export function minutesToLabel(minute: number) {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function timeLabel(ts: number, timeZone = systemTimeZone()) {
  return zonedTimeLabel(ts, timeZone);
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
 * Whether a block falls outside the working window of the person it belongs to.
 * The weekday and the window edges are read in their zone, not the viewer's.
 */
export function outsideWorkingHours(
  startAt: number,
  endAt: number,
  hours: WeeklyHours,
  timeZone = systemTimeZone(),
) {
  const window = hours[zonedWeekday(startAt, timeZone)];
  if (!window) return true;

  const dayStart = zonedDayStart(startAt, timeZone);
  const nextDayStart = zonedDayStarts(startAt, timeZone, 2)[1];

  return (
    endAt > nextDayStart ||
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
export function validateBlock(
  input: {
    title: string;
    startAt: number;
    endAt: number;
    hours: WeeklyHours;
  },
  timeZone = systemTimeZone(),
) {
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
  if (zonedDayStart(input.startAt, timeZone) !== zonedDayStart(input.endAt, timeZone)) {
    return "A block has to start and end on the same day.";
  }
  if (outsideWorkingHours(input.startAt, input.endAt, input.hours, timeZone)) {
    return "That time is outside your working hours. Adjust your hours first if you meant to work then.";
  }
  return null;
}

/** Kept for callers that only need the constant. */
export const MINUTES_PER_DAY = DAY_MINUTES;
