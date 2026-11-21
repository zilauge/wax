"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  createBlockAction,
  deleteBlockAction,
  saveHoursAction,
} from "@/app/lib/calendar/actions";
import {
  BLOCK_KINDS,
  addDays,
  conflictsFor,
  defaultWeeklyHours,
  minutesToLabel,
  outsideWorkingHours,
  startOfDay,
  timeLabel,
  weekdayIndex,
  type BlockKind,
  type TimeBlock,
  type WeeklyHours,
} from "@/app/lib/calendar/rules";
import { ClockIcon, PlusIcon } from "@/app/components/shared/icons";

const KIND_STYLE: Record<BlockKind, { label: string; box: string }> = {
  focus: {
    label: "Focus",
    box: "border-indigo-400/40 bg-indigo-500/25 text-indigo-50",
  },
  meeting: {
    label: "Meeting",
    box: "border-emerald-400/40 bg-emerald-500/25 text-emerald-50",
  },
  admin: { label: "Admin", box: "border-sky-400/40 bg-sky-500/25 text-sky-50" },
  break: {
    label: "Break",
    box: "border-amber-400/35 bg-amber-500/20 text-amber-50",
  },
};

const HOUR_START = 8;
const HOUR_END = 20;
const ROW_HEIGHT = 56;
const GRID_START_MINUTE = HOUR_START * 60;
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dayStartOf(ts: number) {
  return startOfDay(ts);
}

export default function CalendarPanel({
  blocks,
  hours,
  agents,
  me,
  today,
  weekStart,
  weekLabel,
  prevWeek,
  nextWeek,
  thisWeek,
}: {
  blocks: TimeBlock[];
  hours: WeeklyHours;
  agents: { id: string; name: string }[];
  me: { id: string; name: string };
  today: number;
  weekStart: number;
  weekLabel: string;
  prevWeek: string;
  nextWeek: string;
  thisWeek: string;
}) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [draft, setDraft] = useState<{ startAt: number; endAt: number } | null>(
    null,
  );
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<BlockKind>("focus");
  const [note, setNote] = useState("");

  const [showHours, setShowHours] = useState(false);
  const [days, setDays] = useState<number[]>(() =>
    hours.flatMap((window, weekday) => (window ? [weekday] : [])),
  );
  const [startMinute, setStartMinute] = useState(
    hours.find(Boolean)?.startMinute ?? defaultWeeklyHours()[0]!.startMinute,
  );
  const [endMinute, setEndMinute] = useState(
    hours.find(Boolean)?.endMinute ?? defaultWeeklyHours()[0]!.endMinute,
  );

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );

  const draftClashes = draft
    ? conflictsFor({ userId: me.id, ...draft }, blocks)
    : [];
  const myClash = draftClashes.filter((block) => block.userId === me.id);
  const teamClash = draftClashes.filter((block) => block.userId !== me.id);
  const draftOutside = draft
    ? outsideWorkingHours(draft.startAt, draft.endAt, hours)
    : false;

  function openSlot(day: number, hour: number) {
    const startAt = day + hour * 60 * 60 * 1000;
    setDraft({ startAt, endAt: startAt + 60 * 60 * 1000 });
    setTitle("");
    setKind("focus");
    setNote("");
    setError(null);
    setNotice(null);
  }

  function shiftDraft(field: "startAt" | "endAt", value: number) {
    if (!draft) return;
    const next = { ...draft, [field]: value };
    if (field === "startAt" && next.endAt <= next.startAt) {
      next.endAt = value + 60 * 60 * 1000;
    }
    setDraft(next);
  }

  function save() {
    if (!draft) return;
    startSaving(async () => {
      const result = await createBlockAction({
        title,
        kind,
        startAt: draft.startAt,
        endAt: draft.endAt,
        note,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setDraft(null);
      setNotice(result.notice);
      router.refresh();
    });
  }

  function remove(id: string) {
    startSaving(async () => {
      const result = await deleteBlockAction(id);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function saveHours() {
    startSaving(async () => {
      const result = await saveHoursAction({ days, startMinute, endMinute });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setShowHours(false);
      router.refresh();
    });
  }

  const todayBlocks = blocks.filter(
    (block) => dayStartOf(block.startAt) === today,
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] px-4 py-3">
        <h2 className="text-sm font-medium text-white">Calendar</h2>
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
          {weekLabel}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Link
            href={`/calendar?week=${prevWeek}`}
            className="rounded-lg border border-white/[0.07] px-2 py-1 text-[11px] text-slate-400 hover:text-white"
          >
            ←
          </Link>
          <Link
            href={`/calendar?week=${thisWeek}`}
            className="rounded-lg border border-white/[0.07] px-2 py-1 text-[11px] text-slate-400 hover:text-white"
          >
            This week
          </Link>
          <Link
            href={`/calendar?week=${nextWeek}`}
            className="rounded-lg border border-white/[0.07] px-2 py-1 text-[11px] text-slate-400 hover:text-white"
          >
            →
          </Link>
          <button
            type="button"
            onClick={() => setShowHours((open) => !open)}
            className="ml-2 flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-white/[0.08]"
          >
            <ClockIcon className="h-3.5 w-3.5" />
            Boundaries
          </button>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mx-4 mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300"
        >
          {error}
        </p>
      )}
      {notice && (
        <p className="mx-4 mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          {notice}
        </p>
      )}

      {showHours && (
        <div className="mx-4 mt-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
          <p className="text-xs font-semibold text-white">Your working hours</p>
          <p className="mt-1 text-[11px] text-slate-500">
            Everything outside this window is shaded and cannot be booked. Days
            you leave off are treated as non-working.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {DAY_NAMES.map((name, weekday) => {
              const on = days.includes(weekday);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() =>
                    setDays((current) =>
                      current.includes(weekday)
                        ? current.filter((day) => day !== weekday)
                        : [...current, weekday],
                    )
                  }
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-medium ${
                    on
                      ? "bg-indigo-500/25 text-indigo-100"
                      : "bg-white/[0.03] text-slate-500"
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-[11px] text-slate-400">
              From
              <input
                type="time"
                value={minutesToLabel(startMinute)}
                onChange={(event) => {
                  const [h, m] = event.target.value.split(":").map(Number);
                  if (Number.isFinite(h)) setStartMinute(h * 60 + (m || 0));
                }}
                className="ml-2 rounded-lg border border-white/10 bg-[#0b0c10] px-2 py-1 text-[11px] text-slate-200"
              />
            </label>
            <label className="text-[11px] text-slate-400">
              to
              <input
                type="time"
                value={minutesToLabel(endMinute)}
                onChange={(event) => {
                  const [h, m] = event.target.value.split(":").map(Number);
                  if (Number.isFinite(h)) setEndMinute(h * 60 + (m || 0));
                }}
                className="ml-2 rounded-lg border border-white/10 bg-[#0b0c10] px-2 py-1 text-[11px] text-slate-200"
              />
            </label>
            <button
              type="button"
              onClick={saveHours}
              disabled={saving}
              className="ml-auto rounded-lg bg-indigo-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-400 disabled:opacity-60"
            >
              Save hours
            </button>
          </div>
        </div>
      )}

      {draft && (
        <div className="mx-4 mt-3 rounded-2xl border border-indigo-500/25 bg-indigo-500/[0.06] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What are you protecting?"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0b0c10] px-3 py-1.5 text-xs text-white placeholder:text-slate-600"
            />
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as BlockKind)}
              className="rounded-lg border border-white/10 bg-[#0b0c10] px-2 py-1.5 text-[11px] text-slate-200"
            >
              {BLOCK_KINDS.map((value) => (
                <option key={value} value={value}>
                  {KIND_STYLE[value].label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
            <span>
              {new Date(draft.startAt).toLocaleDateString([], {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
            </span>
            <input
              type="time"
              value={timeLabel(draft.startAt)}
              onChange={(event) => {
                const [h, m] = event.target.value.split(":").map(Number);
                if (Number.isFinite(h)) {
                  shiftDraft("startAt", dayStartOf(draft.startAt) + (h * 60 + (m || 0)) * 60000);
                }
              }}
              className="rounded-lg border border-white/10 bg-[#0b0c10] px-2 py-1 text-[11px] text-slate-200"
            />
            <span>to</span>
            <input
              type="time"
              value={timeLabel(draft.endAt)}
              onChange={(event) => {
                const [h, m] = event.target.value.split(":").map(Number);
                if (Number.isFinite(h)) {
                  shiftDraft("endAt", dayStartOf(draft.startAt) + (h * 60 + (m || 0)) * 60000);
                }
              }}
              className="rounded-lg border border-white/10 bg-[#0b0c10] px-2 py-1 text-[11px] text-slate-200"
            />
          </div>

          {draftOutside && (
            <p className="mt-2 text-[11px] text-amber-300">
              Outside your working hours — widen your boundaries or move the
              block.
            </p>
          )}
          {myClash.length > 0 && (
            <p className="mt-2 text-[11px] text-rose-300">
              Clashes with your “{myClash[0].title}”.
            </p>
          )}
          {teamClash.length > 0 && (
            <p className="mt-2 text-[11px] text-amber-300">
              Overlaps {teamClash[0].userName}’s “{teamClash[0].title}” — they
              will see it on the team lane.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Note for the team (optional)"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0b0c10] px-3 py-1.5 text-[11px] text-white placeholder:text-slate-600"
            />
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-slate-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || myClash.length > 0 || draftOutside || !title.trim()}
              className="rounded-lg bg-indigo-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
            >
              Block time
            </button>
          </div>
        </div>
      )}

      <div className="px-4 py-4">
        <div className="overflow-hidden rounded-2xl border border-white/[0.06]">
          <div className="flex border-b border-white/[0.06] bg-white/[0.02]">
            <div className="w-14 shrink-0" />
            {weekDays.map((day, index) => {
              const isToday = day === today;
              return (
                <div
                  key={day}
                  className={`flex-1 px-2 py-2 text-center text-[10px] ${
                    isToday ? "text-indigo-300" : "text-slate-500"
                  }`}
                >
                  <span className="block font-semibold tracking-wide uppercase">
                    {DAY_NAMES[index]}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {new Date(day).getDate()}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex">
            <div className="w-14 shrink-0">
              {Array.from({ length: HOUR_END - HOUR_START }, (_, index) => (
                <div
                  key={index}
                  className="pr-2 text-right text-[10px] text-slate-600"
                  style={{ height: ROW_HEIGHT }}
                >
                  {String(HOUR_START + index).padStart(2, "0")}:00
                </div>
              ))}
            </div>

            <div className="grid flex-1 grid-cols-7">
              {weekDays.map((day) => {
                const window = hours[weekdayIndex(day)] ?? null;
                const outsideTop = window
                  ? Math.max(0, (window.startMinute - GRID_START_MINUTE) / 60) *
                    ROW_HEIGHT
                  : 0;
                const outsideBottom = window
                  ? Math.max(
                      0,
                      (GRID_START_MINUTE +
                        (HOUR_END - HOUR_START) * 60 -
                        window.endMinute) /
                        60,
                    ) * ROW_HEIGHT
                  : (HOUR_END - HOUR_START) * ROW_HEIGHT;

                return (
                  <div
                    key={day}
                    className="relative border-l border-white/[0.05]"
                    style={{ height: ROW_HEIGHT * (HOUR_END - HOUR_START) }}
                  >
                    {Array.from(
                      { length: HOUR_END - HOUR_START },
                      (_, index) => (
                        <button
                          key={index}
                          type="button"
                          aria-label={`Add a block on ${DAY_NAMES[weekdayIndex(day)]} at ${HOUR_START + index}:00`}
                          onClick={() => openSlot(day, HOUR_START + index)}
                          className="block w-full border-t border-white/[0.03] hover:bg-white/[0.03]"
                          style={{ height: ROW_HEIGHT }}
                        />
                      ),
                    )}

                    {outsideTop > 0 && (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 top-0 bg-black/40"
                        style={{ height: outsideTop }}
                      />
                    )}
                    {outsideBottom > 0 && (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/40"
                        style={{ height: outsideBottom }}
                      />
                    )}

                    {blocks
                      .filter((block) => dayStartOf(block.startAt) === day)
                      .map((block) => {
                        const top =
                          ((new Date(block.startAt).getHours() * 60 +
                            new Date(block.startAt).getMinutes() -
                            GRID_START_MINUTE) /
                            60) *
                          ROW_HEIGHT;
                        const height = Math.max(
                          22,
                          ((block.endAt - block.startAt) / 3_600_000) * ROW_HEIGHT,
                        );
                        const style = KIND_STYLE[block.kind];

                        return (
                          <div
                            key={block.id}
                            className={`absolute inset-x-1 overflow-hidden rounded-md border px-1.5 py-0.5 text-[10px] leading-tight ${style.box}`}
                            style={{ top, height }}
                            title={`${block.title} · ${timeLabel(block.startAt)}–${timeLabel(block.endAt)}`}
                          >
                            <p className="truncate font-semibold">{block.title}</p>
                            <p className="truncate opacity-70">
                              {block.userName.split(" ")[0]} ·{" "}
                              {timeLabel(block.startAt)}
                            </p>
                            {block.roomId && (
                              <Link
                                href={`/rooms/${block.roomId}`}
                                className="mt-0.5 inline-block rounded bg-black/30 px-1 text-[9px] font-semibold text-white/90"
                              >
                                Join
                              </Link>
                            )}
                            {block.userId === me.id && (
                              <button
                                type="button"
                                onClick={() => remove(block.id)}
                                aria-label={`Remove ${block.title}`}
                                className="absolute top-0 right-0 px-1 text-[9px] text-white/60 hover:text-white"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <p className="text-xs font-semibold text-white">Team lane · today</p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              What each teammate has protected, and where they are free.
            </p>
            <ul className="mt-3 space-y-2">
              {agents.map((agent) => {
                const own = todayBlocks.filter(
                  (block) => block.userId === agent.id,
                );
                const window = hours[weekdayIndex(today)] ?? null;
                const focus = own.filter((block) => block.kind === "focus");
                return (
                  <li key={agent.id} className="flex flex-wrap items-center gap-2">
                    <span className="w-28 truncate text-[11px] text-slate-300">
                      {agent.id === me.id ? "You" : agent.name}
                    </span>
                    {own.length === 0 ? (
                      <span className="text-[10px] text-slate-600">
                        {window ? "Open all day" : "Off today"}
                      </span>
                    ) : (
                      own.slice(0, 3).map((block) => (
                        <span
                          key={block.id}
                          className={`rounded-md border px-1.5 py-0.5 text-[10px] ${KIND_STYLE[block.kind].box}`}
                        >
                          {block.title} · {timeLabel(block.startAt)}
                        </span>
                      ))
                    )}
                    {focus.length > 0 && (
                      <span className="rounded-full border border-indigo-400/30 bg-indigo-500/10 px-1.5 py-0.5 text-[9px] text-indigo-200">
                        Do not disturb
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <p className="text-xs font-semibold text-white">Today</p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {todayBlocks.filter((block) => block.userId === me.id).length}{" "}
              block(s) · {minutesToLabel(startMinute)}–
              {minutesToLabel(endMinute)} working window
            </p>
            <div className="mt-3 space-y-1.5">
              {todayBlocks
                .filter((block) => block.userId === me.id)
                .map((block) => (
                  <div
                    key={block.id}
                    className="flex items-center gap-2 rounded-lg border border-white/[0.05] px-2 py-1.5"
                  >
                    <span
                      className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${KIND_STYLE[block.kind].box}`}
                    >
                      {KIND_STYLE[block.kind].label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-200">
                      {block.title}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {timeLabel(block.startAt)}–{timeLabel(block.endAt)}
                    </span>
                  </div>
                ))}
              {todayBlocks.filter((block) => block.userId === me.id).length ===
                0 && (
                <p className="flex items-center gap-1.5 text-[11px] text-slate-600">
                  <PlusIcon className="h-3 w-3" />
                  Click any empty slot above to block time.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
