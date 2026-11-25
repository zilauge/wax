import { getSessionUser } from "@/app/lib/auth/auth";
import {
  buildReport,
  parseRange,
  reportToCsv,
} from "@/app/lib/analytics/report";

/**
 * The same numbers the analytics page shows, as a CSV. Scoped to the session's
 * workspace, and only counts — no customer text leaves in this export.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const range = parseRange(new URL(request.url).searchParams.get("range") ?? undefined);
  const csv = reportToCsv(buildReport(user.workspaceId, range));

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="wax-analytics-${range}d.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
