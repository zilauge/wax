import "server-only";

import type { RealtimeEvent } from "@/app/lib/types";

/**
 * In-process fan-out for the dashboard's live channel.
 *
 * Each open dashboard connects to /api/events, which subscribes here under the
 * workspace resolved from its session. Publishing is workspace-scoped by
 * construction: a subscriber only ever receives events published with the same
 * workspace id, so one tenant's activity can never leak into another tenant's
 * stream.
 *
 * The registry lives on globalThis so a development HMR reload keeps the open
 * streams attached to the same Set.
 */
type Subscriber = (event: RealtimeEvent) => void;

const globalForRealtime = globalThis as unknown as {
  waxRealtimeSubscribers?: Map<string, Set<Subscriber>>;
};

const subscribers =
  globalForRealtime.waxRealtimeSubscribers ??
  (globalForRealtime.waxRealtimeSubscribers = new Map<string, Set<Subscriber>>());

export function subscribeWorkspace(
  workspaceId: string,
  subscriber: Subscriber,
): () => void {
  let set = subscribers.get(workspaceId);
  if (!set) {
    set = new Set<Subscriber>();
    subscribers.set(workspaceId, set);
  }
  set.add(subscriber);

  return () => {
    const current = subscribers.get(workspaceId);
    if (!current) return;
    current.delete(subscriber);
    if (current.size === 0) subscribers.delete(workspaceId);
  };
}

export function publishWorkspaceEvent(
  workspaceId: string,
  event: Omit<RealtimeEvent, "at">,
): void {
  const set = subscribers.get(workspaceId);
  if (!set || set.size === 0) return;

  const payload: RealtimeEvent = { ...event, at: Date.now() };

  for (const subscriber of [...set]) {
    try {
      subscriber(payload);
    } catch {
      // A disconnected stream must never make the write that triggered it fail.
      set.delete(subscriber);
    }
  }
}
