import Link from "next/link";
import type {
  Agent,
  Call,
  Channel,
  ChannelId,
  Meeting,
  Queue,
} from "@/app/lib/types";
import { Avatar, ChannelTile, LiveDot, RailCard, initials } from "@/app/components/shared/ui";

const presenceStyles: Record<Agent["presence"], { dot: string; label: string }> = {
  available: { dot: "bg-emerald-400", label: "Available" },
  busy: { dot: "bg-amber-400", label: "Busy" },
  away: { dot: "bg-slate-500", label: "Away" },
};

export default function RightRail({
  meetings,
  calls,
  channels,
  channelMap,
  agents,
  queues,
  onViewCalls,
}: {
  meetings: Meeting[];
  calls: Call[];
  channels: Channel[];
  channelMap: Record<ChannelId, Channel>;
  agents: Agent[];
  queues: Queue[];
  onViewCalls: () => void;
}) {
  const live = meetings.filter((meeting) => meeting.status === "live").length;
  const disconnected = channels.filter((channel) => !channel.connected);

  return (
    <aside className="space-y-4">
      <RailCard
        title="Live & upcoming"
        action={
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-300">
            <LiveDot />
            {live} live
          </span>
        }
      >
        <ul className="mt-3 space-y-2">
          {meetings.length === 0 && (
            <li className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-4 text-center text-[10px] text-slate-500">
              Nothing scheduled. Rooms appear once a video channel is connected.
            </li>
          )}
          {meetings.slice(0, 3).map((meeting) => (
            <li
              key={meeting.id}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <ChannelTile channel={channelMap[meeting.channel]} size="sm" />
                <p className="min-w-0 flex-1 truncate text-[11px] font-medium text-white">
                  {meeting.title}
                </p>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500">
                <span>
                  {meeting.startsAt} · {meeting.duration}
                </span>
                <Link
                  href="/meetings"
                  className={`font-semibold ${
                    meeting.status === "live"
                      ? "text-emerald-400"
                      : "text-indigo-400"
                  }`}
                >
                  {meeting.status === "live" ? "Join" : "Details"}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </RailCard>

      <RailCard
        title="Call queue"
        action={
          <button
            type="button"
            onClick={onViewCalls}
            className="text-[10px] font-medium text-indigo-400 hover:text-indigo-300"
          >
            View all
          </button>
        }
      >
        <ul className="mt-3 space-y-2">
          {calls.length === 0 && (
            <li className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-4 text-center text-[10px] text-slate-500">
              The queue is empty. Inbound calls appear once a phone channel is
              connected.
            </li>
          )}
          {calls.slice(0, 3).map((call) => (
            <li key={call.id} className="flex items-center gap-2">
              <ChannelTile channel={channelMap[call.channel]} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-white">
                  {call.caller}
                </p>
                <p className="truncate text-[10px] text-slate-500">
                  waiting {call.hold} · {call.queueName ?? "Unassigned"}
                </p>
              </div>
              <Link
                href="/calls"
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[10px] font-semibold text-slate-200 hover:bg-white/[0.08]"
              >
                Pick up
              </Link>
            </li>
          ))}
        </ul>
      </RailCard>

      <RailCard
        title="Team presence"
        action={
          <span className="text-[10px] font-medium text-slate-500">
            {agents.filter((agent) => agent.presence === "available").length} of{" "}
            {agents.length} available
          </span>
        }
      >
        <ul className="mt-3 space-y-2">
          {agents.map((agent) => {
            const presence = presenceStyles[agent.presence];
            return (
              <li key={agent.id} className="flex items-center gap-2">
                <span className="relative">
                  <Avatar initials={initials(agent.name)} color="#6366f1" size="sm" />
                  <span
                    className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0c0d11] ${presence.dot}`}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium text-white">
                    {agent.name}
                  </p>
                  <p className="truncate text-[10px] text-slate-500 capitalize">
                    {presence.label} · {agent.role}
                  </p>
                </div>
                <span className="text-[10px] text-slate-500">
                  {agent.active} open
                </span>
              </li>
            );
          })}
        </ul>
      </RailCard>

      <RailCard
        title="Queues · SLA"
        action={
          <span className="text-[10px] font-medium text-slate-500">
            first reply
          </span>
        }
      >
        <ul className="mt-3 space-y-2">
          {queues.map((queue) => (
            <li key={queue.id} className="flex items-center gap-2">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: queue.color }}
              />
              <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300">
                {queue.name}
              </span>
              <span className="text-[10px] text-slate-500">
                {queue.open} open · {queue.slaMinutes}m
              </span>
              <span
                className={`w-12 text-right text-[10px] font-medium ${
                  queue.breaching > 0 ? "text-rose-400" : "text-emerald-400/80"
                }`}
              >
                {queue.breaching > 0 ? `${queue.breaching} late` : "on time"}
              </span>
            </li>
          ))}
        </ul>
      </RailCard>

      <RailCard title="Channel health">
        <ul className="mt-3 space-y-2">
          {channels.slice(0, 4).map((channel) => (
            <li
              key={channel.id}
              className="flex items-center gap-2 text-[11px]"
            >
              <ChannelTile channel={channel} size="sm" />
              <span className="flex-1 text-slate-300">{channel.name}</span>
              <span className="text-slate-500">
                {channel.connected ? channel.handle || "Linked" : "Not connected"}
              </span>
            </li>
          ))}
        </ul>
        {disconnected.length > 0 && (
          <p className="mt-3 border-t border-white/[0.06] pt-2.5 text-[10px] leading-relaxed text-slate-500">
            {disconnected.map((channel) => channel.name).join(", ")} not
            connected — comments and live chat will not sync until you connect
            the channel.
          </p>
        )}
      </RailCard>
    </aside>
  );
}
