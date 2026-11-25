import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hostedAuthUrl, requestOrigin } from "@/app/lib/auth/clerk-hosted";

// Built per request from the query string and the publishable key.
export const instant = false;

/** Account creation happens on Clerk's hosted page, like sign-in. */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const origin = requestOrigin(await headers());
  const target = hostedAuthUrl("sign-up", params, origin);

  if (!target) {
    return (
      <main className="flex min-h-screen items-center justify-center wax-app px-4 text-slate-300">
        <p className="max-w-sm text-center text-xs leading-relaxed">
          Sign-up is not configured: the Clerk publishable key is missing from
          this deployment.
        </p>
      </main>
    );
  }

  redirect(target);
}
