import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BrandMark } from "@/app/components/shared/ui";

// Reads the Clerk session, so it is never prerendered.
export const instant = false;

async function Gate() {
  const { userId } = await auth();
  if (userId) redirect("/inbox");

  return (
    <div className="wax-enter w-full max-w-md rounded-2xl border border-fg/[0.08] bg-fg/[0.02] p-8 text-center">
      <div className="wax-pop mx-auto w-fit">
        <BrandMark size="lg" />
      </div>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-fg">Wax</h1>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">
        Omnichannel desk for calls, meetings and every social channel in one
        shared inbox.
      </p>
      {/* Plain links: both routes hand off to Clerk's hosted pages, so no
          embedded script is needed to get into the desk. */}
      <div className="mt-6 flex flex-col gap-2">
        <Link
          href="/sign-in"
          className="wax-press wax-sheen rounded-xl bg-gradient-to-r from-indigo-500 via-purple-500 to-fuchsia-500 px-4 py-2.5 text-xs font-semibold text-white"
        >
          Sign in
        </Link>
        <Link
          href="/sign-up"
          className="wax-press rounded-xl border border-fg/[0.08] bg-fg/[0.03] px-4 py-2.5 text-xs font-medium text-slate-300 transition-colors hover:border-indigo-400/30 hover:text-fg"
        >
          Create an account
        </Link>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center wax-app px-4 text-slate-200">
      <Suspense
        fallback={<p className="text-xs text-slate-500">Loading…</p>}
      >
        <Gate />
      </Suspense>
    </main>
  );
}
