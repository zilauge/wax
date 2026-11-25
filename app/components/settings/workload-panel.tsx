import type { Agent, Queue, Summary } from "@/app/lib/types";

const presenceStyles: Record<Agent["presence"], string> = {
  available: "bg-emerald-400",
  busy: "bg-amber-400",
  away: "bg-slate-500",
};

/**
 * Who is carrying what, and where the backlog is. Routing and SLA escalation
 * already distribute work in the background; this is the screen that lets a
 * manager see the result and spot imbalance before it becomes a breach.
 */
export default function WorkloadPanel({
  agents,
  queues,
  summary,
}: {
  agents: Agent[];
  queues: Queue[];
  summary: Summary;
}) {
  const busiest = Math.max(1, ...agents.map((agent) => agent.active));

  return (
    <section className="py-2">
      <div className="flex items-center justify-between gap-3 px-4 pt-2 pb-1">
        <p className="wax-eyebrow">Workload</p>
        <span className="text-[10px] text-slate-500">
          {summary.openConversations} open · {summary.breachedSlas} breaching
        </span>
      </div>

      <ul className="divide-y divide-fg/[0.04]">
        {agents.map((agent) => (
          <li key={agent.id} className="flex items-center gap-3 px-4 py-2">
            <span
              aria-label={agent.presence}
              title={agent.presence}
              className={`h-2 w-2 shrink-0 rounded-full ${presenceStyles[agent.presence]}`}
            />
            <span className="min-w-0 flex-1 truncate text-[11px] text-slate-200">
              {agent.name}
              <span className="ml-1.5 text-[10px] text-slate-500 capitalize">
                {agent.role}
              </span>
            </span>
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-fg/[0.06]">
              <span
                className="block h-full rounded-full bg-gradient-to-r from-indigo-400 to-violet-500"
                style={{ width: `${(agent.active / busiest) * 100}%` }}
              />
            </span>
            <span className="w-12 text-right text-[10px] text-slate-400">
              {agent.active} open
            </span>
          </li>
        ))}
      </ul>

      <ul className="mt-1 divide-y divide-fg/[0.04] border-t border-fg/[0.05]">
        {queues.map((queue) => (
          <li
            key={queue.id}
            className="flex items-center justify-between gap-3 px-4 py-1.5 text-[10px]"
          >
            <span className="flex items-center gap-1.5 text-slate-300">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: queue.color }}
              />
              {queue.name}
              <span className="text-slate-600">· {queue.slaMinutes}m SLA</span>
            </span>
            <span className={queue.breaching > 0 ? "text-rose-300" : "text-slate-500"}>
              {queue.open} open
              {queue.breaching > 0 ? ` · ${queue.breaching} breaching` : ""}
            </span>
          </li>
        ))}
      </ul>

      <p className="px-4 pt-1.5 pb-1 text-[10px] leading-relaxed text-slate-500">
        New arrivals go to the available agent with the fewest open threads, and
        overdue unowned threads are escalated the same way.
      </p>
    </section>
  );
}
