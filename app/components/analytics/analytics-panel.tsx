import Link from "next/link";
import type { Metric } from "@/app/lib/types";

export type AnalyticsReport = {
  days: number;
  points: {
    date: string;
    opened: number;
    inbound: number;
    outbound: number;
    notes: number;
  }[];
  totals: {
    opened: number;
    inbound: number;
    outbound: number;
    notes: number;
  };
  sla: { met: number; late: number };
  medianResponseMinutes: number | null;
  byChannel: { channel: string; inbound: number; outbound: number }[];
  workload: {
    id: string;
    name: string;
    presence: string;
    active: number;
    breached: number;
  }[];
  backlog: { unassigned: number; breaching: number };
};

const ranges = [7, 30, 90] as const;

/**
 * The analytics tab. It is rendered inside the desk shell so the sidebar is
 * present, and the range links stay on the same route.
 */
export default function AnalyticsPanel({
  report,
  metrics,
}: {
  report: AnalyticsReport;
  metrics: Metric[];
}) {
  const peak = Math.max(
    1,
    ...report.points.map((point) => point.inbound + point.outbound),
  );

  return (
    <div className="space-y-6 p-4">
      <section className="flex flex-wrap items-center gap-2">
        {ranges.map((option) => (
          <Link
            key={option}
            href={`/analytics?range=${option}`}
            aria-current={report.days === option ? "page" : undefined}
            className={`rounded-lg border px-2.5 py-1 text-[11px] ${
              report.days === option
                ? "border-indigo-400/30 bg-indigo-500/15 text-indigo-200"
                : "border-fg/[0.08] text-slate-400 hover:text-fg"
            }`}
          >
            {option} days
          </Link>
        ))}
        <a
          href={`/api/analytics/export?range=${report.days}`}
          className="ml-auto rounded-lg border border-fg/[0.08] px-2.5 py-1 text-[11px] text-slate-400 hover:text-fg"
        >
          Download CSV
        </a>
      </section>

      <section className="rounded-2xl border border-fg/[0.06] bg-fg/[0.02] p-4">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-slate-400">
          <span>
            <strong className="text-fg">{report.totals.opened}</strong>{" "}
            conversations opened
          </span>
          <span>
            <strong className="text-fg">{report.totals.inbound}</strong> in
          </span>
          <span>
            <strong className="text-fg">{report.totals.outbound}</strong> out
          </span>
          <span>
            <strong className="text-fg">{report.totals.notes}</strong> internal
            notes
          </span>
          <span>
            SLA met <strong className="text-emerald-300">{report.sla.met}</strong>{" "}
            · late <strong className="text-rose-300">{report.sla.late}</strong>
          </span>
        </div>

        <div className="mt-3 flex h-28 items-end gap-[2px]" aria-hidden="true">
          {report.points.map((point) => (
            <span
              key={point.date}
              title={`${point.date}: ${point.inbound} in, ${point.outbound} out`}
              className="flex-1 rounded-sm bg-indigo-500/60"
              style={{
                height: `${Math.max(
                  3,
                  ((point.inbound + point.outbound) / peak) * 100,
                )}%`,
              }}
            />
          ))}
        </div>
        <p className="mt-2 text-[10px] text-slate-500">
          Messages per day across the last {report.days} days.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-fg/[0.06] bg-fg/[0.02] p-4">
          <p className="text-[11px] text-slate-500">Median first reply</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-fg">
            {report.medianResponseMinutes === null
              ? "—"
              : report.medianResponseMinutes >= 60
                ? `${Math.round((report.medianResponseMinutes / 60) * 10) / 10}h`
                : `${report.medianResponseMinutes}m`}
          </p>
          <p className="mt-1 text-[10px] text-slate-500">
            from the customer&apos;s first message
          </p>
        </div>
        <div className="rounded-2xl border border-fg/[0.06] bg-fg/[0.02] p-4">
          <p className="text-[11px] text-slate-500">Unassigned backlog</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-fg">
            {report.backlog.unassigned}
          </p>
          <p className="mt-1 text-[10px] text-slate-500">
            unresolved threads nobody owns
          </p>
        </div>
        <div className="rounded-2xl border border-fg/[0.06] bg-fg/[0.02] p-4">
          <p className="text-[11px] text-slate-500">Breaching now</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-rose-300">
            {report.backlog.breaching}
          </p>
          <p className="mt-1 text-[10px] text-slate-500">
            past the first-reply deadline
          </p>
        </div>
      </section>

      {report.byChannel.length > 0 && (
        <section className="rounded-2xl border border-fg/[0.06] bg-fg/[0.02] p-4">
          <p className="wax-eyebrow">Channel mix</p>
          <ul className="mt-2 divide-y divide-fg/[0.04]">
            {report.byChannel.map((row) => (
              <li
                key={row.channel}
                className="flex items-center justify-between gap-3 py-1.5 text-[11px]"
              >
                <span className="text-slate-300 capitalize">{row.channel}</span>
                <span className="text-slate-500">
                  <strong className="text-fg">{row.inbound}</strong> in ·{" "}
                  <strong className="text-fg">{row.outbound}</strong> out
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.workload.length > 0 && (
        <section className="rounded-2xl border border-fg/[0.06] bg-fg/[0.02] p-4">
          <p className="wax-eyebrow">Agent workload</p>
          <ul className="mt-2 divide-y divide-fg/[0.04]">
            {report.workload.map((agent) => (
              <li
                key={agent.id}
                className="flex items-center justify-between gap-3 py-1.5 text-[11px]"
              >
                <span className="truncate text-slate-300">{agent.name}</span>
                <span className="shrink-0 text-slate-500 capitalize">
                  {agent.presence} · {agent.active} open
                  {agent.breached > 0 && (
                    <span className="ml-1 text-rose-300">
                      {agent.breached} late
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-2xl border border-fg/[0.06] bg-fg/[0.02] p-4"
          >
            <p className="text-[11px] text-slate-500">{metric.label}</p>
            <p className="mt-1.5 text-2xl font-semibold tracking-tight text-fg">
              {metric.value}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">{metric.delta}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
