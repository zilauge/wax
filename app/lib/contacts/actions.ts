"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/app/lib/auth/auth";
import {
  attachIdentity,
  mergeContacts,
  unlinkIdentity,
} from "@/app/lib/contacts/identities";
import { db } from "@/app/lib/db/db";
import { publishWorkspaceEvent } from "@/app/lib/workspace/realtime";
import type { ChannelId } from "@/app/lib/types";

export type ContactActionResult = { ok: true } | { ok: false; error: string };

const CHANNEL_VALUES: ChannelId[] = [
  "instagram",
  "tiktok",
  "whatsapp",
  "x",
  "telegram",
  "sms",
  "discord",
  "youtube",
];

function contactInWorkspace(contactId: string, workspaceId: string) {
  return db
    .prepare("SELECT id, name FROM contacts WHERE id = ? AND workspace_id = ?")
    .get(contactId, workspaceId) as { id: string; name: string } | undefined;
}

/** Links a phone number or handle on one channel to an existing contact. */
export async function linkContactIdentityAction(
  contactId: string,
  channel: ChannelId,
  address: string,
): Promise<ContactActionResult> {
  const user = await requireUser();

  if (!CHANNEL_VALUES.includes(channel)) {
    return { ok: false, error: "Unknown channel." };
  }

  const contact = contactInWorkspace(contactId, user.workspaceId);
  if (!contact) {
    return { ok: false, error: "That contact is not in your workspace." };
  }

  const result = attachIdentity(db, {
    workspaceId: user.workspaceId,
    contactId,
    channelId: channel,
    raw: address,
  });

  if (!result.ok) return result;

  publishWorkspaceEvent(user.workspaceId, {
    kind: "contact",
    text: `${result.identity.channel} identity linked to ${String(contact.name)}`,
  });

  refresh();
  return { ok: true };
}

/** Detaches one address from a contact, keeping at least one in place. */
export async function unlinkContactIdentityAction(
  identityId: string,
): Promise<ContactActionResult> {
  const user = await requireUser();

  const result = unlinkIdentity(db, user.workspaceId, identityId);
  if (!result.ok) return result;

  publishWorkspaceEvent(user.workspaceId, {
    kind: "contact",
    text: "Contact identity unlinked",
  });

  refresh();
  return { ok: true };
}

/** Merges the active contact into another, joining both histories. */
export async function mergeContactsAction(
  sourceContactId: string,
  targetContactId: string,
): Promise<ContactActionResult> {
  const user = await requireUser();

  const source = contactInWorkspace(sourceContactId, user.workspaceId);
  const target = contactInWorkspace(targetContactId, user.workspaceId);

  if (!source || !target) {
    return {
      ok: false,
      error: "Those contacts are not both in your workspace.",
    };
  }

  const result = mergeContacts(
    db,
    user.workspaceId,
    sourceContactId,
    targetContactId,
  );
  if (!result.ok) return result;

  publishWorkspaceEvent(user.workspaceId, {
    kind: "contact",
    text: `${String(source.name)} merged into ${String(target.name)}`,
  });

  refresh();
  return { ok: true };
}
