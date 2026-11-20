"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Channel, ChannelConnection } from "@/app/lib/types";
import {
  disconnectChannelAction,
  startChannelConnectionAction,
} from "@/app/lib/channels/actions";
import type { SocialChannelId } from "@/app/lib/channels/providers";

const socialChannels: SocialChannelId[] = [
  "instagram",
  "whatsapp",
  "tiktok",
  "x",
];

const requiredEnv: Record<SocialChannelId, string> = {
  instagram: "META_APP_ID + META_APP_SECRET",
  whatsapp: "META_APP_ID + META_APP_SECRET",
  tiktok: "TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET",
  x: "X_CLIENT_ID + X_CLIENT_SECRET",
};

const statusStyle: Record<"connected" | "error" | "off", string> = {
  connected: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  error: "border-rose-400/25 bg-rose-400/10 text-rose-300",
  off: "border-white/10 bg-white/[0.03] text-slate-400",
};

/**
 * Link and unlink the workspace's social accounts. A channel can only be
 * connected when its provider credentials exist on the server; the button says
 * so instead of sending the browser to a provider that would reject it.
 */
export default function ChannelManager({
  channels,
  connections,
}: {
  channels: Channel[];
  connections: ChannelConnection[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<SocialChannelId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function channelFor(id: SocialChannelId) {
    return channels.find((channel) => channel.id === id);
  }

  async function connect(id: SocialChannelId) {
    setError(null);
    setNotice(null);
    setBusy(id);
    const result = await startChannelConnectionAction(id);
    setBusy(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    window.location.assign(result.url);
  }

  function disconnect(id: SocialChannelId) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await disconnectChannelAction(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice("Channel disconnected.");
      router.refresh();
    });
  }

  return (
    <section>
      <div className="flex items-center justify-between px-4 pt-2 pb-1">
        <p className="text-[10px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
          Social accounts
        </p>
        <span className="text-[10px] text-slate-500">
          {connections.length} linked
        </span>
      </div>

      {error && (
        <p
          role="alert"
          className="mx-4 mb-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300"
        >
          {error}
        </p>
      )}
      {notice && (
        <p className="mx-4 mb-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-300">
          {notice}
        </p>
      )}

      <ul className="divide-y divide-white/[0.04]">
        {socialChannels.map((id) => {
          const channel = channelFor(id);
          const connection = connections.find((item) => item.channel === id);
          const connected = Boolean(connection);
          const working = busy === id || (pending && busy === id);

          return (
            <li
              key={id}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <span
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[10px] font-semibold text-white"
                style={{ backgroundColor: channel?.color ?? "#334155" }}
              >
                {channel?.monogram ?? id.slice(0, 2)}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-slate-200">
                  {channel?.name ?? id}
                </p>
                <p className="truncate text-[10px] text-slate-500">
                  {connected
                    ? (connection?.accountName ?? "Linked account")
                    : channel?.configured
                      ? "Ready to link"
                      : `Server needs ${requiredEnv[id]}`}
                </p>
              </div>

              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                  statusStyle[connected ? "connected" : "off"]
                }`}
              >
                {connected ? "Connected" : "Not connected"}
              </span>

              {connected ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => disconnect(id)}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition-colors hover:border-rose-400/40 hover:text-rose-300 disabled:opacity-60"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  disabled={working}
                  onClick={() => connect(id)}
                  className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1.5 text-[11px] font-medium text-indigo-200 transition-colors hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {working ? "Opening…" : "Connect"}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mx-4 mt-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[10px] leading-relaxed text-slate-500">
        Connecting opens the provider&apos;s own consent screen. Callback URLs
        must be registered with each app:
        <span className="mt-1 block font-mono text-slate-400">
          /api/channels/instagram/callback · /api/channels/whatsapp/callback ·
          /api/channels/tiktok/callback · /api/channels/x/callback
        </span>
      </p>
    </section>
  );
}
