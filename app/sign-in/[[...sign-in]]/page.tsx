import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hostedAuthUrl, requestOrigin } from "@/app/lib/auth/clerk-hosted";

// The target URL is built per request, so this route is never prerendered.
export const instant = false;

/**
 * Sign-in is Clerk's own hosted page. Nothing is embedded here, so a broken or
 * blocked clerk-js bundle can never leave the desk without a way in.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const origin = requestOrigin(await headers());
  const target = hostedAuthUrl("sign-in", params, origin);

  if (!target) {
    return (
      <main className="flex min-h-screen items-center justify-center wax-app px-4 text-slate-300">
        <p className="max-w-sm text-center text-xs leading-relaxed">
          Sign-in is not configured: the Clerk publishable key is missing from
          this deployment.
        </p>
      </main>
    );
  }

  redirect(target);
}
