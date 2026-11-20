import { Suspense } from "react";
import Workspace from "./components/workspace";
import { requireUser } from "./lib/auth";
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
