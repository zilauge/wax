import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays,
  conflictsFor,
  defaultWeeklyHours,
  freeRanges,
  isoDay,
  isValidTimeZone,
  outsideWorkingHours,
  overlaps,
  parseWeekParam,
  resolveTimeZone,
  startOfDay,
  startOfWeek,
  validateBlock,
  systemTimeZone,
  weekdayIndex,
  zonedDayStarts,
  zonedTimeLabel,
  zonedWeekday,
  type TimeBlock,
  type WeeklyHours,
} from "../app/lib/calendar/rules.ts";

const DAY = 24 * 60 * 60 * 1000;
const at = (weekday: string, hour: number, minute = 0) => {
  const base = new Date(`2026-11-${weekday}T00:00:00`);
  base.setHours(hour, minute, 0, 0);
  return base.getTime();
};

const block = (overrides: Partial<TimeBlock>): TimeBlock => ({
  id: "b1",
  userId: "u1",
  userName: "Moses",
  title: "Deep work",
  kind: "focus",
  startAt: at("17", 9),
  endAt: at("17", 10),
  note: null,
  roomId: null,
  ...overrides,
});

test("overlaps only counts real overlaps, not touching edges", () => {
  const a = { startAt: at("17", 9), endAt: at("17", 10) };
  assert.equal(overlaps(a, { startAt: at("17", 9, 30), endAt: at("17", 10, 30) }), true);
  assert.equal(overlaps(a, { startAt: at("17", 10), endAt: at("17", 11) }), false);
  assert.equal(overlaps(a, { startAt: at("17", 8), endAt: at("17", 9) }), false);
});

test("a double booking with yourself is a conflict, a teammate overlap is separate", () => {
  const mine = block({ id: "mine", userId: "me", startAt: at("17", 9), endAt: at("17", 10) });
  const teammate = block({ id: "theirs", userId: "them", startAt: at("17", 9, 30), endAt: at("17", 11) });
  const candidate = { userId: "me", startAt: at("17", 9, 45), endAt: at("17", 10, 15) };

  const all = conflictsFor(candidate, [mine, teammate]);
  assert.deepEqual(all.map((entry) => entry.id), ["mine", "theirs"]);

  const own = conflictsFor(candidate, [mine, teammate], { sameUserOnly: true });
  assert.deepEqual(own.map((entry) => entry.id), ["mine"]);
});

test("the same block is never in conflict with itself", () => {
  const existing = block({ id: "b1" });
  assert.equal(conflictsFor({ id: "b1", startAt: existing.startAt, endAt: existing.endAt }, [existing]).length, 0);
});

test("working hours default to weekdays and mark the weekend as off", () => {
  const hours = defaultWeeklyHours();
  assert.equal(hours.length, 7);
  assert.deepEqual(hours[0], { startMinute: 540, endMinute: 1020 });
  assert.equal(hours[5], null);
  assert.equal(hours[6], null);

  assert.equal(outsideWorkingHours(at("17", 10), at("17", 11), hours), false);
  assert.equal(outsideWorkingHours(at("17", 8), at("17", 9), hours), true);
  assert.equal(outsideWorkingHours(at("17", 16), at("17", 18), hours), true);
});

test("a day with no window is entirely outside working hours", () => {
  const hours = defaultWeeklyHours();
  assert.equal(outsideWorkingHours(at("21", 10), at("21", 11), hours), true);
});

test("free ranges are the gaps inside the window", () => {
  const dayStart = at("17", 0);
  const ranges = freeRanges(
    [
      { startAt: at("17", 9), endAt: at("17", 10) },
      { startAt: at("17", 13), endAt: at("17", 14) },
    ],
    { startMinute: 540, endMinute: 1020 },
    dayStart,
  );

  assert.deepEqual(
    ranges.map((range) => [
      (range.startAt - dayStart) / 60000,
      (range.endAt - dayStart) / 60000,
    ]),
    [
      [600, 780],
      [840, 1020],
    ],
  );
});

test("blocks that run into the window still leave the right gaps", () => {
  const dayStart = at("17", 0);
  const ranges = freeRanges(
    [{ startAt: at("17", 8), endAt: at("17", 11) }],
    { startMinute: 540, endMinute: 1020 },
    dayStart,
  );
  assert.deepEqual(
    ranges.map((range) => [
      (range.startAt - dayStart) / 60000,
      (range.endAt - dayStart) / 60000,
    ]),
    [[660, 1020]],
  );
});

test("validation rejects empty, inverted, cross-day and out-of-hours blocks", () => {
  const hours = defaultWeeklyHours();

  assert.equal(
    validateBlock({ title: "  ", startAt: at("17", 9), endAt: at("17", 10), hours }),
    "Give the block a title.",
  );
  assert.equal(
    validateBlock({ title: "x", startAt: at("17", 10), endAt: at("17", 10), hours }),
    "The block must end after it starts.",
  );
  assert.equal(
    validateBlock({
      title: "x",
      startAt: at("17", 7),
      endAt: at("17", 8),
      hours,
    }),
    "That time is outside your working hours. Adjust your hours first if you meant to work then.",
  );
  // A block that crosses midnight is rejected before the window is checked.
  assert.equal(
    validateBlock({
      title: "x",
      startAt: at("17", 23),
      endAt: at("18", 1),
      hours: Array.from({ length: 7 }, () => ({
        startMinute: 0,
        endMinute: 1440,
      })) as WeeklyHours,
    }),
    "A block has to start and end on the same day.",
  );
});

test("a valid block inside the window returns no problem", () => {
  assert.equal(
    validateBlock({
      title: "Weekly review",
      startAt: at("17", 14),
      endAt: at("17", 15),
      hours: defaultWeeklyHours(),
    }),
    null,
  );
});

test("weeks start on Monday and the week param round-trips", () => {
  const wednesday = at("18", 12);
  assert.equal(weekdayIndex(wednesday), 2);

  const monday = startOfWeek(wednesday);
  assert.equal(weekdayIndex(monday), 0);
  assert.equal(startOfDay(monday), monday);
  assert.equal(addDays(monday, 6) - monday, 6 * DAY);

  assert.equal(parseWeekParam(isoDay(monday)) !== undefined, true);
  assert.equal(weekdayIndex(parseWeekParam(isoDay(monday))), 0);
  assert.ok(parseWeekParam("not-a-week") > 0);
});

test("the same instant reads differently in each zone", () => {
  const instant = Date.UTC(2026, 10, 23, 9, 0);

  assert.equal(zonedTimeLabel(instant, "UTC"), "09:00");
  assert.equal(zonedTimeLabel(instant, "Europe/London"), "09:00");
  assert.equal(zonedTimeLabel(instant, "Europe/Berlin"), "10:00");
  assert.equal(zonedTimeLabel(instant, "Asia/Tokyo"), "18:00");
  assert.equal(zonedTimeLabel(instant, "America/New_York"), "04:00");
});

test("a day edge belongs to the zone it is read in", () => {
  // 20:00 UTC on the 23rd is already the 24th in Tokyo, still the 23rd in New York.
  const instant = Date.UTC(2026, 10, 23, 20, 0);

  assert.equal(isoDay(instant, "UTC"), "2026-11-23");
  assert.equal(isoDay(instant, "Asia/Tokyo"), "2026-11-24");
  assert.equal(isoDay(instant, "America/New_York"), "2026-11-23");

  assert.equal(startOfDay(instant, "Asia/Tokyo"), Date.UTC(2026, 10, 23, 15, 0));
  assert.equal(
    startOfDay(instant, "America/New_York"),
    Date.UTC(2026, 10, 23, 5, 0),
  );
});

test("working hours are judged in the owner's zone", () => {
  // 09:00 in Tokyo: inside a 09:00-17:00 Tokyo day, but 00:00 in London.
  const startAt = Date.UTC(2026, 10, 23, 0, 0);
  const endAt = startAt + 60 * 60 * 1000;
  const hours = defaultWeeklyHours();

  assert.equal(outsideWorkingHours(startAt, endAt, hours, "Asia/Tokyo"), false);
  assert.equal(outsideWorkingHours(startAt, endAt, hours, "Europe/London"), true);
});

test("a block cannot cross midnight in the calendar's zone", () => {
  // 23:30-00:30 Tokyo does not cross midnight in UTC, and vice versa.
  const startAt = Date.UTC(2026, 10, 23, 14, 30);
  const endAt = startAt + 60 * 60 * 1000;
  const hours = Array.from({ length: 7 }, () => ({
    startMinute: 0,
    endMinute: 24 * 60,
  })) as WeeklyHours;

  const tokyo = validateBlock(
    { title: "Late call", startAt, endAt, hours },
    "Asia/Tokyo",
  );
  const utc = validateBlock({ title: "Late call", startAt, endAt, hours }, "UTC");

  assert.match(String(tokyo), /same day/);
  assert.equal(utc, null);
});

test("day starts survive a daylight-saving change", () => {
  // US DST starts on 8 March 2026: that local day is 23 hours long.
  const zone = "America/New_York";
  const days = zonedDayStarts(Date.UTC(2026, 2, 7, 17, 0), zone, 3);

  // The 7th and 8th are both 24 hours apart: the change happens *during* the
  // 8th, so the 8th-to-9th gap is the short one.
  assert.equal(days[1] - days[0], 24 * 60 * 60 * 1000);
  assert.equal(days[2] - days[1], 23 * 60 * 60 * 1000);
});

test("the weekday follows the zone too", () => {
  // Sunday 22:00 UTC is Monday 07:00 in Tokyo.
  const instant = Date.UTC(2026, 10, 22, 22, 0);

  assert.equal(zonedWeekday(instant, "UTC"), 6);
  assert.equal(zonedWeekday(instant, "Asia/Tokyo"), 0);
});

test("an unknown zone is rejected instead of throwing", () => {
  assert.equal(isValidTimeZone("Europe/London"), true);
  assert.equal(isValidTimeZone("Mars/Olympus_Mons"), false);
  assert.equal(resolveTimeZone("Mars/Olympus_Mons"), systemTimeZone());
});
