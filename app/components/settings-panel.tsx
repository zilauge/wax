import type { TelegramRouting, WorkspaceUser } from "../lib/types";
import { PanelHeader } from "./ui";

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-6 px-4 py-2.5">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span
        className={`max-w-[60%] text-right text-[11px] text-slate-200 ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Read-only workspace settings. The Telegram card answers the question an
 * operator actually has when inbound mail looks wrong: which bot feeds this
 * workspace, and is it wired for sending?
 */
export default function SettingsPanel({
  user,
  telegram,
}: {
  user: WorkspaceUser;
  telegram: TelegramRouting;
}) {
  return (
    <div>
      <PanelHeader title="Settings" badge={user.workspaceName} />

      <div className="divide-y divide-white/[0.04]">
        <section className="py-2">
          <p className="px-4 pt-2 pb-1 text-[10px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
            Workspace
          </p>
          <Row label="Name" value={user.workspaceName} />
          <Row label="Your role" value={user.role} />
          <Row label="Signed in as" value={user.email} />
        </section>

        <section className="py-2">
          <div className="flex items-center justify-between px-4 pt-2 pb-1">
            <p className="text-[10px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
              Telegram routing
            </p>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                telegram.bound
                  ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                  : "border-amber-400/25 bg-amber-400/10 text-amber-300"
              }`}
            >
              {telegram.bound ? "Bound to this workspace" : "Not bound"}
            </span>
          </div>

          <Row
            label="Inbound bot"
            value={
              telegram.bound
                ? telegram.botUsername
                  ? `@${telegram.botUsername}`
                  : "Bound, username not recorded"
                : "No bot is bound to this workspace"
            }
          />
          <Row label="Bound on" value={telegram.boundAt ?? "—"} />
          <Row label="Webhook path" value="/api/webhooks/telegram" mono />
          <Row
            label="Outbound token"
            value={
              telegram.tokenConfigured
                ? "Configured on the server"
                : "Not configured — replies cannot be sent"
            }
          />

          <p className="mx-4 mt-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[10px] leading-relaxed text-slate-500">
            Inbound updates are routed by the bot&apos;s webhook secret, never by
            guessing a workspace. If this workspace is not bound, an operator can
            bind a bot with{" "}
            <span className="font-mono text-slate-300">
              npm run telegram:bind
            </span>
            ; updates from an unbound bot are rejected.
          </p>
        </section>
      </div>
    </div>
  );
}
