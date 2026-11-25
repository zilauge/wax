/** 1 minute, then 5, then 15 — each failure waits longer than the last. */
export function backoffMs(retryCount: number) {
  return [60_000, 5 * 60_000, 15 * 60_000][Math.min(Math.max(retryCount, 0), 2)];
}
