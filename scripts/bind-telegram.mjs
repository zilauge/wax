#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "../app/lib/schema.ts";

/**
 * Binds one Telegram bot to one workspace.
 *
 *   npm run telegram:bind                    # TELEGRAM_WORKSPACE_ID from .env.local
 *   npm run telegram:bind -- <workspaceId>   # explicit workspace
 *
 * The secret comes from TELEGRAM_WEBHOOK_SECRET (the same value passed to
 * setWebhook as secret_token); only its SHA-256 hash is stored. Re-running the
 * command rotates the secret for that workspace; a secret already bound to a
 * different workspace is refused.
 */
const DB_PATH =
  process.env.WAX_DB_PATH ?? join(process.cwd(), ".data", "wax.db");
const workspaceId = process.argv[2] ?? process.env.TELEGRAM_WORKSPACE_ID;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
let botUsername = process.env.TELEGRAM_BOT_USERNAME ?? null;

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!workspaceId) {
  fail(
    "No workspace given. Pass one (npm run telegram:bind -- <workspaceId>) or set TELEGRAM_WORKSPACE_ID.",
  );
}
if (!secret || secret.length < 16) {
  fail(
    "TELEGRAM_WEBHOOK_SECRET is missing or too short (use at least 16 characters).",
  );
}

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(SCHEMA);

const workspace = db
  .prepare("SELECT id, name FROM workspaces WHERE id = ?")
  .get(workspaceId);

if (!workspace) {
  const known = db
    .prepare("SELECT id, name FROM workspaces ORDER BY created_at")
    .all()
    .map((row) => `  ${row.id}  ${row.name}`)
    .join("\n");
  fail(`No workspace with id ${workspaceId}. Known workspaces:\n${known}`);
}

// Record which bot this is so the settings screen can show it without asking
// anyone to read env files. getMe is read-only and needs the bot token.
if (!botUsername && process.env.TELEGRAM_BOT_TOKEN) {
  try {
    const me = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`,
    ).then((response) => response.json());
    if (me?.ok && me.result?.username) botUsername = me.result.username;
  } catch {
    console.warn(
      "! Could not reach Telegram to look up the bot username; binding without it.",
    );
  }
}

const secretHash = createHash("sha256").update(secret, "utf8").digest("hex");
const conflict = db
  .prepare(
    "SELECT workspace_id FROM telegram_bindings WHERE secret_hash = ? AND workspace_id <> ?",
  )
  .get(secretHash, workspaceId);

if (conflict) {
  fail(
    `That webhook secret is already bound to workspace ${conflict.workspace_id}. Use a different secret per bot.`,
  );
}

db.prepare(
  `INSERT INTO telegram_bindings (workspace_id, secret_hash, bot_username, created_at)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(workspace_id) DO UPDATE SET
     secret_hash = excluded.secret_hash,
     bot_username = excluded.bot_username,
     created_at = excluded.created_at`,
).run(workspaceId, secretHash, botUsername, Date.now());

console.log(
  `✓ Telegram webhook bound to "${workspace.name}" (${workspaceId})${botUsername ? ` for @${botUsername}` : ""}.`,
);
