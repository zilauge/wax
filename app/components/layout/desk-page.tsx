import { requireUser } from "@/app/lib/auth/auth";
import { escalateBreaches } from "@/app/lib/workspace/escalation";
import { getWorkspaceData } from "@/app/lib/workspace/store";
import Workspace, { type DeskTab } from "./workspace";

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

  return (
    <Workspace
      data={data}
      user={user}
      tab={tab}
      initialChannel={initialChannel}
      notice={notice}
    />
  );
}
