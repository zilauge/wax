import "server-only";

import {
  discordConnectionForWorkspace,
  fetchDiscordDmActivity,
  listDiscordConnections,
  setDiscordCursor,
  type DiscordCredentials,
} from "@/app/lib/channels/discord";
import {
  fetchYouTubeComments,
  listYouTubeConnections,
  setYouTubeCursor,
  youtubeConnectionForWorkspace,
  type YouTubeCredentials,
} from "@/app/lib/channels/youtube";
import {
  fetchXDirectMessages,
  listXConnections,
  setXInboundState,
  setXCursor,
  xConnectionForWorkspace,
  type XCredentials,
} from "@/app/lib/channels/x";
import { latestConversationFor, recordInboundMessage } from "@/app/lib/channels/inbound";
import { advanceCursor } from "@/app/lib/channels/sync-cursor";
import { db } from "@/app/lib/db/db";
import { publishWorkspaceEvent } from "@/app/lib/workspace/realtime";

/**
 * Inbound polling for the channels that cannot push (Discord DMs, YouTube
 * comments).
 *
 * Runs three ways, all through this module so the behaviour cannot drift:
 * a server-side timer started at boot, the secret-gated `/api/sync/inbound`
 * endpoint for external schedulers, and the "Sync now" action in settings.
 *
 * Cursor safety: a connection's cursor only advances when its whole fetch
 * succeeded and every message in it reached the recorder. Anything else keeps
 * the cursor, and the next run re-fetches the same window — the unique
 * `messages.external_id` turns the repeats into duplicates instead of new
 * rows, so no message is ever skipped.
 */
/**
 * `errors` are faults worth retrying; `notices` are provider limitations the
 * UI states plainly (X without DM read) and that must not read as breakage.
 */
export type SyncReport = {
  accepted: number;
  errors: string[];
  notices: string[];
};

function emptyReport(): SyncReport {
  return { accepted: 0, errors: [], notices: [] };
}

async function syncDiscordConnection(
  connection: DiscordCredentials,
): Promise<SyncReport> {
  const report = emptyReport();
  const activity = await fetchDiscordDmActivity(connection);

  if ("error" in activity) {
    report.errors.push(activity.error);
    return report;
  }

  let complete = activity.complete;

  for (const message of activity.messages) {
    try {
      const outcome = recordInboundMessage(db, {
        workspaceId: connection.workspaceId,
        channel: "discord",
        rawAddress: message.authorId,
        senderName: message.authorName,
        text: message.text,
        receivedAt: Number.isFinite(message.receivedAt)
          ? message.receivedAt
          : Date.now(),
        externalId: message.id,
        company: "Discord user",
        color: "#5865f2",
      });

      if (outcome !== "accepted") continue;
      report.accepted += 1;

      const conversationId = latestConversationFor(
        db,
        connection.workspaceId,
        "discord",
        message.authorId,
      );

      publishWorkspaceEvent(connection.workspaceId, {
        kind: "message",
        ...(conversationId ? { conversationId } : {}),
        text: `New Discord message from ${message.authorName}`,
      });
    } catch (error) {
      // Stop at the first failed write: holding the cursor replays the whole
      // window next time, and the rows that did land are de-duplicated.
      complete = false;
      report.errors.push(
        error instanceof Error
          ? `Discord: ${error.message}`
          : "Discord: a message could not be stored.",
      );
      break;
    }
  }

  let newest: string | null = null;
  for (const message of activity.messages) {
    newest = advanceCursor(newest, message.id, true);
  }

  const next = advanceCursor(connection.cursor, newest, complete);
  if (next && next !== connection.cursor) {
    try {
      setDiscordCursor(connection.workspaceId, next);
    } catch {
      report.errors.push(
        "Discord: the sync cursor could not be saved. Messages stay queued and will be de-duplicated on the next run.",
      );
    }
  }

  return report;
}

async function syncYouTubeConnection(
  connection: YouTubeCredentials,
): Promise<SyncReport> {
  const report = emptyReport();
  const activity = await fetchYouTubeComments(connection);

  if ("error" in activity) {
    report.errors.push(activity.error);
    return report;
  }

  const fresh = connection.cursor
    ? activity.comments.filter((comment) => comment.publishedAt > connection.cursor!)
    : activity.comments;

  let complete = activity.complete;

  for (const comment of fresh) {
    try {
      const outcome = recordInboundMessage(db, {
        workspaceId: connection.workspaceId,
        channel: "youtube",
        rawAddress: comment.authorChannelId,
        senderName: comment.authorName,
        text: comment.text,
        receivedAt: Date.parse(comment.publishedAt) || Date.now(),
        // The top-level comment id is what a reply must attach to.
        externalId: comment.commentId,
        company: "YouTube commenter",
        color: "#ff0033",
      });

      if (outcome !== "accepted") continue;
      report.accepted += 1;

      const conversationId = latestConversationFor(
        db,
        connection.workspaceId,
        "youtube",
        comment.authorChannelId,
      );

      publishWorkspaceEvent(connection.workspaceId, {
        kind: "message",
        ...(conversationId ? { conversationId } : {}),
        text: `New YouTube comment from ${comment.authorName}`,
      });
    } catch (error) {
      complete = false;
      report.errors.push(
        error instanceof Error
          ? `YouTube: ${error.message}`
          : "YouTube: a comment could not be stored.",
      );
      break;
    }
  }

  let newest: string | null = null;
  for (const comment of activity.comments) {
    newest = advanceCursor(newest, comment.publishedAt, true);
  }

  const next = advanceCursor(connection.cursor, newest, complete);
  if (next && next !== connection.cursor) {
    try {
      setYouTubeCursor(connection.workspaceId, next);
    } catch {
      report.errors.push(
        "YouTube: the sync cursor could not be saved. Comments stay queued and will be de-duplicated on the next run.",
      );
    }
  }

  return report;
}

async function syncXConnection(connection: XCredentials): Promise<SyncReport> {
  const report = emptyReport();
  const activity = await fetchXDirectMessages(connection);

  if ("error" in activity) {
    if (activity.capability === "unavailable") {
      report.notices.push(activity.error);
      if (connection.inboundState !== "unavailable") {
        setXInboundState(connection.workspaceId, "unavailable", activity.error);
      }
    } else {
      report.errors.push(activity.error);
    }
    return report;
  }

  if (connection.inboundState !== "ready") {
    setXInboundState(connection.workspaceId, "ready", null);
  }

  const fresh = connection.cursor
    ? activity.messages.filter((message) => BigInt(message.id) > BigInt(connection.cursor!))
    : activity.messages;

  let complete = activity.complete;

  for (const message of fresh) {
    try {
      const outcome = recordInboundMessage(db, {
        workspaceId: connection.workspaceId,
        channel: "x",
        rawAddress: message.senderId,
        senderName: message.senderName,
        text: message.text,
        receivedAt: Number.isFinite(message.receivedAt)
          ? message.receivedAt
          : Date.now(),
        externalId: message.id,
        company: "X user",
        color: "#e7e9ea",
      });

      if (outcome !== "accepted") continue;
      report.accepted += 1;

      const conversationId = latestConversationFor(
        db,
        connection.workspaceId,
        "x",
        message.senderId,
      );

      publishWorkspaceEvent(connection.workspaceId, {
        kind: "message",
        ...(conversationId ? { conversationId } : {}),
        text: `New X message from ${message.senderName}`,
      });
    } catch (error) {
      complete = false;
      report.errors.push(
        error instanceof Error
          ? `X: ${error.message}`
          : "X: a message could not be stored.",
      );
      break;
    }
  }

  let newest: string | null = null;
  for (const message of activity.messages) {
    newest = advanceCursor(newest, message.id, true);
  }

  const next = advanceCursor(connection.cursor, newest, complete);
  if (next && next !== connection.cursor) {
    try {
      setXCursor(connection.workspaceId, next);
    } catch {
      report.errors.push(
        "X: the sync cursor could not be saved. Messages stay queued and will be de-duplicated on the next run.",
      );
    }
  }

  return report;
}

/** Polls one workspace's connected Discord, X and YouTube accounts. */
export async function syncWorkspaceChannels(workspaceId: string): Promise<{
  discord: SyncReport;
  youtube: SyncReport;
  x: SyncReport;
}> {
  const discord = emptyReport();
  const youtube = emptyReport();
  const x = emptyReport();

  const discordConnection = discordConnectionForWorkspace(workspaceId);
  if (discordConnection) {
    Object.assign(discord, await syncDiscordConnection(discordConnection));
  }

  const youtubeConnection = youtubeConnectionForWorkspace(workspaceId);
  if (youtubeConnection) {
    Object.assign(youtube, await syncYouTubeConnection(youtubeConnection));
  }

  const xConnection = xConnectionForWorkspace(workspaceId);
  if (xConnection) {
    Object.assign(x, await syncXConnection(xConnection));
  }

  return { discord, youtube, x };
}

/** Polls every connected account, for the timer and the external endpoint. */
export async function syncAllChannels(): Promise<{
  discord: SyncReport;
  youtube: SyncReport;
  x: SyncReport;
}> {
  const discord = emptyReport();
  const youtube = emptyReport();
  const x = emptyReport();

  for (const connection of listDiscordConnections()) {
    const result = await syncDiscordConnection(connection);
    discord.accepted += result.accepted;
    discord.errors.push(...result.errors);
  }

  for (const connection of listYouTubeConnections()) {
    const result = await syncYouTubeConnection(connection);
    youtube.accepted += result.accepted;
    youtube.errors.push(...result.errors);
  }

  for (const connection of listXConnections()) {
    const result = await syncXConnection(connection);
    x.accepted += result.accepted;
    x.errors.push(...result.errors);
    x.notices.push(...result.notices);
  }

  return { discord, youtube, x };
}

const globalForSync = globalThis as unknown as {
  waxChannelSyncTimer?: NodeJS.Timeout;
  waxChannelSyncRunning?: boolean;
};

/**
 * Starts the in-process poller. Next calls `register()` once per server
 * instance, so this is safe to rely on for a self-hosted deployment; the timer
 * is unref'd so it never keeps a finished process alive.
 */
export function startChannelPolling() {
  if (process.env.WAX_SYNC_DISABLED === "1") return;
  if (globalForSync.waxChannelSyncTimer) return;

  const configured = Number(process.env.WAX_SYNC_INTERVAL_MINUTES ?? 5);
  const minutes = Number.isFinite(configured) && configured >= 1 ? configured : 5;

  const tick = async () => {
    // Overlapping runs would race each other's cursors for no benefit.
    if (globalForSync.waxChannelSyncRunning) return;
    globalForSync.waxChannelSyncRunning = true;
    try {
      const report = await syncAllChannels();
      const errors = [
        ...report.discord.errors,
        ...report.youtube.errors,
        ...report.x.errors,
      ];
      if (errors.length > 0) {
        console.warn(
          `[wax] channel sync reported ${errors.length} error(s):`,
          errors.join(" | "),
        );
      }
    } catch (error) {
      console.error("[wax] channel sync failed:", error);
    } finally {
      globalForSync.waxChannelSyncRunning = false;
    }
  };

  const timer = setInterval(() => void tick(), minutes * 60_000);
  timer.unref?.();
  globalForSync.waxChannelSyncTimer = timer;

  // Pull once shortly after boot so a restart does not delay new messages.
  const first = setTimeout(() => void tick(), 5_000);
  first.unref?.();

  console.info(
    `[wax] channel sync polling every ${minutes} minute(s); set WAX_SYNC_DISABLED=1 to turn it off.`,
  );
}
