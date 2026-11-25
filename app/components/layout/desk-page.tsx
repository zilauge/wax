import { requireUser } from "@/app/lib/auth/auth";
import { buildReport, parseRange } from "@/app/lib/analytics/report";
import { escalateBreaches } from "@/app/lib/workspace/escalation";
import { getWorkspaceData } from "@/app/lib/workspace/store";
import {
  calendarNow,
  listBlocks,
  listCalendarTeam,
  weeklyHours,
} from "@/app/lib/calendar/store";
import { addDays, calendarWindow } from "@/app/lib/calendar/rules";
import Workspace, { type CalendarData, type DeskTab } from "./workspace";

/**
 * One dashboard route = one server load. The shell, sidebar and live channel
 * are shared by every tab, while the URL decides which panel is visible so a
 * tab can be bookmarked, linked and refreshed.
 */
export default async function DeskPage({
  tab,
  searchParams,
}: {
  tab: DeskTab;
  searchParams?: Promise<{
    channel?: string;
    error?: string;
    connected?: string;
    week?: string;
    q?: string;
    conversation?: string;
    range?: string;
  }>;
}) {
  const user = await requireUser();

  // Hand overdue, unowned threads to an available teammate before rendering.
  escalateBreaches(user.workspaceId);

  const data = await getWorkspaceData(user.workspaceId);
  const params = searchParams ? await searchParams : {};
  // Only a channel this workspace actually has can be filtered to.
  const initialChannel = data.channels.find(
    (channel) => channel.id === params.channel,
  )?.id;
  const notice =
    tab === "settings"
      ? (params.error ?? (params.connected === "1" ? "Channel connected." : null))
      : null;

  // The calendar is the only tab with its own time window, so it is loaded per
  // request rather than carried by every page.
  let calendar: CalendarData | null = null;
  if (tab === "calendar") {
    // The week, its day edges and every label follow the viewer's own zone.
    const window = calendarWindow(params.week, user.timeZone);
    calendar = {
      blocks: listBlocks(
        user.workspaceId,
        window.weekStart,
        addDays(window.weekStart, 7),
      ),
      hours: weeklyHours(user.workspaceId, user.id),
      team: listCalendarTeam(user.workspaceId),
      timeZone: user.timeZone,
      nowTs: calendarNow(),
      today: window.today,
      weekStart: window.weekStart,
      weekLabel: window.weekLabel,
      prevWeek: window.prevWeek,
      nextWeek: window.nextWeek,
      thisWeek: window.thisWeek,
    };
  }

  const analytics =
    tab === "analytics"
      ? buildReport(user.workspaceId, parseRange(params.range))
      : null;

  return (
    <Workspace
      data={data}
      user={user}
      tab={tab}
      analytics={analytics}
      initialChannel={initialChannel}
      initialQuery={params.q ?? ""}
      initialConversation={params.conversation ?? ""}
      notice={notice}
      calendar={calendar}
    />
  );
}
