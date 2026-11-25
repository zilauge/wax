import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "../app/lib/db/schema.ts";
import { assignNewConversation } from "../app/lib/routing/assign.ts";

/**
 * Schema-level integration: the real DDL, the real SQLite build, and the
 * triggers that keep search in step. No mocks, because the risks here are all
 * SQL — a missing column or an index that silently stops updating.
 */

function openDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(SCHEMA);
  return database;
}

function seedMessage(database: DatabaseSync, id: string, body: string) {
  database
    .prepare(
      `INSERT INTO workspaces (id, name, created_at) VALUES ('w1', 'Wax', 1)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO contacts (id, workspace_id, name, handle, company, color)
       VALUES ('c1', 'w1', 'Ada', '@ada', 'Acme', '#fff')
       ON CONFLICT(id) DO NOTHING`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO conversations
         (id, workspace_id, channel_id, contact_id, topic, status, unread, last_at)
       VALUES ('cv1', 'w1', 'telegram', 'c1', 'Refund', 'open', 0, 1)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO messages (id, conversation_id, author, body, created_at, status)
       VALUES (?, 'cv1', 'contact', ?, 1, 'sent')`,
    )
    .run(id, body);
}

test("schema builds every table the desk relies on", () => {
  const database = openDatabase();
  const names = new Set(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String(row.name)),
  );

  for (const table of [
    "workspaces",
    "users",
    "memberships",
    "channels",
    "conversations",
    "messages",
    "invites",
    "rate_limits",
    "routing_state",
  ]) {
    assert.ok(names.has(table), `missing table ${table}`);
  }
});

test("full-text search follows inserts, updates and deletes", () => {
  const database = openDatabase();
  seedMessage(database, "m1", "My invoice is wrong");

  const hits = database
    .prepare(
      `SELECT m.id FROM messages_fts f JOIN messages m ON m.rowid = f.rowid
       WHERE messages_fts MATCH '"inv"*'`,
    )
    .all()
    .map((row) => String(row.id));
  assert.deepEqual(hits, ["m1"], "prefix search should find 'invoice'");

  database.prepare("UPDATE messages SET body = 'Never mind' WHERE id = 'm1'").run();
  const afterUpdate = database
    .prepare("SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH 'invoice'")
    .get();
  assert.equal(Number(afterUpdate?.n), 0, "an edited body must leave the index");

  database.prepare("DELETE FROM messages WHERE id = 'm1'").run();
  const afterDelete = database
    .prepare(
      "SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH 'never'",
    )
    .get();
  assert.equal(Number(afterDelete?.n), 0, "a deleted body must leave the index");
});

test("an invite token can only be stored once", () => {
  const database = openDatabase();
  database
    .prepare("INSERT INTO workspaces (id, name, created_at) VALUES ('w1', 'Wax', 1)")
    .run();
  database
    .prepare(
      `INSERT INTO users (id, name, email, password_hash, password_salt, created_at)
       VALUES ('u1', 'Owner', 'owner@wax.com', 'x', 's', 1)`,
    )
    .run();

  const insert = database.prepare(
    `INSERT INTO invites
       (id, workspace_id, email, role, token_hash, created_by, created_at, expires_at)
     VALUES (?, 'w1', ?, 'agent', 'hash-1', 'u1', 1, 100)`,
  );

  insert.run("i1", "ada@acme.com");
  assert.throws(() => insert.run("i2", "bob@acme.com"), /UNIQUE/);
});

test("round-robin routing rotates between available agents", () => {
  const database = openDatabase();
  database
    .prepare("INSERT INTO workspaces (id, name, created_at) VALUES ('w1', 'Wax', 1)")
    .run();
  for (const id of ["u1", "u2"]) {
    database
      .prepare(
        `INSERT INTO users (id, name, email, password_hash, password_salt, created_at)
         VALUES (?, ?, ?, 'x', 's', 1)`,
      )
      .run(id, id, `${id}@wax.com`);
    database
      .prepare(
        "INSERT INTO memberships (workspace_id, user_id, role) VALUES ('w1', ?, 'agent')",
      )
      .run(id);
    database
      .prepare(
        `INSERT INTO agent_presence (workspace_id, user_id, status, updated_at)
         VALUES ('w1', ?, 'available', 1)`,
      )
      .run(id);
  }

  database
    .prepare(
      `INSERT INTO contacts (id, workspace_id, name, handle, company, color)
       VALUES ('c1', 'w1', 'Ada', '@ada', 'Acme', '#fff')`,
    )
    .run();

  const addConversation = database.prepare(
    `INSERT INTO conversations
       (id, workspace_id, channel_id, contact_id, topic, status, unread, last_at)
     VALUES (?, 'w1', 'telegram', 'c1', 'Refund', 'open', 0, 1)`,
  );
  addConversation.run("cv1");
  addConversation.run("cv2");

  const first = assignNewConversation(database, "w1", "cv1");
  const second = assignNewConversation(database, "w1", "cv2");

  assert.ok(first && second);
  assert.notEqual(first, second, "two arrivals must not land on one agent");

  const assigned = database
    .prepare("SELECT id, assignee_user_id FROM conversations ORDER BY id")
    .all()
    .map((row) => String(row.assignee_user_id));
  assert.deepEqual(assigned, [first, second]);
});
