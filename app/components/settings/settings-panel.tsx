import Link from "next/link";
import type {
  Agent,
  AuditEntry,
  Channel,
  ChannelAuditEntry,
  ChannelConnection,
  JobState,
  Queue,
  Summary,
  TelegramRouting,
} from "@/app/lib/types";
import ChannelManager from "@/app/components/onboarding/channel-manager";
import PhoneCard from "@/app/components/onboarding/phone-card";
import TeamPanel from "@/app/components/settings/team-panel";
import WorkloadPanel from "@/app/components/settings/workload-panel";
import type {
  PendingInvite,
  TeamMember,
  WorkspaceUser,
} from "@/app/lib/types";

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
  channels,
  connections,
  channelAudit,
  members,
  invites,
  audit,
  jobs,
  agents,
  queues,
  summary,
  notice = null,
}: {
  user: WorkspaceUser;
  telegram: TelegramRouting;
  channels: Channel[];
  connections: ChannelConnection[];
  channelAudit: ChannelAuditEntry[];
  members: TeamMember[];
  invites: PendingInvite[];
  audit: AuditEntry[];
  jobs: JobState[];
  agents: Agent[];
  queues: Queue[];
  summary: Summary;
  notice?: string | null;
}) {
  const channelNames = new Map(
    channels.map((channel) => [channel.id, channel.name] as const),
  );

  // Onboarding is a checklist of things this workspace can actually verify,
  // not a tour: each step is done or it is not.
  const steps = [
    {
      label: "Connect an inbound channel",
      done: channels.some((channel) => channel.connected),
      href: "/connect",
    },
    {
      label: "Verify your phone for handover",
      done: user.phoneVerified,
      href: "/settings/profile",
    },
    {
      label: "Add a teammate",
      done: members.length > 1,
      href: "/settings",
    },
    {
      label: "Send an invitation",
      done: invites.length > 0,
      href: "/settings",
    },
  ];
  const done = steps.filter((step) => step.done).length;

  return (
    <div>
      <section className="wax-tile mx-4 mt-4 p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold text-slate-200">
            Getting set up · {done}/{steps.length}
          </p>
          <span className="text-[10px] text-slate-500">
            {done === steps.length ? "All done" : "Finish the rest when you can"}
          </span>
        </div>
        <div
          className="mt-2 h-1 overflow-hidden rounded-full bg-fg/[0.06]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={done}
          aria-label="Workspace setup progress"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-violet-500 shadow-[0_0_12px_rgba(129,140,248,0.5)]"
            style={{ width: `${(done / steps.length) * 100}%` }}
          />
        </div>
        <ul className="mt-2 space-y-1">
          {steps.map((step) => (
            <li key={step.label} className="flex items-center gap-2 text-[11px]">
              <span
                aria-hidden="true"
                className={`flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] ${
                  step.done
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "border border-fg/[0.12] text-transparent"
                }`}
              >
                ✓
              </span>
              {step.done ? (
                <span className="text-slate-400 line-through">{step.label}</span>
              ) : (
                <Link
                  href={step.href}
                  className="text-slate-200 hover:text-indigo-300"
                >
                  {step.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>

      {notice && (
        <p className="mx-4 mt-2 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-3 py-2 text-[11px] text-indigo-200">
          {notice}
        </p>
      )}

      <div className="divide-y divide-fg/[0.04]">
        <section className="py-2">
          <p                   className="wax-eyebrow px-4 pt-2 pb-1">
            Workspace
          </p>
          <Row label="Name" value={user.workspaceName} />
          <Row label="Your role" value={user.role} />
          <Row label="Signed in as" value={user.email} />
          <div className="flex items-center justify-between gap-6 px-4 py-2.5">
            <span className="text-[11px] text-slate-500">Profile</span>
            <Link
              href="/settings/profile"
              className="text-[11px] font-medium text-indigo-400 hover:text-indigo-300"
            >
              View your profile
            </Link>
          </div>
        </section>

        <TeamPanel
          members={members}
          invites={invites}
          currentUserId={user.id}
          canManage={user.role !== "agent"}
          isOwner={user.role === "owner"}
        />

        <WorkloadPanel agents={agents} queues={queues} summary={summary} />

        <PhoneCard phone={user.phone} verified={user.phoneVerified} />

        <ChannelManager
          channels={channels}
          connections={connections}
          canManage={user.role !== "agent"}
        />

        <section className="py-2">
          <p className="wax-eyebrow px-4 pt-2 pb-1">Activity log</p>
          {audit.length === 0 ? (
            <p className="px-4 pb-2 text-[11px] text-slate-500">
              Nothing irreversible has happened yet. Contact exports and
              deletions, role changes and invitations are recorded here.
            </p>
          ) : (
            <ul className="divide-y divide-fg/[0.04]">
              {audit.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-start justify-between gap-4 px-4 py-2"
                >
                  <span className="min-w-0 text-[11px] text-slate-300">
                    <span className="font-medium text-slate-200">
                      {entry.actorName}
                    </span>{" "}
                    {entry.action.replace(".", " ")}{" "}
                    <span className="text-slate-400">{entry.target}</span>
                    {entry.detail && (
                      <span className="block text-[10px] text-slate-500">
                        {entry.detail}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-right text-[10px] text-slate-500">
                    {new Date(entry.at).toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="py-2">
          <p                   className="wax-eyebrow px-4 pt-2 pb-1">
            Background jobs
          </p>
          {jobs.length === 0 ? (
            <p className="px-4 pb-2 text-[11px] text-slate-500">
              No background job has run yet. Delivery retries, SLA escalation
              and daily backups record their last outcome here.
            </p>
          ) : (
            <ul className="divide-y divide-fg/[0.04]">
              {jobs.map((job) => (
                <li key={job.name} className="px-4 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-[11px] font-medium text-slate-300">
                      {job.label}
                    </span>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-medium ${
                        job.lastStatus === "error"
                          ? "border-rose-400/25 bg-rose-400/10 text-rose-300"
                          : job.lastStatus === "ok"
                            ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                            : "border-fg/[0.1] text-slate-400"
                      }`}
                    >
                      {job.lastStatus ?? "never run"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    {job.lastFinishedAt
                      ? `last ran ${new Date(job.lastFinishedAt).toLocaleString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })} · ${job.runCount} runs`
                      : `${job.runCount} runs`}
                  </p>
                  {job.lastError && (
                    <p className="mt-0.5 text-[10px] text-rose-300/90">
                      {job.lastError}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="py-2">
          <p                   className="wax-eyebrow px-4 pt-2 pb-1">
            Channel history
          </p>
          {channelAudit.length === 0 ? (
            <p className="px-4 pb-2 text-[11px] text-slate-500">
              No channel has been connected or disconnected yet.
            </p>
          ) : (
            <ul className="divide-y divide-fg/[0.04]">
              {channelAudit.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-4 px-4 py-2"
                >
                  <span className="text-[11px] text-slate-300">
                    {entry.action === "connected" ? "Linked" : "Disconnected"}{" "}
                    {channelNames.get(entry.channel) ?? entry.channel}
                  </span>
                  <span className="text-right text-[10px] text-slate-500">
                    {entry.actorName} ·{" "}
                    {new Date(entry.at).toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
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

          <p className="wax-tile-soft mx-4 mt-2 px-3 py-2.5 text-[10px] leading-relaxed text-slate-500">
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
