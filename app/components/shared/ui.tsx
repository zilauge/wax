import type { ReactNode } from "react";
import Image from "next/image";
import { ChannelMark } from "@/app/components/shared/channel-marks";
import type { Channel } from "@/app/lib/types";
import photo1 from "@/app/images/profile/user-1.jpg";
import photo2 from "@/app/images/profile/user-2.jpg";
import photo3 from "@/app/images/profile/user-3.jpg";
import photo4 from "@/app/images/profile/user-4.jpg";
import photo5 from "@/app/images/profile/user-5.jpg";
import photo6 from "@/app/images/profile/user-6.jpg";
import photo7 from "@/app/images/profile/user-7.jpg";
import photo8 from "@/app/images/profile/user-8.jpg";
import photo9 from "@/app/images/profile/user-9.jpg";
import photo10 from "@/app/images/profile/user-10.jpg";
import logoIcon from "@/app/images/logos/logoIcon.svg";

const contactPhotos = [
  photo1,
  photo2,
  photo3,
  photo4,
  photo5,
  photo6,
  photo7,
  photo8,
  photo9,
  photo10,
];

/**
 * A stable face per contact: the same id always lands on the same photo, so a
 * conversation does not change identity between renders.
 */
export function ContactAvatar({
  seed,
  size = "md",
}: {
  seed: string;
  size?: "xs" | "sm" | "md" | "lg";
}) {
  let hash = 7;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100003;
  }
  const photo = contactPhotos[hash % contactPhotos.length]!;
  const dimensions =
    size === "xs"
      ? "h-7 w-7"
      : size === "sm"
        ? "h-8 w-8"
        : size === "lg"
          ? "h-20 w-20"
          : "h-10 w-10";
  const pixels = size === "lg" ? 80 : 40;

  return (
    <Image
      src={photo}
      alt=""
      width={pixels}
      height={pixels}
      className={`shrink-0 rounded-full bg-fg/[0.04] object-cover ring-1 ring-fg/10 ${dimensions}`}
    />
  );
}

/** Shared button/chip styles so the same surface is not retyped per panel. */
export const chipClass =
  "rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors wax-press";
export const activeChipClass =
  "bg-fg/[0.09] text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]";
export const idleChipClass = "text-slate-400 hover:bg-fg/[0.03] hover:text-slate-200";

export const iconButtonClass =
  "wax-press grid h-8 w-8 place-items-center rounded-lg border border-fg/[0.08] bg-fg/[0.03] text-slate-300 hover:border-fg/[0.16] hover:bg-fg/[0.07] hover:text-fg";

export const primaryButtonClass =
  "wax-press wax-sheen ml-auto inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-indigo-500 to-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_-16px_rgba(99,102,241,1)] transition-colors hover:from-indigo-400 hover:to-indigo-500";

export const secondaryButtonClass =
  "wax-press inline-flex items-center gap-1.5 rounded-lg border border-fg/[0.09] bg-fg/[0.035] px-3 py-1.5 text-[11px] font-semibold text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-colors hover:border-fg/[0.16] hover:bg-fg/[0.075] hover:text-fg";

/** The Wax mark, on the same tile for every surface that shows the brand. */
export function BrandMark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const box =
    size === "sm"
      ? "h-8 w-8 rounded-[10px]"
      : size === "lg"
        ? "h-11 w-11 rounded-xl"
        : "h-9 w-9 rounded-[11px]";
  const mark =
    size === "sm" ? "h-[18px] w-[18px]" : size === "lg" ? "h-6 w-6" : "h-5 w-5";

  return (
    <span
      className={`flex shrink-0 items-center justify-center border border-fg/[0.08] bg-fg/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ${box}`}
    >
      <Image
        src={logoIcon}
        alt=""
        width={28}
        height={28}
        unoptimized
        className={mark}
      />
    </span>
  );
}

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

/** The tinted square behind a channel mark, shared with the settings rows. */
export function channelTileStyle(color: string) {
  return {
    backgroundColor: `${color}1f`,
    color,
    boxShadow: `inset 0 0 0 1px ${color}33`,
  };
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
      className={`flex shrink-0 items-center justify-center rounded-[10px] ${
        size === "sm" ? "h-6 w-6" : "h-9 w-9"
      }`}
      style={channelTileStyle(channel.color)}
    >
      <ChannelMark
        channel={channel.id}
        className={size === "sm" ? "h-3.5 w-3.5" : "h-[18px] w-[18px]"}
      />
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
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-fg ${dimensions}`}
      style={{
        background: `linear-gradient(140deg, ${color}, ${color}80)`,
        boxShadow: `inset 0 0 0 1px ${color}66, inset 0 1px 0 rgba(255,255,255,0.18)`,
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
    <div className="flex flex-wrap items-center gap-2.5 border-b border-fg/[0.06] px-4 py-3.5">
      <h2 className="text-[13px] font-semibold tracking-tight text-fg">
        {title}
      </h2>
      {badge && (
        <span className="wax-pop rounded-full border border-fg/[0.08] bg-fg/[0.04] px-2 py-0.5 text-[10px] font-medium text-slate-300">
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
    <div className="wax-lift wax-tile p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold tracking-[0.1em] text-slate-300 uppercase">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </div>
  );
}
