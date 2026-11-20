import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/app/lib/auth/auth";
import { getWorkspaceData } from "@/app/lib/workspace/store";

export const metadata: Metadata = { title: "Analytics — Wax" };

// Reads the session and the database on every request.
export const instant = false;

export default async function AnalyticsPage() {
  const user = await requireUser();
  const data = await getWorkspaceData(user.workspaceId);

  return (
    <div className="min-h-screen bg-[#08090b] px-4 py-10 text-slate-200">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] text-slate-500">{user.workspaceName}</p>
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              Analytics
            </h1>
          </div>
          <Link
            href="/inbox"
            className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-xs font-medium text-slate-300 transition-colors hover:text-white"
          >
            Back to inbox
          </Link>
        </div>

        <section className="mt-6 grid gap-3 sm:grid-cols-2">
          {data.metrics.map((metric) => (
            <div
              key={metric.label}
              className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4"
            >
              <p className="text-[11px] text-slate-500">{metric.label}</p>
              <p className="mt-1.5 text-2xl font-semibold tracking-tight text-white">
                {metric.value}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">{metric.delta}</p>
            </div>
          ))}
        </section>

        <section className="mt-4 overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
            <p className="text-[11px] font-semibold tracking-[0.1em] text-slate-400 uppercase">
              Queues · first reply SLA
            </p>
            <span className="text-[10px] text-slate-500">
              {data.queues.length} queues
            </span>
          </div>
          <ul className="divide-y divide-white/[0.04]">
            {data.queues.map((queue) => (
              <li key={queue.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: queue.color }}
                />
                <span className="flex-1 text-xs text-slate-200">
                  {queue.name}
                </span>
                <span className="text-[11px] text-slate-500">
                  {queue.open} open · {queue.slaMinutes}m target
                </span>
                <span
                  className={`w-16 text-right text-[11px] font-medium ${
                    queue.breaching > 0 ? "text-rose-400" : "text-emerald-400/80"
                  }`}
                >
                  {queue.breaching > 0 ? `${queue.breaching} late` : "on time"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {data.conversations.length === 0 && (
          <p className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[11px] leading-relaxed text-slate-500">
            Numbers appear once conversations and calls exist. Connect a channel
            from{" "}
            <Link
              href="/connect"
              className="font-medium text-indigo-400 hover:text-indigo-300"
            >
              onboarding
            </Link>{" "}
            to start collecting them.
          </p>
        )}
      </div>
    </div>
  );
}
