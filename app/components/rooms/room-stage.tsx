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
      type: "signal";
      from: string;
      payload:
        | { kind: "offer" | "answer"; sdp: RTCSessionDescriptionInit }
        | { kind: "ice"; candidate: RTCIceCandidateInit };
    };

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

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
      setNotice("Signaling dropped — reconnecting automatically.");
    };

    setJoined(true);
    setConnecting(false);
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
    <div className="min-h-screen bg-[#08090b] px-4 py-8 text-slate-200">
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <p className="text-[11px] text-slate-500">Room · {me.name}</p>
            <h1 className="truncate text-xl font-semibold tracking-tight text-white">
              {roomName}
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={copyInvite}
              className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] font-medium text-slate-300 hover:text-white"
            >
              {copied ? "Link copied" : "Copy invite link"}
            </button>
            <Link
              href="/meetings"
              className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] font-medium text-slate-300 hover:text-white"
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
          <div className="mt-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-16 text-center">
            <VideoIcon className="mx-auto h-7 w-7 text-slate-600" />
            <p className="mt-3 text-sm font-medium text-slate-200">
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
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-400 disabled:opacity-60"
            >
              <VideoIcon className="h-4 w-4" />
              {connecting ? "Connecting…" : "Join with camera"}
            </button>
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-black">
                <video
                  ref={localVideo}
                  autoPlay
                  playsInline
                  muted
                  className="aspect-video w-full object-cover"
                />
                <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-[10px] text-slate-200">
                  You{camOn ? "" : " · camera off"}
                </span>
              </div>

              {peers.map((peer) => (
                <div
                  key={peer.id}
                  className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-black"
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
                  <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-[10px] text-slate-200">
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

            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={toggleMic}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold ${
                  micOn
                    ? "border border-white/[0.08] bg-white/[0.04] text-slate-200"
                    : "bg-amber-500/20 text-amber-200"
                }`}
              >
                <MicIcon className="h-4 w-4" />
                {micOn ? "Mute" : "Unmute"}
              </button>
              <button
                type="button"
                onClick={toggleCamera}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold ${
                  camOn
                    ? "border border-white/[0.08] bg-white/[0.04] text-slate-200"
                    : "bg-amber-500/20 text-amber-200"
                }`}
              >
                <VideoIcon className="h-4 w-4" />
                {camOn ? "Stop camera" : "Start camera"}
              </button>
              <button
                type="button"
                onClick={leave}
                className="flex items-center gap-2 rounded-xl bg-rose-500/90 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500"
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
