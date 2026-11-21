"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { requireUser } from "@/app/lib/auth/auth";
import { createRoom } from "./store";

/** Opens a room and sends the caller straight into it. */
export async function startRoomAction(formData: FormData) {
  const user = await requireUser();
  const name =
    String(formData.get("name") ?? "").trim() ||
    `${user.name.split(" ")[0]}'s room`;

  const id = createRoom({
    id: randomUUID(),
    workspaceId: user.workspaceId,
    name: name.slice(0, 120),
    createdBy: user.id,
  });

  redirect(`/rooms/${id}`);
}
