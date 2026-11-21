import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/app/lib/auth/auth";
import { roomInWorkspace } from "@/app/lib/rooms/store";
import RoomStage from "@/app/components/rooms/room-stage";

export const metadata: Metadata = { title: "Room — Wax" };

export default async function RoomPage({
  params,
}: {
  params: Promise<{ room: string }>;
}) {
  const user = await requireUser();
  const { room } = await params;
  const found = roomInWorkspace(room, user.workspaceId);

  if (!found) notFound();

  return (
    <RoomStage
      roomId={found.id}
      roomName={found.name}
      me={{ id: user.id, name: user.name }}
    />
  );
}

export const instant = false;
