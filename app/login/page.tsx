import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requestOrigin } from "@/app/lib/auth/clerk-hosted";

export const instant = false;

/** Old links land on Clerk's hosted sign-in and return to the desk. */
export default async function LoginPage() {
  const origin = requestOrigin(await headers());
  const target = origin
    ? `/sign-in?redirect_url=${encodeURIComponent(`${origin}/inbox`)}`
    : "/sign-in";

  redirect(target);
}
