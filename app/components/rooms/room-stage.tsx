"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { MicIcon, PhoneIcon, VideoIcon } from "@/app/components/shared/icons";

type RemotePeer = { id: string; name: string; stream: MediaStream | null };

type SignalMessage =
  | { type: "roster"; peers: { id: string; name: string }[] }
  | { type: "peer-joined"; peer: { id: string; name: string } }
  | { type: "peer-left"; peer: { id: string } }
  | {
      type: "chat";
      from: string;
      name: string;
      text: string;
      at: number;
    }
  | {
      type: "signal";
      from: string;
      payload:
        | { kind: "offer" | "answer"; sdp: RTCSessionDescriptionInit }
        | { kind: "ice"; candidate: RTCIceCandidateInit };
    };

type ChatLine = { id: string; name: string; text: string; at: number; mine: boolean };

/**
 * STUN alone works on many home networks; a TURN relay is what makes calls
 * survive strict corporate NAT. Set NEXT_PUBLIC_TURN_URL/USERNAME/CREDENTIAL to
 * add one — without it a blocked pair simply fails to connect, and the room
 * says so rather than looking frozen.
 */
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    ...(process.env.NEXT_PUBLIC_TURN_URL
      ? [
          {
            urls: process.env.NEXT_PUBLIC_TURN_URL,
            username: process.env.NEXT_PUBLIC_TURN_USERNAME,
            credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
          },
        ]
      : []),
  ],
};

const MAX_PEERS = 6;

/**
 * A live room: the browser captures media locally, opens an SSE stream for
 * signaling, and connects to each other participant directly with WebRTC in a
 * small mesh. Starting a peer connection is deterministic — whoever is already
 * in the room answers, the newcomer offers — so two people never glare.
 */
export default function RoomStage({
  roomId,
  roomName,
  me,
}: {
  roomId: string;
  roomName: string;
  me: { id: string; name: string };
}) {
  const [joined, setJoined] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [copied, setCopied] = useState(false);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [chatDraft, setChatDraft] = useState("");

  const localVideo = useRef<HTMLVideoElement | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const connections = useRef(new Map<string, RTCPeerConnection>());
  const pendingIce = useRef(new Map<string, RTCIceCandidateInit[]>());
  const events = useRef<EventSource | null>(null);
  const peerId = useRef("");

  const send = useCallback(
    async (to: string, payload: unknown) => {
      await fetch(`/api/rooms/${roomId}/signal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: peerId.current, to, payload }),
      }).catch(() => {
        // A peer that left mid-handshake is not an error worth surfacing.
      });
    },
    [roomId],
  );

  const dropPeer = useCallback((id: string) => {
    connections.current.get(id)?.close();
    connections.current.delete(id);
    pendingIce.current.delete(id);
    setPeers((current) => current.filter((peer) => peer.id !== id));
  }, []);

  const peerConnection = useCallback(
    (remote: { id: string; name: string }, initiator: boolean) => {
      const existing = connections.current.get(remote.id);
      if (existing) return existing;

      const pc = new RTCPeerConnection(ICE_SERVERS);
      connections.current.set(remote.id, pc);

      const media = localStream.current;
      if (media) {
        for (const track of media.getTracks()) pc.addTrack(track, media);
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          void send(remote.id, {
            kind: "ice",
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (!remoteStream) return;
        setPeers((current) =>
          current.map((peer) =>
            peer.id === remote.id ? { ...peer, stream: remoteStream } : peer,
          ),
        );
      };

      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed" ||
          pc.connectionState === "disconnected"
        ) {
          dropPeer(remote.id);
        }
      };

      setPeers((current) =>
        current.some((peer) => peer.id === remote.id)
          ? current
          : [...current, { id: remote.id, name: remote.name, stream: null }],
      );

      if (initiator) {
        void (async () => {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await send(remote.id, { kind: "offer", sdp: offer });
        })();
      }

      return pc;
    },
    [dropPeer, send],
  );

  const flushIce = useCallback(async (id: string, pc: RTCPeerConnection) => {
    const queue = pendingIce.current.get(id) ?? [];
    pendingIce.current.delete(id);
    for (const candidate of queue) {
      await pc.addIceCandidate(candidate).catch(() => {});
    }
  }, []);

  const handleMessage = useCallback(
    async (message: SignalMessage) => {
      if (message.type === "roster") {
        for (const peer of message.peers) peerConnection(peer, true);
        return;
      }

      if (message.type === "peer-joined") {
        peerConnection(message.peer, false);
        return;
      }

      if (message.type === "peer-left") {
        dropPeer(message.peer.id);
        return;
      }

      if (message.type === "chat") {
        setChat((current) => [
          ...current,
          {
            id: `${message.from}-${message.at}`,
            name: message.name,
            text: message.text,
            at: message.at,
            mine: false,
          },
        ]);
        return;
      }

      const pc = connections.current.get(message.from);
      if (!pc) return;
      const payload = message.payload;

      if (payload.kind === "ice") {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(payload.candidate).catch(() => {});
        } else {
          const queue = pendingIce.current.get(message.from) ?? [];
          queue.push(payload.candidate);
          pendingIce.current.set(message.from, queue);
        }
        return;
      }

      if (payload.kind === "offer") {
        await pc.setRemoteDescription(payload.sdp);
        await flushIce(message.from, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await send(message.from, { kind: "answer", sdp: answer });
        return;
      }

      await pc.setRemoteDescription(payload.sdp);
      await flushIce(message.from, pc);
    },
    [dropPeer, flushIce, peerConnection, send],
  );

  const leave = useCallback(() => {
    events.current?.close();
    events.current = null;
    for (const pc of connections.current.values()) pc.close();
    connections.current.clear();
    pendingIce.current.clear();
    localStream.current?.getTracks().forEach((track) => track.stop());
    localStream.current = null;
    if (localVideo.current) localVideo.current.srcObject = null;
    setPeers([]);
    setJoined(false);
  }, []);

  useEffect(() => leave, [leave]);

  async function join() {
    setConnecting(true);
    setError(null);
    setNotice(null);
    peerId.current = crypto.randomUUID();

    try {
      try {
        localStream.current = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
      } catch {
        localStream.current = await navigator.mediaDevices
          .getUserMedia({ audio: true })
          .catch(() => null);
        setNotice(
          localStream.current
            ? "Camera unavailable — joined with audio only."
            : "No camera or microphone available. You can still see and hear everyone.",
        );
      }
    } catch {
      // Treated as a media-less join; signaling below still runs.
    }

    if (localVideo.current) localVideo.current.srcObject = localStream.current;
    setMicOn(localStream.current?.getAudioTracks().some((t) => t.enabled) ?? true);
    setCamOn((localStream.current?.getVideoTracks().length ?? 0) > 0);

    const source = new EventSource(
      `/api/rooms/${roomId}/signal?peer=${peerId.current}`,
    );
    events.current = source;

    source.onmessage = (event) => {
      try {
        void handleMessage(JSON.parse(event.data) as SignalMessage);
      } catch {
        // Ignore a malformed frame rather than tearing the call down.
      }
    };

    source.onerror = () => {
      setNotice(
        `Signaling dropped. The room may also be full (${MAX_PEERS} people maximum) — try again in a moment.`,
      );
    };

    setJoined(true);
    setConnecting(false);
  }

  async function sendChat(event: React.FormEvent) {
    event.preventDefault();
    const text = chatDraft.trim();
    if (!text) return;

    setChatDraft("");
    setChat((current) => [
      ...current,
      {
        id: `${peerId.current}-${Date.now()}`,
        name: "You",
        text,
        at: Date.now(),
        mine: true,
      },
    ]);

    await fetch(`/api/rooms/${roomId}/signal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "chat", from: peerId.current, text }),
    }).catch(() => {
      setNotice("That message did not reach the room.");
    });
  }

  function toggleMic() {
    const tracks = localStream.current?.getAudioTracks() ?? [];
    const next = !micOn;
    tracks.forEach((track) => (track.enabled = next));
    setMicOn(next);
  }

  function toggleCamera() {
    const tracks = localStream.current?.getVideoTracks() ?? [];
    const next = !camOn;
    tracks.forEach((track) => (track.enabled = next));
    setCamOn(next);
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice("Copy the address bar to share this room.");
    }
  }

  return (
    <div className="wax-app min-h-screen px-4 py-8 text-slate-200">
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <p className="wax-eyebrow">Room · {me.name}</p>
            <h1 className="truncate text-xl font-semibold tracking-tight text-fg">
              {roomName}
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={copyInvite}
              className="wax-press inline-flex items-center rounded-lg border border-fg/[0.09] bg-fg/[0.035] px-3 py-2 text-[11px] font-semibold text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-colors hover:border-fg/[0.16] hover:bg-fg/[0.075] hover:text-fg"
            >
              {copied ? "Link copied" : "Copy invite link"}
            </button>
            <Link
              href="/meetings"
              className="wax-press inline-flex items-center rounded-lg border border-fg/[0.09] bg-fg/[0.035] px-3 py-2 text-[11px] font-semibold text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-colors hover:border-fg/[0.16] hover:bg-fg/[0.075] hover:text-fg"
            >
              Back to meetings
            </Link>
          </div>
        </div>

        {error && (
          <p className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-2 text-[11px] text-rose-300">
            {error}
          </p>
        )}
        {notice && (
          <p className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-[11px] text-amber-200">
            {notice}
          </p>
        )}

        {!joined ? (
          <div className="wax-panel wax-enter mt-6 px-6 py-16 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-fg/[0.08] bg-fg/[0.03] text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <VideoIcon className="h-5 w-5" />
            </span>
            <p className="mt-4 text-sm font-medium text-slate-200">
              Join the room
            </p>
            <p className="mx-auto mt-1.5 max-w-sm text-[11px] leading-relaxed text-slate-500">
              Your camera and microphone stay on this device; the server only
              relays connection details so peers can find each other.
            </p>
            <button
              type="button"
              onClick={join}
              disabled={connecting}
              className="wax-press wax-sheen mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-indigo-500 to-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_16px_34px_-20px_rgba(99,102,241,1)] transition-colors hover:from-indigo-400 hover:to-indigo-500 disabled:opacity-60"
            >
              <VideoIcon className="h-4 w-4" />
              {connecting ? "Connecting…" : "Join with camera"}
            </button>
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="relative overflow-hidden rounded-2xl border border-fg/[0.08] bg-black shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_20px_40px_-34px_rgba(0,0,0,1)]">
                <video
                  ref={localVideo}
                  autoPlay
                  playsInline
                  muted
                  className="aspect-video w-full object-cover"
                />
                <span className="absolute bottom-2 left-2 rounded-md border border-white/10 bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                  You{camOn ? "" : " · camera off"}
                </span>
              </div>

              {peers.map((peer) => (
                <div
                  key={peer.id}
                  className="relative overflow-hidden rounded-2xl border border-fg/[0.08] bg-black shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_20px_40px_-34px_rgba(0,0,0,1)]"
                >
                  <video
                    ref={(node) => {
                      if (node && peer.stream) node.srcObject = peer.stream;
                    }}
                    autoPlay
                    playsInline
                    className="aspect-video w-full object-cover"
                  />
                  {!peer.stream && (
                    <span className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-500">
                      Connecting…
                    </span>
                  )}
                  <span className="absolute bottom-2 left-2 rounded-md border border-white/10 bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                    {peer.name}
                  </span>
                </div>
              ))}
            </div>

            {peers.length === 0 && (
              <p className="mt-3 text-center text-[11px] text-slate-500">
                You are the only one here. Share the invite link to bring
                someone in.
              </p>
            )}

            <section
              aria-label="Room chat"
              className="wax-panel mt-5 overflow-hidden"
            >
              <div className="max-h-48 space-y-1.5 overflow-y-auto px-4 py-3">
                {chat.length === 0 && (
                  <p className="text-[11px] text-slate-500">
                    Messages here are visible to everyone in the room and are not
                    saved after the call.
                  </p>
                )}
                {chat.map((line) => (
                  <p key={line.id} className="text-[11px] leading-relaxed">
                    <span
                      className={
                        line.mine
                          ? "font-semibold text-indigo-300"
                          : "font-semibold text-slate-200"
                      }
                    >
                      {line.name}
                    </span>{" "}
                    <span className="text-slate-400">{line.text}</span>
                  </p>
                ))}
              </div>
              <form
                onSubmit={sendChat}
                className="flex items-center gap-2 border-t border-fg/[0.06] px-3 py-2"
              >
                <input
                  value={chatDraft}
                  onChange={(event) => setChatDraft(event.target.value)}
                  placeholder="Message the room…"
                  aria-label="Message the room"
                  className="min-w-0 flex-1 bg-transparent text-[12px] text-slate-200 placeholder:text-slate-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!chatDraft.trim()}
                  className="wax-press wax-sheen rounded-lg bg-gradient-to-b from-indigo-500 to-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition-colors hover:from-indigo-400 hover:to-indigo-500 disabled:opacity-50"
                >
                  Send
                </button>
              </form>
            </section>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={toggleMic}
                className={`wax-press flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold ${
                  micOn
                    ? "border border-fg/[0.09] bg-fg/[0.035] text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] hover:border-fg/[0.16] hover:bg-fg/[0.075] hover:text-fg"
                    : "border border-amber-400/30 bg-amber-500/15 text-amber-200"
                }`}
              >
                <MicIcon className="h-4 w-4" />
                {micOn ? "Mute" : "Unmute"}
              </button>
              <button
                type="button"
                onClick={toggleCamera}
                className={`wax-press flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold ${
                  camOn
                    ? "border border-fg/[0.09] bg-fg/[0.035] text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] hover:border-fg/[0.16] hover:bg-fg/[0.075] hover:text-fg"
                    : "border border-amber-400/30 bg-amber-500/15 text-amber-200"
                }`}
              >
                <VideoIcon className="h-4 w-4" />
                {camOn ? "Stop camera" : "Start camera"}
              </button>
              <button
                type="button"
                onClick={leave}
                className="wax-press flex items-center gap-2 rounded-xl bg-rose-500/90 px-4 py-2 text-xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] transition-colors hover:bg-rose-500"
              >
                <PhoneIcon className="h-4 w-4" />
                Leave
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
