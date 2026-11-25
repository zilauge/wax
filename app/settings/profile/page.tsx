import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { requireUser } from "@/app/lib/auth/auth";
import {
  initials,
  secondaryButtonClass,
} from "@/app/components/shared/ui";
import profileCover from "@/app/images/background/profile-cover.jpg";

export const metadata: Metadata = { title: "Profile — Wax" };

// Reads the session on every request.
export const instant = false;

export default async function ProfilePage() {
  const user = await requireUser();

  const fields: { label: string; value: string; mono?: boolean }[] = [
    { label: "Name", value: user.name },
    { label: "Email", value: user.email, mono: true },
    { label: "Mobile", value: user.phone ?? "Not added" },
    { label: "Role", value: user.role },
    { label: "Workspace", value: user.workspaceName },
  ];

  return (
    <div className="wax-app min-h-screen px-4 py-10 text-slate-200">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="wax-eyebrow">{user.workspaceName}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">
              Profile
            </h1>
          </div>
          <Link href="/settings" className={secondaryButtonClass}>
            Back to settings
          </Link>
        </div>

        <section className="wax-panel wax-enter mt-6 overflow-hidden">
          <div className="relative h-28 w-full">
            <Image
              src={profileCover}
              alt=""
              fill
              sizes="(max-width: 768px) 100vw, 768px"
              className="object-cover"
            />
          </div>

          <div className="px-5 pb-5">
            <div className="-mt-7 flex flex-wrap items-center gap-3">
              <span className="grid h-14 w-14 place-items-center rounded-full border-4 border-[var(--wax-base)] bg-gradient-to-br from-indigo-400 to-indigo-600 text-sm font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]">
                {initials(user.name)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold tracking-tight text-fg">
                  {user.name}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-slate-400">
                  {user.role} · {user.workspaceName}
                </p>
              </div>
              <span
                className={`ml-auto rounded-full border px-2.5 py-1 text-[10px] font-medium ${
                  user.phoneVerified
                    ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                    : "border-amber-400/25 bg-amber-400/10 text-amber-300"
                }`}
              >
                {user.phoneVerified ? "Mobile verified" : "Mobile not verified"}
              </span>
            </div>

            <div className="mt-6 grid gap-5 border-t border-fg/[0.06] pt-5 sm:grid-cols-2">
              {fields.map((field) => (
                <div key={field.label} className="min-w-0">
                  <p className="text-[11px] text-slate-500">{field.label}</p>
                  <p
                    className={`mt-1 truncate text-sm font-medium text-slate-100 ${
                      field.mono ? "font-mono" : ""
                    }`}
                  >
                    {field.value}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-fg/[0.06] pt-5">
              <Link
                href="/connect"
                className="wax-press wax-sheen inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-indigo-500 to-indigo-600 px-3.5 py-2 text-[11px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_-16px_rgba(45,72,170,1)] transition-colors hover:from-indigo-400 hover:to-indigo-500"
              >
                Connect accounts
              </Link>
              <Link href="/settings" className={secondaryButtonClass}>
                Workspace settings
              </Link>
            </div>
          </div>
        </section>

        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Your name, email and password are set when the account is created. The
          mobile number used for calls is verified from{" "}
          <Link
            href="/settings"
            className="font-medium text-indigo-400 transition-colors hover:text-indigo-300"
          >
            settings
          </Link>
          , where you can also link the channels this workspace answers from.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Link
            href="/inbox"
            className="wax-press wax-sheen inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-indigo-500 to-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_16px_34px_-20px_rgba(45,72,170,1)] transition-colors hover:from-indigo-400 hover:to-indigo-500"
          >
            Go to the desk
          </Link>
        </div>
      </div>
    </div>
  );
}
