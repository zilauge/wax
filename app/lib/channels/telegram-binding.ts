import "server-only";

import { createHash } from "node:crypto";
import { db } from "../db";

/**
 * Telegram delivers every update for a bot to a single webhook URL, so the bot
 * itself — not the oldest workspace — has to say which tenant it belongs to.
 * Each binding pins one hashed webhook secret to exactly one workspace; there is
 * deliberately no fallback, because a guess would put one company's customer
 * messages inside another company's inbox.
 */
export type TelegramBinding = {
  workspaceId: string;
  workspaceName: string;
  botUsername: string | null;
};

export function hashWebhookSecret(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function resolveTelegramBinding(secret: string): TelegramBinding | null {
  const row = db
    .prepare(
      `SELECT b.workspace_id, b.bot_username, w.name AS workspace_name
       FROM telegram_bindings b
       JOIN workspaces w ON w.id = b.workspace_id
       WHERE b.secret_hash = ?`,
    )
    .get(hashWebhookSecret(secret));

  if (!row) return null;

  return {
    workspaceId: String(row.workspace_id),
    workspaceName: String(row.workspace_name),
    botUsername: row.bot_username ? String(row.bot_username) : null,
  };
}

/** The binding for one workspace, for the settings screen. */
export function resolveTelegramBindingForWorkspace(workspaceId: string): {
  botUsername: string | null;
  boundAt: number;
} | null {
  const row = db
    .prepare(
      "SELECT bot_username, created_at FROM telegram_bindings WHERE workspace_id = ?",
    )
    .get(workspaceId);

  if (!row) return null;

  return {
    botUsername: row.bot_username ? String(row.bot_username) : null,
    boundAt: Number(row.created_at),
  };
}

export function countTelegramBindings(): number {
  const row = db.prepare("SELECT COUNT(*) AS total FROM telegram_bindings").get();
  return Number(row?.total ?? 0);
}
