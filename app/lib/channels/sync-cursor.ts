/**
 * Cursor rules for the polling sync.
 *
 * A cursor may only move when the whole fetch succeeded and every message in it
 * was handed to the recorder; a partial fetch keeps the old cursor so the next
 * run fetches the same window again and the unique external id de-duplicates
 * what was already stored. A cursor also never moves backwards.
 *
 * Discord cursors are snowflake ids (numeric, ordered by time) and YouTube
 * cursors are ISO timestamps, so both are compared as ordered strings.
 */
export function advanceCursor(
  current: string | null,
  newest: string | null,
  complete: boolean,
): string | null {
  if (!complete || !newest) return current;
  if (!current) return newest;

  if (/^\d+$/.test(current) && /^\d+$/.test(newest)) {
    return BigInt(newest) > BigInt(current) ? newest : current;
  }

  return newest > current ? newest : current;
}
