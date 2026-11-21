import { requireUser } from "@/app/lib/auth/auth";
import { escalateBreaches } from "@/app/lib/workspace/escalation";
import { getWorkspaceData } from "@/app/lib/workspace/store";
import { listBlocks, weeklyHours } from "@/app/lib/calendar/store";
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
    const window = calendarWindow(params.week);
    calendar = {
      blocks: listBlocks(
        user.workspaceId,
        window.weekStart,
        addDays(window.weekStart, 7),
      ),
      hours: weeklyHours(user.workspaceId, user.id),
      agents: data.agents.map((agent) => ({ id: agent.id, name: agent.name })),
      today: window.today,
      weekStart: window.weekStart,
      weekLabel: window.weekLabel,
      prevWeek: window.prevWeek,
      nextWeek: window.nextWeek,
      thisWeek: window.thisWeek,
    };
  }

  return (
    <Workspace
      data={data}
      user={user}
      tab={tab}
      initialChannel={initialChannel}
      notice={notice}
      calendar={calendar}
    />
  );
}
