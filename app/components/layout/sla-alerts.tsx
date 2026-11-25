"use client";

import { useEffect, useRef, useState } from "react";
import type { Conversation } from "@/app/lib/types";

/**
 * Desktop alerts for conversations that breach their response promise. The
 * browser only allows notifications after a click, so permission is requested
 * from a visible button rather than on load.
 */
export default function SlaAlerts({
  conversations,
}: {
  conversations: Conversation[];
}) {
  const notified = useRef<Set<string>>(new Set());
  // null until the person answers the prompt; the browser's own state is the
  // source of truth, so nothing is mirrored into React on mount.
  const [permission, setPermission] = useState<NotificationPermission | null>(null);

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;

    const breached = conversations.filter(
      (conversation) =>
        conversation.sla?.state === "breached" &&
        !notified.current.has(conversation.id),
    );
    if (breached.length === 0) return;

    for (const conversation of breached) {
      notified.current.add(conversation.id);
    }

    const [first, ...rest] = breached;
    const title =
      breached.length === 1
        ? `SLA breached · ${first.contact.name}`
        : `${breached.length} conversations past their SLA`;
    const body =
      breached.length === 1
        ? `${first.channel} · ${first.sla?.label ?? "Waiting too long"}`
        : `${first.contact.name} and ${rest.length} more need a reply.`;

    try {
      new Notification(title, { body, tag: `wax-sla-${first.id}` });
    } catch {
      // Some browsers refuse notifications in insecure contexts; the badges in
      // the inbox still show the breach, so nothing else is required here.
    }
  }, [conversations]);

  async function enable() {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermission(result);
  }

  if (permission === "granted" || permission === "denied") return null;

  return (
    <button
      type="button"
      onClick={enable}
      className="rounded-full border border-fg/[0.08] bg-fg/[0.03] px-2.5 py-1 text-[10px] text-slate-400 transition-colors hover:text-fg"
      title="Get a desktop alert when a conversation breaches its SLA"
    >
      Enable SLA alerts
    </button>
  );
}
