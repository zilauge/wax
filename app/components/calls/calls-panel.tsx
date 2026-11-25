"use client";

import Image from "next/image";
import Link from "next/link";
import type { Agent, Call, Channel, ChannelId, Queue } from "@/app/lib/types";
import { ChannelTile, PanelHeader, primaryButtonClass } from "@/app/components/shared/ui";
import { ClockIcon, HeadphonesIcon, PlusIcon } from "@/app/components/shared/icons";
import callsArt from "@/app/images/svgs/icon-dd-mobile.svg";

const callStateStyles: Record<Call["state"], string> = {
  "on call": "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  ringing: "border-indigo-400/25 bg-indigo-400/10 text-indigo-300",
  waiting: "border-amber-400/25 bg-amber-400/10 text-amber-300",
};

const selectClass =
  "max-w-[8.5rem] cursor-pointer rounded-md border border-fg/[0.08] bg-fg/[0.04] px-1.5 py-0.5 text-[11px] text-slate-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60";

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
  const onCall = calls.filter((call) => call.state === "on call").length;
  const ringing = calls.filter((call) => call.state === "ringing").length;
  const callStats = [
    { label: "On call", value: String(onCall) },
    { label: "Ringing", value: String(ringing) },
    { label: "Waiting", value: String(waiting) },
  ];

  return (
    <div>
      <PanelHeader
        title="Call queue"
        badge={`${waiting} waiting`}
        action={
          <Link
            href="/settings"
            title="Calls need a connected phone channel — manage channels in settings"
            className={primaryButtonClass}
          >
            <PlusIcon className="h-3.5 w-3.5" />
            New call
          </Link>
        }
      />
      {workflowError && (
        <p
          role="alert"
          className="border-b border-fg/[0.06] px-4 py-2 text-[11px] text-rose-400"
        >
          {workflowError}
        </p>
      )}
      <ul className="divide-y divide-fg/[0.04]">
        {calls.length === 0 && (
          <li className="px-4 py-12 text-center">
            <Image
              src={callsArt}
              alt=""
              width={48}
              height={48}
              unoptimized
              className="mx-auto h-12 w-12"
            />
            <p className="mt-4 text-xs font-medium text-slate-100">
              No calls in the queue
            </p>
            <p className="mx-auto mt-1.5 max-w-xs text-[11px] leading-relaxed text-slate-500">
              Inbound calls appear here once a phone channel is connected.{" "}
              <Link
                href="/settings"
                className="font-medium text-indigo-400 hover:text-indigo-300"
              >
                Manage channels
              </Link>
            </p>
          </li>
        )}
        {calls.map((call) => {
          const channel = channelMap[call.channel];
          return (
            <li
              key={call.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-fg/[0.02]"
            >
              <ChannelTile channel={channel} />
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-fg">
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
                  disabled
                  title="Answering needs a telephony provider — connect a phone channel in settings"
                  className="cursor-not-allowed rounded-lg border border-fg/[0.08] bg-fg/[0.04] p-1.5 text-slate-500"
                  aria-label={`Answer ${call.caller}`}
                >
                  <HeadphonesIcon className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled
                  title="Answering needs a telephony provider — connect a phone channel in settings"
                  className="cursor-not-allowed rounded-lg bg-emerald-500/40 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-950/70"
                >
                  Answer
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="grid gap-3 border-t border-fg/[0.06] p-4 sm:grid-cols-3">
        {callStats.map((stat) => (
          <div
            key={stat.label}
            className="wax-tile px-3 py-2.5"
          >
            <p className="wax-eyebrow">{stat.label}</p>
            <p className="wax-num mt-1.5 text-[15px] font-semibold text-fg">
              {stat.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
