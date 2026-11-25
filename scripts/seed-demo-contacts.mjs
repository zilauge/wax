#!/usr/bin/env node
/**
 * Seeds two demo customers into every workspace so the desk can be explored
 * with real records: each contact has a phone number plus social handles, and
 * one thread per channel. Re-running is safe: contacts, identities, threads and
 * messages are keyed by deterministic ids and existing rows are left alone.
 *
 * The rows are ordinary contacts, so anything the desk can do to a real
 * customer (merge, notes, delete, export) works on them too.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DB_PATH =
  process.env.WAX_DB_PATH ?? join(process.cwd(), ".data", "wax.db");
const database = new DatabaseSync(DB_PATH);
database.exec("PRAGMA busy_timeout = 5000");

const minute = 60_000;
const now = Date.now();

const people = [
  {
    key: "amara",
    name: "Amara Okonkwo",
    handle: "@amara_ok",
    company: "Northwind Labs",
    color: "#6366f1",
    identities: [
      ["whatsapp", "+254 712 345 678"],
      ["sms", "+254 712 345 678"],
      ["telegram", "@amara_ok"],
      ["instagram", "@amara.ok"],
    ],
    threads: [
      {
        channel: "whatsapp",
        topic: "Delivery window for the Lagos order",
        status: "open",
        unread: 2,
        messages: [
          ["contact", "Hi! I ordered the two desk lamps on Monday.", 96],
          [
            "agent",
            "Thanks Amara — order NW-2481 is packed and leaves the warehouse today.",
            91,
          ],
          ["contact", "Perfect. Can it arrive before Friday?", 12],
          ["contact", "It's for a client handover, so timing matters.", 9],
        ],
      },
      {
        channel: "instagram",
        topic: "Product care questions",
        status: "pending",
        unread: 0,
        messages: [
          ["contact", "Do the lamps come with a dimmer?", 240],
          ["agent", "Yes — the touch dimmer is built into the base.", 228],
          ["contact", "Lovely, thank you!", 224],
          ["agent", "Any time. I'll check back after the delivery.", 210],
        ],
      },
    ],
  },
  {
    key: "daniel",
    name: "Daniel Mwangi",
    handle: "@danmwangi",
    company: "Sunda Studio",
    color: "#14b8a6",
    identities: [
      ["sms", "+254 798 765 432"],
      ["whatsapp", "+254 798 765 432"],
      ["telegram", "@danmwangi"],
      ["x", "@danmwangi"],
    ],
    threads: [
      {
        channel: "sms",
        topic: "Invoice for the studio fit-out",
        status: "open",
        unread: 1,
        messages: [
          ["contact", "Morning, did the invoice for the fit-out go out?", 52],
          [
            "agent",
            "It did — sent to accounts@sundastudio.co just after 8.",
            47,
          ],
          ["contact", "Got it, paying today. Thanks!", 6],
        ],
      },
      {
        channel: "telegram",
        topic: "Bulk order pricing",
        status: "resolved",
        unread: 0,
        messages: [
          ["contact", "We need 40 units for the new studio.", 1_500],
          [
            "agent",
            "At 40 units the price drops to 1,850 each, delivery included.",
            1_480,
          ],
          ["contact", "Approved. Send the proforma when ready.", 1_440],
          ["agent", "Proforma sent and the thread is closed — reopen any time.", 1_430],
        ],
      },
    ],
  },
];

const short = (workspaceId) => workspaceId.slice(0, 8);
const demoId = (workspaceId, ...parts) =>
  ["demo", short(workspaceId), ...parts].join("-");

const workspaces = database.prepare("SELECT id, name FROM workspaces").all();

if (workspaces.length === 0) {
  console.error(`No workspaces in ${DB_PATH}. Sign in once, then re-run.`);
  process.exit(1);
}

const contactInsert = database.prepare(
  `INSERT OR IGNORE INTO contacts
     (id, workspace_id, name, handle, company, color, is_demo)
   VALUES (?, ?, ?, ?, ?, ?, 1)`,
);
const identityInsert = database.prepare(
  `INSERT OR IGNORE INTO contact_identities
     (id, workspace_id, contact_id, channel_id, address, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
);
const conversationInsert = database.prepare(
  `INSERT OR IGNORE INTO conversations
     (id, workspace_id, channel_id, contact_id, topic, status,
      assignee_user_id, queue_id, first_response_at, sla_due_at, unread, last_at)
   VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
);
const messageInsert = database.prepare(
  `INSERT OR IGNORE INTO messages
     (id, conversation_id, author, body, created_at, status)
   VALUES (?, ?, ?, ?, ?, ?)`,
);

function normalize(address) {
  const value = address.trim();
  if (/^[+]?[\d\s().-]+$/.test(value)) {
    return `+${value.replace(/\D/g, "")}`;
  }
  return `@${value.replace(/^@+/, "").toLowerCase()}`;
}

let contactsCreated = 0;
let threadsCreated = 0;

for (const workspace of workspaces) {
  const workspaceId = String(workspace.id);
  const queue = database
    .prepare(
      "SELECT id, sla_minutes FROM queues WHERE workspace_id = ? ORDER BY position LIMIT 1",
    )
    .get(workspaceId);
  const queueId = queue ? String(queue.id) : null;
  const slaMinutes = queue ? Number(queue.sla_minutes) : 15;

  for (const person of people) {
    const contactId = demoId(workspaceId, person.key);

    const exists = database
      .prepare("SELECT id FROM contacts WHERE id = ?")
      .get(contactId);
    if (!exists) {
      contactInsert.run(
        contactId,
        workspaceId,
        person.name,
        person.handle,
        person.company,
        person.color,
      );
      contactsCreated += 1;
    }

    for (const [channelId, address] of person.identities) {
      identityInsert.run(
        randomUUID(),
        workspaceId,
        contactId,
        channelId,
        normalize(address),
        now,
      );
    }

    for (const thread of person.threads) {
      const conversationId = demoId(workspaceId, person.key, thread.channel);
      const seen = database
        .prepare("SELECT id FROM conversations WHERE id = ?")
        .get(conversationId);
      if (seen) continue;

      const timed = thread.messages.map(([author, body, minutesAgo]) => ({
        author,
        body,
        at: now - minutesAgo * minute,
      }));
      timed.sort((a, b) => a.at - b.at);

      const firstInbound = timed.find((message) => message.author === "contact");
      const firstReply = timed.find(
        (message) =>
          message.author === "agent" &&
          (!firstInbound || message.at >= firstInbound.at),
      );

      conversationInsert.run(
        conversationId,
        workspaceId,
        thread.channel,
        contactId,
        thread.topic,
        thread.status,
        queueId,
        firstReply ? firstReply.at : null,
        firstInbound ? firstInbound.at + slaMinutes * minute : null,
        thread.unread,
        timed.at(-1).at,
      );

      for (const message of timed) {
        messageInsert.run(
          randomUUID(),
          conversationId,
          message.author,
          message.body,
          message.at,
          message.author === "agent" ? "delivered" : "sent",
        );
      }
      threadsCreated += 1;
    }
  }
}

database.exec("INSERT INTO messages_fts (messages_fts) VALUES ('rebuild')");
database.close();

console.log(
  `Seeded ${people.length} demo contacts per workspace across ${workspaces.length} workspace(s).`,
);
console.log(`New contacts: ${contactsCreated} · new threads: ${threadsCreated}.`);
