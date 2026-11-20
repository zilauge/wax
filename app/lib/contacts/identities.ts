import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { normalizeIdentity } from "@/app/lib/contacts/identity";
import type { ChannelId, ContactIdentity } from "@/app/lib/types";

/**
 * Contact identities are the bridge between channels: one contact can hold a
 * WhatsApp number, an Instagram handle and a Telegram handle, and an inbound
 * message resolves to the contact that already owns that address.
 *
 * These helpers take the database as an argument (instead of importing the
 * server singleton) so they can be exercised directly against a copy of the
 * real database.
 */
type Row = Record<string, unknown>;

export type IdentityMatch = {
  identityId: string;
  contactId: string;
};

export type IdentityResult =
  | { ok: true; identity: ContactIdentity }
  | { ok: false; error: string };

export type ContactActionResult = { ok: true } | { ok: false; error: string };

function identityFromRow(row: Row): ContactIdentity {
  return {
    id: String(row.id),
    channel: String(row.channel_id) as ChannelId,
    address: String(row.address),
  };
}

export function listIdentities(
  database: DatabaseSync,
  workspaceId: string,
  contactId: string,
): ContactIdentity[] {
  return database
    .prepare(
      `SELECT id, channel_id, address FROM contact_identities
       WHERE workspace_id = ? AND contact_id = ?
       ORDER BY created_at, rowid`,
    )
    .all(workspaceId, contactId)
    .map(identityFromRow);
}

export function findIdentityInChannel(
  database: DatabaseSync,
  workspaceId: string,
  channelId: string,
  address: string,
): IdentityMatch | null {
  const row = database
    .prepare(
      `SELECT id, contact_id FROM contact_identities
       WHERE workspace_id = ? AND channel_id = ? AND address = ?`,
    )
    .get(workspaceId, channelId, address);

  return row
    ? { identityId: String(row.id), contactId: String(row.contact_id) }
    : null;
}

/**
 * Falls back to the same address on any other channel. Only handles and phone
 * numbers reach this lookup, so a channel-specific id can never attach a
 * customer to an unrelated person.
 */
export function findIdentityAcrossChannels(
  database: DatabaseSync,
  workspaceId: string,
  address: string,
  exceptChannelId: string,
): IdentityMatch | null {
  const row = database
    .prepare(
      `SELECT id, contact_id FROM contact_identities
       WHERE workspace_id = ? AND address = ? AND channel_id <> ?
       ORDER BY created_at LIMIT 1`,
    )
    .get(workspaceId, address, exceptChannelId);

  return row
    ? { identityId: String(row.id), contactId: String(row.contact_id) }
    : null;
}

/**
 * Attaches an address to a contact. The unique index on
 * (workspace_id, channel_id, address) is the guarantee that two contacts can
 * never claim the same identity within a workspace.
 */
export function attachIdentity(
  database: DatabaseSync,
  {
    workspaceId,
    contactId,
    channelId,
    raw,
  }: {
    workspaceId: string;
    contactId: string;
    channelId: ChannelId;
    raw: string;
  },
): IdentityResult {
  const normalized = normalizeIdentity(raw);
  if (!normalized) {
    return { ok: false, error: "Enter a phone number or a handle." };
  }

  const existing = database
    .prepare(
      `SELECT id, channel_id, address, contact_id FROM contact_identities
       WHERE workspace_id = ? AND channel_id = ? AND address = ?`,
    )
    .get(workspaceId, channelId, normalized.address);

  if (existing) {
    if (String(existing.contact_id) === contactId) {
      return { ok: true, identity: identityFromRow(existing) };
    }
    return {
      ok: false,
      error: `${normalized.address} is already linked to another contact.`,
    };
  }

  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO contact_identities
         (id, workspace_id, contact_id, channel_id, address, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, workspaceId, contactId, channelId, normalized.address, Date.now());

  return {
    ok: true,
    identity: { id, channel: channelId, address: normalized.address },
  };
}

/** Removes one address, refusing to leave a contact with no way to be reached. */
export function unlinkIdentity(
  database: DatabaseSync,
  workspaceId: string,
  identityId: string,
): ContactActionResult {
  const identity = database
    .prepare(
      `SELECT contact_id FROM contact_identities
       WHERE id = ? AND workspace_id = ?`,
    )
    .get(identityId, workspaceId) as { contact_id: string } | undefined;

  if (!identity) {
    return { ok: false, error: "That identity is not in your workspace." };
  }

  const count = database
    .prepare(
      `SELECT COUNT(*) AS total FROM contact_identities
       WHERE workspace_id = ? AND contact_id = ?`,
    )
    .get(workspaceId, String(identity.contact_id)) as { total: number };

  if (Number(count.total) <= 1) {
    return {
      ok: false,
      error: "Link another identity before unlinking the last one.",
    };
  }

  database
    .prepare("DELETE FROM contact_identities WHERE id = ? AND workspace_id = ?")
    .run(identityId, workspaceId);

  return { ok: true };
}

/**
 * Merges one contact into another: conversations move, identities move unless
 * the target already owns the same address, and the empty contact is removed.
 */
export function mergeContacts(
  database: DatabaseSync,
  workspaceId: string,
  sourceContactId: string,
  targetContactId: string,
): ContactActionResult {
  if (sourceContactId === targetContactId) {
    return { ok: false, error: "Choose a different contact to merge into." };
  }

  const contacts = database
    .prepare(
      `SELECT id, telegram_chat_id FROM contacts
       WHERE workspace_id = ? AND id IN (?, ?)`,
    )
    .all(workspaceId, sourceContactId, targetContactId) as {
    id: string;
    telegram_chat_id: string | null;
  }[];

  if (contacts.length !== 2) {
    return {
      ok: false,
      error: "Those contacts are not both in your workspace.",
    };
  }

  const source = contacts.find((row) => String(row.id) === sourceContactId);
  const target = contacts.find((row) => String(row.id) === targetContactId);

  if (!source || !target) {
    return { ok: false, error: "Those contacts are not both in your workspace." };
  }

  database.exec("BEGIN");
  try {
    database
      .prepare(
        `UPDATE conversations SET contact_id = ?
         WHERE workspace_id = ? AND contact_id = ?`,
      )
      .run(targetContactId, workspaceId, sourceContactId);

    const leftover = database
      .prepare(
        `SELECT COUNT(*) AS total FROM conversations
         WHERE workspace_id = ? AND contact_id = ?`,
      )
      .get(workspaceId, sourceContactId) as { total: number };

    if (Number(leftover.total) > 0) {
      throw new Error("Some conversations could not be moved to the target.");
    }

    // The unique address index may already hold some of the source identities;
    // UPDATE OR IGNORE leaves those behind and the delete cleans them up.
    const identities = database
      .prepare(
        `SELECT id FROM contact_identities
         WHERE workspace_id = ? AND contact_id = ?`,
      )
      .all(workspaceId, sourceContactId);

    for (const identity of identities) {
      database
        .prepare(
          `UPDATE OR IGNORE contact_identities SET contact_id = ?
           WHERE id = ? AND workspace_id = ?`,
        )
        .run(targetContactId, String(identity.id), workspaceId);
    }

    database
      .prepare(
        `DELETE FROM contact_identities
         WHERE workspace_id = ? AND contact_id = ?`,
      )
      .run(workspaceId, sourceContactId);

    if (source.telegram_chat_id && !target.telegram_chat_id) {
      database
        .prepare("UPDATE contacts SET telegram_chat_id = ? WHERE id = ?")
        .run(String(source.telegram_chat_id), targetContactId);
    }

    database
      .prepare("DELETE FROM contacts WHERE id = ? AND workspace_id = ?")
      .run(sourceContactId, workspaceId);

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Could not merge those contacts: ${error.message}`
          : "Could not merge those contacts.",
    };
  }

  return { ok: true };
}
