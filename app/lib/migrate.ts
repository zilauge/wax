import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

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

export function migrate(database: DatabaseSync) {
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
}
