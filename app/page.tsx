import { Suspense } from "react";
import Workspace from "./components/workspace";
import { requireUser } from "./lib/auth";
import { escalateBreaches } from "./lib/escalation";
import { getWorkspaceData } from "./lib/store";

export default function Home() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const user = await requireUser();

  // Hand overdue, unowned threads to an available teammate before rendering.
  escalateBreaches(user.workspaceId);

  const data = await getWorkspaceData(user.workspaceId);

  return <Workspace data={data} user={user} />;
}

function DashboardLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#08090b] text-sm text-slate-500">
      Loading your desk…
    </div>
  );
}
