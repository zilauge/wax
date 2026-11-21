import "server-only";

/**
 * Signaling hub for the media rooms.
 *
 * Browser-to-browser WebRTC only needs the server to exchange descriptions and
 * ICE candidates; audio and video never touch it. Participants are ephemeral
 * and in-process, so a room with nobody in it costs nothing, while the durable
 * room row (and who may enter it) lives in SQLite.
 */
export type Peer = { id: string; name: string };

type Member = Peer & { send: (data: unknown) => void };

type Rooms = Map<string, Map<string, Member>>;

const globalForRooms = globalThis as unknown as { waxRooms?: Rooms };
const rooms: Rooms = (globalForRooms.waxRooms ??= new Map());

function broadcast(roomId: string, except: string, data: unknown) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const member of room.values()) {
    if (member.id !== except) member.send(data);
  }
}

/** Adds a participant and returns who was already there. */
export function joinRoom(
  roomId: string,
  member: Member,
): { id: string; name: string }[] {
  let room = rooms.get(roomId);
  if (!room) {
    room = new Map();
    rooms.set(roomId, room);
  }

  const existing = [...room.values()]
    .filter((peer) => peer.id !== member.id)
    .map((peer) => ({ id: peer.id, name: peer.name }));

  room.set(member.id, member);
  broadcast(roomId, member.id, {
    type: "peer-joined",
    peer: { id: member.id, name: member.name },
  });

  return existing;
}

export function leaveRoom(roomId: string, peerId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.delete(peerId);
  if (room.size === 0) rooms.delete(roomId);
  else broadcast(roomId, peerId, { type: "peer-left", peer: { id: peerId } });
}

export function roster(roomId: string): Peer[] {
  const room = rooms.get(roomId);
  return room
    ? [...room.values()].map(({ id, name }) => ({ id, name }))
    : [];
}

/** Delivers one signaling message; returns false when the peer has gone. */
export function relay(roomId: string, from: string, to: string, payload: unknown) {
  const target = rooms.get(roomId)?.get(to);
  if (!target) return false;
  target.send({ type: "signal", from, payload });
  return true;
}
