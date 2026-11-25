import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requestOrigin } from "@/app/lib/auth/clerk-hosted";

export const instant = false;

/** Old links land on Clerk's hosted sign-up and return to the desk. */
export default async function SignupPage() {
  const origin = requestOrigin(await headers());
  const target = origin
    ? `/sign-up?redirect_url=${encodeURIComponent(`${origin}/inbox`)}`
    : "/sign-up";

  redirect(target);
}
