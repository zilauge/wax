import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { normalizeIdentity } from "@/app/lib/contacts/identity";

/**
 * Upgrades databases created before assignment, queues and SLA tracking existed.
 *
 * The old conversations table carried a free-text `assignee` that was NOT NULL,
 * which now blocks every insert that names a real user instead. SQLite cannot
 * drop a constraint with ALTER, so the table is rebuilt once, copying every row
 * and discarding the legacy column. Queues and SLA clocks are then backfilled.
 */
function columnsOf(database: DatabaseSync, table: string) {
  return new Set(
    database
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((column) => String(column.name)),
  );
}

function rebuildConversations(database: DatabaseSync) {
  database.exec("PRAGMA foreign_keys = OFF");
  database.exec("BEGIN");
  try {
    database.exec(`
      CREATE TABLE conversations_rebuilt (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        channel_id TEXT NOT NULL,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        topic TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open', 'pending', 'resolved')),
        assignee_user_id TEXT REFERENCES users(id),
        queue_id TEXT REFERENCES queues(id),
        first_response_at INTEGER,
        sla_due_at INTEGER,
        unread INTEGER NOT NULL DEFAULT 0,
        last_at INTEGER NOT NULL
      );

      INSERT INTO conversations_rebuilt
        (id, workspace_id, channel_id, contact_id, topic, status,
         assignee_user_id, queue_id, first_response_at, sla_due_at, unread, last_at)
      SELECT id, workspace_id, channel_id, contact_id, topic, status,
             NULL, NULL, NULL, NULL, unread, last_at
      FROM conversations;

      DROP TABLE conversations;
      ALTER TABLE conversations_rebuilt RENAME TO conversations;
    `);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

/**
 * Calls used to carry a free-text agent label ("Queue · Sales", "You"). The
 * table is rebuilt with real queue and assignee references, then the old labels
 * are mapped onto the queues that exist for each workspace.
 */
function rebuildCalls(database: DatabaseSync) {
  if (!columnsOf(database, "calls").has("agent")) return;

  const legacy = database
    .prepare("SELECT id, workspace_id, agent FROM calls")
    .all()
    .map((row) => ({
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      label: String(row.agent),
    }));

  database.exec("PRAGMA foreign_keys = OFF");
  database.exec("BEGIN");
  try {
    database.exec(`
      CREATE TABLE calls_rebuilt (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        caller TEXT NOT NULL,
        company TEXT NOT NULL,
        hold TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        state TEXT NOT NULL,
        queue_id TEXT REFERENCES queues(id),
        assignee_user_id TEXT REFERENCES users(id),
        position INTEGER NOT NULL DEFAULT 0
      );

      INSERT INTO calls_rebuilt
        (id, workspace_id, caller, company, hold, channel_id, direction, state,
         queue_id, assignee_user_id, position)
      SELECT id, workspace_id, caller, company, hold, channel_id, direction, state,
             NULL, NULL, position
      FROM calls;

      DROP TABLE calls;
      ALTER TABLE calls_rebuilt RENAME TO calls;
    `);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }

  for (const row of legacy) {
    const queueName = row.label.startsWith("Queue · ")
      ? row.label.slice("Queue · ".length).trim()
      : null;

    const namedQueue = queueName
      ? database
          .prepare(
            "SELECT id FROM queues WHERE workspace_id = ? AND name = ?",
          )
          .get(row.workspaceId, queueName)
      : null;

    const fallbackQueue = database
      .prepare(
        "SELECT id FROM queues WHERE workspace_id = ? ORDER BY position LIMIT 1",
      )
      .get(row.workspaceId);

    const owner =
      row.label === "You"
        ? database
            .prepare(
              "SELECT user_id FROM memberships WHERE workspace_id = ? AND role = 'owner' ORDER BY rowid LIMIT 1",
            )
            .get(row.workspaceId)
        : null;

    database
      .prepare("UPDATE calls SET queue_id = ?, assignee_user_id = ? WHERE id = ?")
      .run(
        namedQueue?.id ? String(namedQueue.id) : fallbackQueue?.id ? String(fallbackQueue.id) : null,
        owner?.user_id ? String(owner.user_id) : null,
        row.id,
      );
  }
}

/**
 * Gives every existing contact the identities its threads already imply, so the
 * cross-channel lookup works on databases created before identities existed.
 * Addresses are normalised with the same helper the live paths use, and the
 * unique index keeps this idempotent across restarts.
 */
function backfillIdentities(database: DatabaseSync) {
  const rows = database
    .prepare(
      `SELECT DISTINCT c.workspace_id, c.contact_id, c.channel_id, ct.handle
       FROM conversations c
       JOIN contacts ct ON ct.id = c.contact_id`,
    )
    .all() as {
    workspace_id: string;
    contact_id: string;
    channel_id: string;
    handle: string;
  }[];

  // A Telegram contact created by the webhook has a chat id but may have no
  // conversation yet; its chat id is still an identity worth keeping.
  const telegramContacts = database
    .prepare(
      `SELECT id, workspace_id, telegram_chat_id FROM contacts
       WHERE telegram_chat_id IS NOT NULL`,
    )
    .all() as {
    id: string;
    workspace_id: string;
    telegram_chat_id: string;
  }[];

  const insert = database.prepare(
    `INSERT OR IGNORE INTO contact_identities
       (id, workspace_id, contact_id, channel_id, address, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const now = Date.now();

  for (const row of rows) {
    const normalized = normalizeIdentity(String(row.handle ?? ""));
    if (!normalized) continue;
    insert.run(
      randomUUID(),
      String(row.workspace_id),
      String(row.contact_id),
      String(row.channel_id),
      normalized.address,
      now,
    );
  }

  for (const row of telegramContacts) {
    const normalized = normalizeIdentity(String(row.telegram_chat_id));
    if (!normalized) continue;
    insert.run(
      randomUUID(),
      String(row.workspace_id),
      String(row.id),
      "telegram",
      normalized.address,
      now,
    );
  }
}


function providerFor(channelId: string, externalId: string) {
  if (externalId === "wati") return "wati";
  if (channelId === "whatsapp" || channelId === "instagram") return "meta";
  return channelId;
}

/** Adds the provider column and its uniqueness guarantee to old connections. */
function rebuildChannelConnections(database: DatabaseSync) {
  if (columnsOf(database, "channel_connections").has("provider")) return;

  database.exec("PRAGMA foreign_keys = OFF");
  database.exec("BEGIN");
  try {
    database.exec(`
      CREATE TABLE channel_connections_rebuilt (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        channel_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        external_id TEXT NOT NULL,
        account_name TEXT,
        access_token TEXT NOT NULL,
        last_error TEXT,
        connected_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, channel_id),
        UNIQUE (provider, external_id)
      );
    `);

    for (const row of database
      .prepare(
        "SELECT workspace_id, channel_id, external_id, account_name, access_token, connected_at FROM channel_connections",
      )
      .all()) {
      database
        .prepare(
          `INSERT INTO channel_connections_rebuilt
             (workspace_id, channel_id, provider, external_id, account_name, access_token, last_error, connected_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
        )
        .run(
          String(row.workspace_id),
          String(row.channel_id),
          providerFor(String(row.channel_id), String(row.external_id)),
          String(row.external_id),
          row.account_name ? String(row.account_name) : null,
          String(row.access_token),
          Number(row.connected_at),
        );
    }

    database.exec("DROP TABLE channel_connections");
    database.exec(
      "ALTER TABLE channel_connections_rebuilt RENAME TO channel_connections",
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

/** Delivery receipts and idempotency keys arrived after the first send path. */
function rebuildMessages(database: DatabaseSync) {
  const columns = columnsOf(database, "messages");
  const definition = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages'")
    .get();
  const supportsReceipts = String(definition?.sql ?? "").includes("'delivered'");

  if (supportsReceipts) {
    if (!columns.has("client_nonce")) {
      database.exec("ALTER TABLE messages ADD COLUMN client_nonce TEXT");
    }
    return;
  }

  database.exec("PRAGMA foreign_keys = OFF");
  database.exec("BEGIN");
  try {
    database.exec(`
      CREATE TABLE messages_rebuilt (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        author TEXT NOT NULL CHECK (author IN ('agent', 'contact')),
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'sent'
          CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
        error TEXT,
        external_id TEXT UNIQUE,
        client_nonce TEXT UNIQUE
      );

      INSERT INTO messages_rebuilt
        (id, conversation_id, author, body, created_at, status, error, external_id, client_nonce)
      SELECT id, conversation_id, author, body, created_at, status, error, external_id, NULL
      FROM messages;

      DROP TABLE messages;
      ALTER TABLE messages_rebuilt RENAME TO messages;
      CREATE INDEX IF NOT EXISTS messages_conversation_idx
        ON messages (conversation_id, created_at);
    `);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

/** Channels added after the first workspaces existed. */
const CATALOGUE_ADDITIONS: [string, string, string][] = [
  ["sms", "SMS", "#f22f46"],
  ["discord", "Discord", "#5865f2"],
];

function backfillChannels(database: DatabaseSync) {
  const insert = database.prepare(
    `INSERT OR IGNORE INTO channels
       (workspace_id, id, name, handle, color, connected)
     VALUES (?, ?, ?, '', ?, 0)`,
  );

  for (const workspace of database.prepare("SELECT id FROM workspaces").all()) {
    for (const [id, name, color] of CATALOGUE_ADDITIONS) {
      insert.run(String(workspace.id), id, name, color);
    }
  }
}

/**
 * Time zones arrived after the calendar did. Existing rows are backfilled with
 * the server's zone, which is exactly how their blocks and hours were being
 * read before, so nothing shifts on the upgrade.
 */
function addUserTimezoneColumn(database: DatabaseSync) {
  if (columnsOf(database, "users").has("timezone")) return;

  database.exec("ALTER TABLE users ADD COLUMN timezone TEXT");

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  database.prepare("UPDATE users SET timezone = ? WHERE timezone IS NULL").run(zone);
}

/** Clerk became the identity provider, so a local user row links to it. */
function addUserClerkColumn(database: DatabaseSync) {
  if (columnsOf(database, "users").has("clerk_user_id")) return;
  database.exec("ALTER TABLE users ADD COLUMN clerk_user_id TEXT");
}

/** Internal notes and delivery retries arrived after the first messages table. */
function addMessageColumns(database: DatabaseSync) {
  const columns = columnsOf(database, "messages");
  if (!columns.has("internal")) {
    database.exec(
      "ALTER TABLE messages ADD COLUMN internal INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!columns.has("retry_count")) {
    database.exec(
      "ALTER TABLE messages ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!columns.has("last_attempt_at")) {
    database.exec("ALTER TABLE messages ADD COLUMN last_attempt_at INTEGER");
  }
}

/**
 * Backfills the full-text index once for databases whose messages predate it.
 * `rebuild` is the documented way to repopulate an external-content FTS table.
 */
function backfillSearchIndex(database: DatabaseSync) {
  const indexed = database
    .prepare("SELECT COUNT(*) AS n FROM messages_fts")
    .get();
  const stored = database.prepare("SELECT COUNT(*) AS n FROM messages").get();

  if (Number(indexed?.n ?? 0) !== Number(stored?.n ?? 0)) {
    database.exec("INSERT INTO messages_fts (messages_fts) VALUES ('rebuild')");
  }
}

/** Channel tiles draw provider logos, so the stored monogram is dead weight. */
function dropChannelMonogram(database: DatabaseSync) {
  if (columnsOf(database, "channels").has("monogram")) {
    database.exec("ALTER TABLE channels DROP COLUMN monogram");
  }
}

/** The polling sync keeps a per-connection cursor; older rows have none. */
function addConnectionCursor(database: DatabaseSync) {
  if (!columnsOf(database, "channel_connections").has("cursor")) {
    database.exec("ALTER TABLE channel_connections ADD COLUMN cursor TEXT");
  }
}

/** Inbound capability is recorded after the first sync attempt. */
function addConnectionInboundState(database: DatabaseSync) {
  const columns = columnsOf(database, "channel_connections");
  if (!columns.has("inbound_state")) {
    database.exec("ALTER TABLE channel_connections ADD COLUMN inbound_state TEXT");
  }
  if (!columns.has("inbound_note")) {
    database.exec("ALTER TABLE channel_connections ADD COLUMN inbound_note TEXT");
  }
}

export function migrate(database: DatabaseSync) {
  dropChannelMonogram(database);
  backfillChannels(database);

  // Channel connections and messages both gained columns after launch. The
  // cursor is added after the rebuild, which drops unknown columns.
  rebuildChannelConnections(database);
  addConnectionCursor(database);
  addConnectionInboundState(database);
  rebuildMessages(database);
  addUserClerkColumn(database);
  addUserTimezoneColumn(database);
  addMessageColumns(database);
  backfillSearchIndex(database);

  // Mobile numbers and their verification landed after the first release.
  const userColumns = columnsOf(database, "users");
  if (!userColumns.has("phone")) {
    database.exec("ALTER TABLE users ADD COLUMN phone TEXT");
  }
  if (!userColumns.has("phone_verified_at")) {
    database.exec("ALTER TABLE users ADD COLUMN phone_verified_at INTEGER");
  }

  const conversationColumns = columnsOf(database, "conversations");

  if (conversationColumns.has("assignee")) {
    rebuildConversations(database);
  } else {
    const additions: [string, string][] = [
      ["assignee_user_id", "TEXT REFERENCES users(id)"],
      ["queue_id", "TEXT REFERENCES queues(id)"],
      ["first_response_at", "INTEGER"],
      ["sla_due_at", "INTEGER"],
    ];

    for (const [name, type] of additions) {
      if (!conversationColumns.has(name)) {
        database.exec(`ALTER TABLE conversations ADD COLUMN ${name} ${type}`);
      }
    }
  }

  const workspaces = database
    .prepare("SELECT id FROM workspaces")
    .all()
    .map((row) => String(row.id));

  const insertQueue = database.prepare(
    "INSERT INTO queues (id, workspace_id, name, sla_minutes, color, position) VALUES (?, ?, ?, ?, ?, ?)",
  );

  for (const workspaceId of workspaces) {
    let queues = database
      .prepare(
        "SELECT id, sla_minutes FROM queues WHERE workspace_id = ? ORDER BY position",
      )
      .all(workspaceId) as { id: string; sla_minutes: number }[];

    if (queues.length === 0) {
      insertQueue.run(randomUUID(), workspaceId, "Support", 15, "#22c55e", 0);
      insertQueue.run(randomUUID(), workspaceId, "Sales", 60, "#6366f1", 1);
      queues = database
        .prepare(
          "SELECT id, sla_minutes FROM queues WHERE workspace_id = ? ORDER BY position",
        )
        .all(workspaceId) as { id: string; sla_minutes: number }[];
    }

    const [firstQueue] = queues;

    database
      .prepare(
        "UPDATE conversations SET queue_id = ? WHERE workspace_id = ? AND queue_id IS NULL",
      )
      .run(firstQueue.id, workspaceId);

    database
      .prepare(
        `UPDATE conversations
         SET sla_due_at = last_at + ? * 60000
         WHERE workspace_id = ?
           AND status <> 'resolved'
           AND first_response_at IS NULL
           AND sla_due_at IS NULL`,
      )
      .run(firstQueue.sla_minutes, workspaceId);

    database
      .prepare(
        `UPDATE conversations
         SET first_response_at = last_at
         WHERE workspace_id = ? AND status = 'resolved' AND first_response_at IS NULL`,
      )
      .run(workspaceId);
  }

  rebuildCalls(database);
  backfillIdentities(database);
}
