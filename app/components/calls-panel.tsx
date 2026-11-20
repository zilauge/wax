"use client";

import type { Agent, Call, Channel, ChannelId, Queue } from "../lib/types";
import { ChannelTile, PanelHeader, primaryButtonClass } from "./ui";
import { ClockIcon, HeadphonesIcon, PlusIcon } from "./icons";

const callStateStyles: Record<Call["state"], string> = {
  "on call": "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  ringing: "border-indigo-400/25 bg-indigo-400/10 text-indigo-300",
  waiting: "border-amber-400/25 bg-amber-400/10 text-amber-300",
};

const selectClass =
  "max-w-[8.5rem] cursor-pointer rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-slate-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60";

const callStats = [
  { label: "Answered today", value: "148" },
  { label: "Missed", value: "6" },
  { label: "Avg. handle time", value: "4m 12s" },
];

export default function CallsPanel({
  calls,
  channelMap,
  agents,
  queues,
  onAssign,
  onMoveQueue,
  workflowError,
}: {
  calls: Call[];
  channelMap: Record<ChannelId, Channel>;
  agents: Agent[];
  queues: Queue[];
  onAssign: (callId: string, userId: string) => void;
  onMoveQueue: (callId: string, queueId: string) => void;
  workflowError: string | null;
}) {
  const waiting = calls.filter((call) => call.state === "waiting").length;

  return (
    <div>
      <PanelHeader
        title="Call queue"
        badge={`${waiting} waiting`}
        action={
          <button type="button" className={primaryButtonClass}>
            <PlusIcon className="h-3.5 w-3.5" />
            New call
          </button>
        }
      />
      {workflowError && (
        <p
          role="alert"
          className="border-b border-white/[0.06] px-4 py-2 text-[11px] text-rose-400"
        >
          {workflowError}
        </p>
      )}
      <ul className="divide-y divide-white/[0.04]">
        {calls.map((call) => {
          const channel = channelMap[call.channel];
          return (
            <li
              key={call.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <ChannelTile channel={channel} />
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-white">
                  {call.caller}
                </p>
                <p className="truncate text-[11px] text-slate-500">
                  {call.company} · {call.direction} via {channel.name}
                </p>
              </div>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${callStateStyles[call.state]}`}
              >
                {call.state}
              </span>
              <span className="ml-auto flex items-center gap-1 text-[11px] text-slate-400">
                <ClockIcon className="h-3.5 w-3.5" />
                {call.hold}
              </span>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: call.queueColor ?? "#475569" }}
                />
                <select
                  value={call.queueId ?? ""}
                  onChange={(event) => onMoveQueue(call.id, event.target.value)}
                  disabled={!call.queueId}
                  aria-label={`Queue for ${call.caller}`}
                  className={selectClass}
                >
                  {!call.queueId && <option value="">No queue</option>}
                  {queues.map((queue) => (
                    <option key={queue.id} value={queue.id}>
                      {queue.name}
                    </option>
                  ))}
                </select>
                <select
                  value={call.assigneeId ?? ""}
                  onChange={(event) => onAssign(call.id, event.target.value)}
                  aria-label={`Assignee for ${call.caller}`}
                  className={selectClass}
                >
                  <option value="">Unassigned</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="rounded-lg border border-white/[0.08] bg-white/[0.04] p-1.5 text-slate-300 hover:text-white"
                  aria-label={`Answer ${call.caller}`}
                >
                  <HeadphonesIcon className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-950 hover:bg-emerald-400"
                >
                  Answer
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="grid gap-3 border-t border-white/[0.06] p-4 sm:grid-cols-3">
        {callStats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
          >
            <p className="text-[10px] text-slate-500">{stat.label}</p>
            <p className="text-sm font-semibold text-white">{stat.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
