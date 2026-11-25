"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

/**
 * Clerk owns the session cookie, so signing out means revoking the session that
 * issued it. The redirect lands on the hosted sign-in route afterwards.
 */
export async function signOutAction(): Promise<void> {
  const { sessionId } = await auth();

  if (sessionId) {
    const client = await clerkClient();
    await client.sessions.revokeSession(sessionId).catch(() => {
      // An already-revoked or expired session still signs the browser out.
    });
  }

  redirect("/sign-in");
}
