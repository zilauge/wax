"use client";

import { useState } from "react";
import type {
  Channel,
  ChannelId,
  ContactIdentity,
  WorkspaceContact,
} from "@/app/lib/types";

const inputClass =
  "w-36 rounded-md border border-fg/[0.08] bg-fg/[0.04] px-2 py-0.5 text-[11px] text-slate-200 placeholder:text-slate-500 focus:border-indigo-500/40 focus:outline-none";

const smallButtonClass =
  "rounded-md border border-fg/[0.08] bg-fg/[0.05] px-2 py-0.5 text-[10px] font-medium text-slate-200 transition-colors hover:bg-fg/[0.1] disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The identity strip under the thread header: every address this customer is
 * known by, an inline form to link one more, and a merge control that folds a
 * duplicate contact into this one.
 */
export default function ContactIdentityStrip({
  identities,
  channels,
  mergeCandidates,
  threadCount,
  busy,
  error,
  onLink,
  onUnlink,
  onMerge,
}: {
  identities: ContactIdentity[];
  channels: Channel[];
  mergeCandidates: WorkspaceContact[];
  threadCount: number;
  busy: boolean;
  error: string | null;
  onLink: (channel: ChannelId, address: string) => void;
  onUnlink: (identityId: string) => void;
  onMerge: (targetContactId: string) => void;
}) {
  const [channel, setChannel] = useState<ChannelId>(
    channels[0]?.id ?? "telegram",
  );
  const [address, setAddress] = useState("");
  const [target, setTarget] = useState("");

  const channelMap = new Map(channels.map((item) => [item.id, item]));

  return (
    <div className="border-b border-fg/[0.06] px-4 py-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="mr-1 text-[10px] tracking-[0.12em] text-slate-600 uppercase">
          Identities
        </span>

        {identities.length === 0 && (
          <span className="text-slate-500">No identity linked yet.</span>
        )}

        {identities.map((identity) => {
          const known = channelMap.get(identity.channel);
          return (
            <span
              key={identity.id}
              className="flex items-center gap-1 rounded-full border border-fg/[0.09] bg-fg/[0.04] px-2 py-0.5"
            >
              <span
                className="font-medium"
                style={{ color: known?.color ?? "#94a3b8" }}
              >
                {known?.name ?? identity.channel}
              </span>
              <span className="text-slate-300">{identity.address}</span>
              <button
                type="button"
                onClick={() => onUnlink(identity.id)}
                disabled={busy}
                aria-label={`Unlink ${identity.address}`}
                title="Unlink this identity"
                className="rounded-full px-1 text-slate-500 transition-colors hover:text-rose-300 disabled:opacity-40"
              >
                ×
              </button>
            </span>
          );
        })}

        <span className="text-[10px] text-slate-600">
          {threadCount === 1 ? "1 thread" : `${threadCount} threads`} on one
          timeline
        </span>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!address.trim() || busy) return;
            onLink(channel, address.trim());
            setAddress("");
          }}
          className="flex items-center gap-1"
        >
          <select
            value={channel}
            onChange={(event) => setChannel(event.target.value as ChannelId)}
            aria-label="Identity channel"
            className="cursor-pointer rounded-md border border-fg/[0.08] bg-fg/[0.04] px-1.5 py-0.5 text-[11px] text-slate-200 focus:outline-none"
          >
            {channels.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="+234… or @handle"
            aria-label="Identity address"
            className={inputClass}
          />
          <button type="submit" disabled={busy} className={smallButtonClass}>
            Link
          </button>
        </form>

        {mergeCandidates.length > 0 && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!target || busy) return;
              onMerge(target);
              setTarget("");
            }}
            className="ml-auto flex items-center gap-1"
          >
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              aria-label="Merge into contact"
              className="max-w-[180px] cursor-pointer rounded-md border border-fg/[0.08] bg-fg/[0.04] px-1.5 py-0.5 text-[11px] text-slate-200 focus:outline-none"
            >
              <option value="">Merge into…</option>
              {mergeCandidates.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name} · {contact.handle}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={busy || !target}
              className={smallButtonClass}
            >
              Merge
            </button>
          </form>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-1.5 text-[10px] text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}
