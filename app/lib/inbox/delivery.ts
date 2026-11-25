import { deliverTelegramMessage } from "@/app/lib/channels/telegram";
import { deliverDiscordMessage } from "@/app/lib/channels/discord";
import { deliverInstagramMessage } from "@/app/lib/channels/instagram";
import { deliverSmsMessage } from "@/app/lib/channels/twilio";
import { deliverXMessage } from "@/app/lib/channels/x";
import { deliverYouTubeReply } from "@/app/lib/channels/youtube";
import {
  deliverWhatsAppMessage,
  deliverWhatsAppTemplate,
} from "@/app/lib/channels/whatsapp";

export type Delivery =
  | { status: "sent"; externalId?: string | null }
  | { status: "failed"; error?: string };

export type DeliveryTarget = {
  channel: string;
  channelName: string;
  telegramChatId: string | null;
  address: string | null;
  lastInboundExternalId: string | null;
  workspaceId: string;
};

/** Inbound YouTube messages store `youtube:<top-level comment id>`. */
export function youtubeParentCommentId(externalId: string | null) {
  if (!externalId) return null;
  const value = externalId.startsWith("youtube:")
    ? externalId.slice("youtube:".length)
    : externalId;
  return value.trim() || null;
}

/**
 * Sends one reply through whichever provider owns the thread. Shared by the
 * first attempt and by a retry, so both take exactly the same path.
 */
export async function dispatchDelivery(
  target: DeliveryTarget,
  text: string,
): Promise<Delivery> {
  switch (target.channel) {
    case "telegram":
      return deliverTelegramMessage(target.telegramChatId, text);
    case "whatsapp":
      return deliverWhatsAppMessage({
        workspaceId: target.workspaceId,
        address: target.address,
        text,
      });
    case "instagram":
      return deliverInstagramMessage({
        workspaceId: target.workspaceId,
        address: target.address,
        text,
      });
    case "sms":
      return deliverSmsMessage({
        workspaceId: target.workspaceId,
        address: target.address,
        text,
      });
    case "discord":
      return deliverDiscordMessage({
        workspaceId: target.workspaceId,
        address: target.address,
        text,
      });
    case "x":
      return deliverXMessage({
        workspaceId: target.workspaceId,
        address: target.address,
        text,
      });
    case "youtube":
      return deliverYouTubeReply({
        workspaceId: target.workspaceId,
        parentCommentId: youtubeParentCommentId(target.lastInboundExternalId),
        text,
      });
    default:
      return {
        status: "failed",
        error: `${target.channelName} delivery is not wired yet.`,
      };
  }
}

/** The template path is WhatsApp-only and takes its own provider call. */
export async function dispatchTemplate(
  target: DeliveryTarget,
  input: { name: string; language: string; params: string[] },
): Promise<Delivery> {
  return deliverWhatsAppTemplate({
    workspaceId: target.workspaceId,
    address: target.address,
    name: input.name,
    language: input.language,
    params: input.params,
  });
}
