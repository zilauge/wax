import type { Channel, ChannelId, Meeting, Summary } from "../lib/types";
import { PanelHeader, primaryButtonClass, secondaryButtonClass } from "./ui";
import { VideoIcon } from "./icons";

export default function MeetingsPanel({
  meetings,
  channelMap,
  summary,
}: {
  meetings: Meeting[];
  channelMap: Record<ChannelId, Channel>;
  summary: Summary;
}) {
  return (
    <div>
      <PanelHeader
        title="Conference rooms"
        badge={`${summary.meetingsToday} today`}
        action={
          <button type="button" className={primaryButtonClass}>
            <VideoIcon className="h-3.5 w-3.5" />
            Start meeting
          </button>
        }
      />
      <ul className="divide-y divide-white/[0.04]">
        {meetings.map((meeting) => {
          const channel = channelMap[meeting.channel];
          const isLive = meeting.status === "live";
          return (
            <li
              key={meeting.id}
              className={`flex flex-wrap items-center gap-3 px-4 py-3.5 ${
                isLive ? "bg-emerald-400/[0.04]" : ""
              }`}
            >
              <span
                className={`flex w-14 shrink-0 flex-col items-center rounded-lg border px-2 py-1.5 ${
                  isLive
                    ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                    : "border-white/[0.07] bg-white/[0.03] text-slate-300"
                }`}
              >
                <span className="text-[10px] tracking-wide uppercase">
                  {isLive ? "Live" : "Time"}
                </span>
                <span className="text-[11px] font-semibold">
                  {meeting.startsAt}
                </span>
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-white">
                  {meeting.title}
                </p>
                <p className="truncate text-[11px] text-slate-500">
                  {meeting.duration} · hosted by {meeting.host} ·{" "}
                  {channel.name} invite
                </p>
              </div>
              <div className="ml-auto flex items-center gap-1">
                {meeting.attendees.map((attendee, index) => (
                  <span
                    key={attendee}
                    className="-ml-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-[#0d0e12] bg-white/10 text-[9px] font-semibold text-white first:ml-0"
                    style={{ zIndex: meeting.attendees.length - index }}
                  >
                    {attendee}
                  </span>
                ))}
              </div>
              <button
                type="button"
                className={
                  isLive
                    ? "rounded-lg bg-emerald-500 px-3 py-1.5 text-[11px] font-semibold text-emerald-950 hover:bg-emerald-400"
                    : secondaryButtonClass
                }
              >
                {isLive ? "Join now" : "Open room"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
