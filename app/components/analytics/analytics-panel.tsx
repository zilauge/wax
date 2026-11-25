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
