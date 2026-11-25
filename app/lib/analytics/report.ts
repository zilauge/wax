import "server-only";

import { median } from "@/app/lib/analytics/math";
import { db } from "@/app/lib/db/db";

export type DailyPoint = {
  date: string;
  opened: number;
  inbound: number;
  outbound: number;
  notes: number;
};

export type ReportRange = 7 | 30 | 90;

export function parseRange(value: string | undefined): ReportRange {
  return value === "7" ? 7 : value === "90" ? 90 : 30;
}

/** Day buckets in the server's timezone; the CSV and the page share them. */
export function buildReport(workspaceId: string, days: ReportRange) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const buckets = new Map<string, DailyPoint>();
  const today = new Date();
  for (let index = days - 1; index >= 0; index -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - index);
    const key = day.toISOString().slice(0, 10);
    buckets.set(key, { date: key, opened: 0, inbound: 0, outbound: 0, notes: 0 });
  }

  const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  // A conversation's "opened" day is its first message: the conversations table
  // stores activity times, not a separate creation stamp.
  for (const row of db
    .prepare(
      `SELECT MIN(m.created_at) AS opened_at
       FROM conversations c
       JOIN messages m ON m.conversation_id = c.id
       WHERE c.workspace_id = ?
       GROUP BY c.id`,
    )
    .all(workspaceId)) {
    const openedAt = Number(row.opened_at);
    if (openedAt < cutoff) continue;
    const bucket = buckets.get(dayOf(openedAt));
    if (bucket) bucket.opened += 1;
  }

  for (const row of db
    .prepare(
      `SELECT m.author, m.internal, m.created_at
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.workspace_id = ? AND m.created_at >= ?`,
    )
    .all(workspaceId, cutoff)) {
    const bucket = buckets.get(dayOf(Number(row.created_at)));
    if (!bucket) continue;

    if (Number(row.internal) === 1) bucket.notes += 1;
    else if (String(row.author) === "agent") bucket.outbound += 1;
    else bucket.inbound += 1;
  }

  const points = [...buckets.values()];
  const totals = points.reduce(
    (sum, point) => ({
      opened: sum.opened + point.opened,
      inbound: sum.inbound + point.inbound,
      outbound: sum.outbound + point.outbound,
      notes: sum.notes + point.notes,
    }),
    { opened: 0, inbound: 0, outbound: 0, notes: 0 },
  );

  const sla = db
    .prepare(
      `SELECT
         SUM(CASE WHEN first_response_at IS NOT NULL AND sla_due_at IS NOT NULL
                   AND first_response_at <= sla_due_at THEN 1 ELSE 0 END) AS met,
         SUM(CASE WHEN first_response_at IS NULL AND sla_due_at IS NOT NULL
                   AND sla_due_at < ? THEN 1 ELSE 0 END) AS late
       FROM conversations
       WHERE workspace_id = ? AND last_at >= ?`,
    )
    .get(Date.now(), workspaceId, cutoff);

  // First-reply latency, measured from the customer's first message in the
  // thread. Conversations with no reply yet are excluded rather than counted
  // as zero, which would flatter the median.
  const responseGaps = db
    .prepare(
      `SELECT c.first_response_at, MIN(m.created_at) AS first_inbound
       FROM conversations c
       JOIN messages m ON m.conversation_id = c.id AND m.author = 'contact'
       WHERE c.workspace_id = ? AND c.first_response_at IS NOT NULL
         AND c.last_at >= ?
       GROUP BY c.id`,
    )
    .all(workspaceId, cutoff)
    .map((row) =>
      (Number(row.first_response_at) - Number(row.first_inbound)) / 60_000,
    )
    .filter((minutes) => Number.isFinite(minutes) && minutes >= 0);

  const middle = median(responseGaps);
  const medianResponseMinutes = middle === null ? null : Math.round(middle * 10) / 10;

  const byChannel = db
    .prepare(
      `SELECT c.channel_id,
              SUM(CASE WHEN m.author = 'contact' THEN 1 ELSE 0 END) AS inbound,
              SUM(CASE WHEN m.author = 'agent' AND m.internal = 0 THEN 1 ELSE 0 END)
                AS outbound
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.workspace_id = ? AND m.created_at >= ?
       GROUP BY c.channel_id
       ORDER BY inbound + outbound DESC`,
    )
    .all(workspaceId, cutoff)
    .map((row) => ({
      channel: String(row.channel_id),
      inbound: Number(row.inbound ?? 0),
      outbound: Number(row.outbound ?? 0),
    }));

  const workload = db
    .prepare(
      `SELECT u.id, u.name, COALESCE(p.status, 'away') AS presence,
              (SELECT COUNT(*) FROM conversations c
               WHERE c.workspace_id = m.workspace_id
                 AND c.assignee_user_id = u.id
                 AND c.status <> 'resolved') AS active,
              (SELECT COUNT(*) FROM conversations c
               WHERE c.workspace_id = m.workspace_id
                 AND c.assignee_user_id = u.id
                 AND c.status <> 'resolved'
                 AND c.first_response_at IS NULL
                 AND c.sla_due_at IS NOT NULL
                 AND c.sla_due_at < ?) AS breached
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN agent_presence p
         ON p.workspace_id = m.workspace_id AND p.user_id = m.user_id
       WHERE m.workspace_id = ?
       ORDER BY active DESC, u.name`,
    )
    .all(Date.now(), workspaceId)
    .map((row) => ({
      id: String(row.id),
      name: String(row.name),
      presence: String(row.presence),
      active: Number(row.active ?? 0),
      breached: Number(row.breached ?? 0),
    }));

  const backlog = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status <> 'resolved' AND assignee_user_id IS NULL
                   THEN 1 ELSE 0 END) AS unassigned,
         SUM(CASE WHEN status <> 'resolved' AND first_response_at IS NULL
                   AND sla_due_at IS NOT NULL AND sla_due_at < ?
                   THEN 1 ELSE 0 END) AS breaching
       FROM conversations WHERE workspace_id = ?`,
    )
    .get(Date.now(), workspaceId);

  return {
    days,
    points,
    totals,
    sla: {
      met: Number(sla?.met ?? 0),
      late: Number(sla?.late ?? 0),
    },
    medianResponseMinutes,
    byChannel,
    workload,
    backlog: {
      unassigned: Number(backlog?.unassigned ?? 0),
      breaching: Number(backlog?.breaching ?? 0),
    },
  };
}

export function reportToCsv(report: ReturnType<typeof buildReport>) {
  const header = "date,conversations_opened,inbound_messages,outbound_messages,internal_notes";
  const rows = report.points.map(
    (point) =>
      `${point.date},${point.opened},${point.inbound},${point.outbound},${point.notes}`,
  );
  return [header, ...rows].join("\n");
}
