"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChannelMark } from "@/app/components/shared/channel-marks";
import { channelTileStyle } from "@/app/components/shared/ui";
import type { Channel, ChannelConnection, ChannelId } from "@/app/lib/types";
import {
  connectDiscordChannelAction,
  connectSmsChannelAction,
  connectXCredentialsAction,
  disconnectChannelAction,
  startChannelConnectionAction,
  syncChannelsNowAction,
} from "@/app/lib/channels/actions";
import type { SocialChannelId } from "@/app/lib/channels/providers";

const socialChannels: SocialChannelId[] = [
  "instagram",
  "whatsapp",
  "tiktok",
  "x",
  "youtube",
];

const requiredEnv: Record<SocialChannelId, string> = {
  instagram: "META_APP_ID + META_APP_SECRET",
  whatsapp: "META_APP_ID + META_APP_SECRET",
  tiktok: "TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET",
  x: "X_CLIENT_ID + X_CLIENT_SECRET",
  youtube: "GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET",
};

const providerLabels: Record<string, string> = {
  meta: "Meta Cloud API",
  wati: "WATI",
  twilio: "Twilio",
  discord: "Discord bot",
  google: "Google API",
  tiktok: "TikTok",
  x: "X",
};

function linkedOn(timestamp: number | null) {
  if (!timestamp) return "date not recorded";
  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const statusStyle: Record<"connected" | "error" | "off", string> = {
  connected: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  error: "border-rose-400/25 bg-rose-400/10 text-rose-300",
  off: "border-white/10 bg-white/[0.03] text-slate-400",
};

const fieldClass =
  "w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-indigo-400/40";

/**
 * Link and unlink the workspace's social accounts. A channel can only be
 * connected when its provider credentials exist on the server; the button says
 * so instead of sending the browser to a provider that would reject it. SMS is
 * different: the owner enters the Twilio credentials here, so no server-wide
 * environment variables are needed.
 */
export default function ChannelManager({
  channels,
  connections,
  canManage,
}: {
  channels: Channel[];
  connections: ChannelConnection[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<ChannelId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [smsOpen, setSmsOpen] = useState(false);
  const [smsForm, setSmsForm] = useState({
    accountSid: "",
    authToken: "",
    from: "",
  });
  const [discordOpen, setDiscordOpen] = useState(false);
  const [discordToken, setDiscordToken] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [xKeysOpen, setXKeysOpen] = useState(false);
  const [xKeys, setXKeys] = useState({
    consumerKey: "",
    consumerSecret: "",
    accessToken: "",
    accessTokenSecret: "",
  });

  function channelFor(id: ChannelId) {
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

  function disconnect(id: ChannelId) {
    const label = channelFor(id)?.name ?? id;
    const confirmed = window.confirm(
      `Disconnect ${label}?\n\nInbound messages stop arriving and replies can no longer be sent on this channel until it is linked again.`,
    );
    if (!confirmed) return;

    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await disconnectChannelAction(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSmsOpen(false);
      setNotice("Channel disconnected.");
      router.refresh();
    });
  }

  async function connectSms() {
    setError(null);
    setNotice(null);
    setBusy("sms");
    const result = await connectSmsChannelAction(smsForm);
    setBusy(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setSmsForm({ accountSid: "", authToken: "", from: "" });
    setSmsOpen(false);
    setNotice("SMS number linked.");
    router.refresh();
  }

  async function syncNow() {
    setError(null);
    setNotice(null);
    setSyncing(true);
    const result = await syncChannelsNowAction();
    setSyncing(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setNotice(result.message);
    router.refresh();
  }

  async function connectXKeys() {
    setError(null);
    setNotice(null);
    setBusy("x");
    const result = await connectXCredentialsAction(xKeys);
    setBusy(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setXKeys({
      consumerKey: "",
      consumerSecret: "",
      accessToken: "",
      accessTokenSecret: "",
    });
    setXKeysOpen(false);
    setNotice("X linked with API keys.");
    router.refresh();
  }

  async function connectDiscord() {
    setError(null);
    setNotice(null);
    setBusy("discord");
    const result = await connectDiscordChannelAction({ botToken: discordToken });
    setBusy(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setDiscordToken("");
    setDiscordOpen(false);
    setNotice("Discord bot linked.");
    router.refresh();
  }

  const smsChannel = channelFor("sms");
  const smsConnection = connections.find((item) => item.channel === "sms");
  const discordChannel = channelFor("discord");
  const discordConnection = connections.find(
    (item) => item.channel === "discord",
  );

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
                className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={channelTileStyle(channel?.color ?? "#94a3b8")}
              >
                <ChannelMark channel={id} className="h-4 w-4" />
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
                {connected && connection && (
                  <p className="truncate text-[10px] text-slate-600">
                    {providerLabels[connection.provider] ?? connection.provider} ·
                    linked {linkedOn(connection.connectedAt)}
                  </p>
                )}
                {connected && id === "x" && connection?.inboundState && (
                  <p
                    title={connection.inboundNote ?? undefined}
                    className={`mt-0.5 text-[10px] ${
                      connection.inboundState === "unavailable"
                        ? "text-amber-300/90"
                        : "text-emerald-300/80"
                    }`}
                  >
                    {connection.inboundState === "unavailable"
                      ? "Replies only — X is not returning incoming messages (no DM read access)"
                      : "Two-way — incoming X messages are read"}
                  </p>
                )}
                {connection?.lastError && (
                  <p className="mt-0.5 line-clamp-2 text-[10px] text-rose-300/90">
                    Last send failed: {connection.lastError}
                  </p>
                )}
              </div>

              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                  statusStyle[
                    connected
                      ? connection?.lastError
                        ? "error"
                        : "connected"
                      : "off"
                  ]
                }`}
              >
                {connected
                  ? connection?.lastError
                    ? "Needs attention"
                    : "Connected"
                  : "Not connected"}
              </span>

              {!canManage ? (
                <span className="text-[10px] text-slate-500">
                  Owner or admin required
                </span>
              ) : connected ? (
                <div className="flex items-center gap-1.5">
                  {(id === "youtube" || id === "x") && (
                    <button
                      type="button"
                      disabled={syncing}
                      onClick={() => void syncNow()}
                      className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition-colors hover:border-indigo-400/40 hover:text-indigo-200 disabled:opacity-60"
                    >
                      {syncing ? "Syncing…" : "Sync now"}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => disconnect(id)}
                    className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition-colors hover:border-rose-400/40 hover:text-rose-300 disabled:opacity-60"
                  >
                    Disconnect
                  </button>
                </div>
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

              {!connected && id === "x" && canManage && (
                <div className="w-full border-t border-white/[0.04] pt-2">
                  <button
                    type="button"
                    onClick={() => setXKeysOpen((open) => !open)}
                    className="text-[10px] text-slate-500 underline decoration-dotted underline-offset-2 hover:text-slate-300"
                  >
                    {xKeysOpen
                      ? "Hide API key form"
                      : "No OAuth 2.0 client? Use API keys"}
                  </button>

                  {xKeysOpen && (
                    <form
                      className="mt-2 space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void connectXKeys();
                      }}
                    >
                      {(
                        [
                          ["consumerKey", "API key"],
                          ["consumerSecret", "API key secret"],
                          ["accessToken", "Access token"],
                          ["accessTokenSecret", "Access token secret"],
                        ] as const
                      ).map(([field, label]) => (
                        <label
                          key={field}
                          className="block text-[10px] text-slate-500"
                        >
                          {label}
                          <input
                            required
                            autoComplete="off"
                            type={
                              field === "consumerKey" || field === "accessToken"
                                ? "text"
                                : "password"
                            }
                            value={xKeys[field]}
                            onChange={(event) =>
                              setXKeys({ ...xKeys, [field]: event.target.value })
                            }
                            className={`mt-1 ${fieldClass}`}
                          />
                        </label>
                      ))}
                      <button
                        type="submit"
                        disabled={busy === "x"}
                        className="w-full rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1.5 text-[11px] font-medium text-indigo-200 transition-colors hover:bg-indigo-500/20 disabled:opacity-60"
                      >
                        {busy === "x" ? "Checking with X…" : "Link keys"}
                      </button>
                      <p className="text-[10px] leading-relaxed text-slate-600">
                        Keys are checked against X before they are stored and
                        never leave the server. The app needs the “Read, write
                        and access Direct Messages” permission for two-way X;
                        “Read” alone cannot reach DMs.
                      </p>
                    </form>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between px-4 pt-4 pb-1">
        <p className="text-[10px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
          Bots and phone
        </p>
      </div>

      <ul className="divide-y divide-white/[0.04]">
        <li className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={channelTileStyle(discordChannel?.color ?? "#5865f2")}
            >
              <ChannelMark channel="discord" className="h-4 w-4" />
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-200">Discord</p>
              <p className="truncate text-[10px] text-slate-500">
                {discordConnection
                  ? (discordConnection.accountName ?? "Linked bot")
                  : "Link a bot to answer member DMs"}
              </p>
              {discordConnection && (
                <p className="truncate text-[10px] text-slate-600">
                  {providerLabels[discordConnection.provider] ??
                    discordConnection.provider}{" "}
                  · linked {linkedOn(discordConnection.connectedAt)}
                </p>
              )}
              {discordConnection?.lastError && (
                <p className="mt-0.5 line-clamp-2 text-[10px] text-rose-300/90">
                  Last send failed: {discordConnection.lastError}
                </p>
              )}
            </div>

            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                statusStyle[
                  discordConnection
                    ? discordConnection.lastError
                      ? "error"
                      : "connected"
                    : "off"
                ]
              }`}
            >
              {discordConnection
                ? discordConnection.lastError
                  ? "Needs attention"
                  : "Connected"
                : "Not connected"}
            </span>

            {!canManage ? (
              <span className="text-[10px] text-slate-500">
                Owner or admin required
              </span>
            ) : discordConnection ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={syncing}
                  onClick={() => void syncNow()}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition-colors hover:border-indigo-400/40 hover:text-indigo-200 disabled:opacity-60"
                >
                  {syncing ? "Syncing…" : "Sync now"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => disconnect("discord")}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition-colors hover:border-rose-400/40 hover:text-rose-300 disabled:opacity-60"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setDiscordOpen((open) => !open);
                }}
                className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1.5 text-[11px] font-medium text-indigo-200 transition-colors hover:bg-indigo-500/20"
              >
                {discordOpen ? "Cancel" : "Connect"}
              </button>
            )}
          </div>

          {discordOpen && !discordConnection && canManage && (
            <form
              className="mt-3 space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void connectDiscord();
              }}
            >
              <label className="block text-[10px] text-slate-500">
                Bot token
                <input
                  required
                  type="password"
                  autoComplete="off"
                  value={discordToken}
                  onChange={(event) => setDiscordToken(event.target.value)}
                  placeholder="Bot token from the Discord developer portal"
                  className={`mt-1 ${fieldClass}`}
                />
              </label>
              <button
                type="submit"
                disabled={busy === "discord"}
                className="w-full rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1.5 text-[11px] font-medium text-indigo-200 transition-colors hover:bg-indigo-500/20 disabled:opacity-60"
              >
                {busy === "discord" ? "Checking with Discord…" : "Link bot"}
              </button>
              <p className="text-[10px] leading-relaxed text-slate-600">
                Enable the Message Content intent in the developer portal so the
                bot can read DMs. The server polls for new DMs, X messages and
                YouTube comments on its own timer (every 5 minutes by default);
                use <span className="text-slate-400">Sync now</span> to pull
                immediately.
              </p>
            </form>
          )}
        </li>

        <li className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={channelTileStyle(smsChannel?.color ?? "#f22f46")}
            >
              <ChannelMark channel="sms" className="h-4 w-4" />
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-200">SMS</p>
              <p className="truncate text-[10px] text-slate-500">
                {smsConnection
                  ? (smsConnection.accountName ?? "Linked number")
                  : "Link a Twilio number to send and receive texts"}
              </p>
              {smsConnection && (
                <p className="truncate text-[10px] text-slate-600">
                  {providerLabels[smsConnection.provider] ??
                    smsConnection.provider}{" "}
                  · linked {linkedOn(smsConnection.connectedAt)}
                </p>
              )}
              {smsConnection?.lastError && (
                <p className="mt-0.5 line-clamp-2 text-[10px] text-rose-300/90">
                  Last send failed: {smsConnection.lastError}
                </p>
              )}
            </div>

            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                statusStyle[
                  smsConnection
                    ? smsConnection.lastError
                      ? "error"
                      : "connected"
                    : "off"
                ]
              }`}
            >
              {smsConnection
                ? smsConnection.lastError
                  ? "Needs attention"
                  : "Connected"
                : "Not connected"}
            </span>

            {!canManage ? (
              <span className="text-[10px] text-slate-500">
                Owner or admin required
              </span>
            ) : smsConnection ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => disconnect("sms")}
                className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition-colors hover:border-rose-400/40 hover:text-rose-300 disabled:opacity-60"
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setSmsOpen((open) => !open);
                }}
                className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1.5 text-[11px] font-medium text-indigo-200 transition-colors hover:bg-indigo-500/20"
              >
                {smsOpen ? "Cancel" : "Connect"}
              </button>
            )}
          </div>

          {smsOpen && !smsConnection && canManage && (
            <form
              className="mt-3 space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void connectSms();
              }}
            >
              <label className="block text-[10px] text-slate-500">
                Account SID
                <input
                  required
                  autoComplete="off"
                  value={smsForm.accountSid}
                  onChange={(event) =>
                    setSmsForm({ ...smsForm, accountSid: event.target.value })
                  }
                  placeholder="ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                  className={`mt-1 ${fieldClass}`}
                />
              </label>
              <label className="block text-[10px] text-slate-500">
                Auth token
                <input
                  required
                  type="password"
                  autoComplete="off"
                  value={smsForm.authToken}
                  onChange={(event) =>
                    setSmsForm({ ...smsForm, authToken: event.target.value })
                  }
                  placeholder="Twilio auth token"
                  className={`mt-1 ${fieldClass}`}
                />
              </label>
              <label className="block text-[10px] text-slate-500">
                Sending number
                <input
                  required
                  value={smsForm.from}
                  onChange={(event) =>
                    setSmsForm({ ...smsForm, from: event.target.value })
                  }
                  placeholder="+15551234567"
                  className={`mt-1 ${fieldClass}`}
                />
              </label>
              <button
                type="submit"
                disabled={busy === "sms"}
                className="w-full rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1.5 text-[11px] font-medium text-indigo-200 transition-colors hover:bg-indigo-500/20 disabled:opacity-60"
              >
                {busy === "sms" ? "Checking with Twilio…" : "Link number"}
              </button>
              <p className="text-[10px] leading-relaxed text-slate-600">
                The pair is checked with Twilio before it is stored, and the
                auth token never leaves the server. Point the number&apos;s
                messaging webhook and status callback at{" "}
                <span className="font-mono text-slate-400">
                  /api/webhooks/twilio
                </span>
                .
              </p>
            </form>
          )}
        </li>
      </ul>

      <p className="mx-4 mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[10px] leading-relaxed text-slate-500">
        Connecting opens the provider&apos;s own consent screen. Callback and
        webhook URLs must be registered with each app:
        <span className="mt-1 block font-mono text-slate-400">
          /api/channels/instagram/callback · /api/channels/whatsapp/callback ·
          /api/channels/tiktok/callback · /api/channels/x/callback
        </span>
        <span className="mt-1 block font-mono text-slate-400">
          WhatsApp + Instagram webhooks: /api/webhooks/whatsapp,
          /api/webhooks/instagram · SMS: /api/webhooks/twilio
        </span>
      </p>
    </section>
  );
}
