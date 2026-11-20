import type { ReactNode } from "react";
import type { Channel } from "@/app/lib/types";

/** Shared button/chip styles so the same surface is not retyped per panel. */
export const chipClass =
  "rounded-lg px-2 py-1 text-[11px] font-medium transition-colors";
export const activeChipClass = "bg-white/10 text-white";
export const idleChipClass = "text-slate-400 hover:text-slate-200";

export const iconButtonClass =
  "rounded-lg border border-white/[0.07] bg-white/[0.03] p-1.5 text-slate-300 transition-colors hover:text-white";

export const primaryButtonClass =
  "ml-auto flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-indigo-400";

export const secondaryButtonClass =
  "rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition-colors hover:bg-white/[0.08]";

export function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");
}

export function LiveDot() {
  return (
    <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-400 text-emerald-400 live-dot" />
  );
}

export function ChannelTile({
  channel,
  size = "md",
}: {
  channel: Channel;
  size?: "sm" | "md";
}) {
  return (
    <span
      aria-label={channel.name}
      className={`flex shrink-0 items-center justify-center rounded-xl font-semibold tracking-tight ${
        size === "sm" ? "h-6 w-6 text-[10px]" : "h-9 w-9 text-xs"
      }`}
      style={{
        backgroundColor: `${channel.color}1f`,
        color: channel.color,
        boxShadow: `inset 0 0 0 1px ${channel.color}33`,
      }}
    >
      {channel.monogram}
    </span>
  );
}

export function Avatar({
  initials: label,
  color,
  size = "md",
}: {
  initials: string;
  color: string;
  size?: "xs" | "sm" | "md";
}) {
  const dimensions =
    size === "xs"
      ? "h-7 w-7 text-[10px]"
      : size === "sm"
        ? "h-8 w-8 text-[11px]"
        : "h-10 w-10 text-xs";

  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${dimensions}`}
      style={{
        background: `linear-gradient(140deg, ${color}, ${color}80)`,
        boxShadow: `inset 0 0 0 1px ${color}66`,
      }}
    >
      {label}
    </span>
  );
}

export function PanelHeader({
  title,
  badge,
  action,
}: {
  title: string;
  badge?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] px-4 py-3">
      <h2 className="text-sm font-medium text-white">{title}</h2>
      {badge && (
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
          {badge}
        </span>
      )}
      {action}
    </div>
  );
}

export function RailCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-white">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}
