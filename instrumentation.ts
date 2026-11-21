/**
 * Next calls `register` once per server instance, before it accepts requests.
 * The polling sync for Discord DMs and YouTube comments is a background timer,
 * so this is where it is started for a self-hosted install — no scheduler or
 * external cron is required. `WAX_SYNC_DISABLED=1` turns it off and
 * `WAX_SYNC_INTERVAL_MINUTES` changes the cadence (default 5).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Static generation during `next build` is not a running server.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { startChannelPolling } = await import("@/app/lib/channels/sync");
  startChannelPolling();
}
