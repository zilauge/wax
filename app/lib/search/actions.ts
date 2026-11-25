"use server";

import { requireUser } from "@/app/lib/auth/auth";
import { searchMessages, type MessageHit } from "./store";

/** Searches message bodies in the caller's workspace only. */
export async function searchMessagesAction(query: string): Promise<MessageHit[]> {
  const user = await requireUser();
  const trimmed = query.trim();

  if (trimmed.length < 2) return [];
  return searchMessages(user.workspaceId, trimmed, 5);
}
