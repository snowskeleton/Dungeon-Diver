import { PeerId } from "shared";
import { Transport } from "./Transport";
import { Signaling } from "./Signaling";

/**
 * WebRTC is the real transport under P2P: once the signaling server has introduced two
 * browsers (see Signaling), they open a direct RTCDataChannel and the signaling socket
 * steps out of the game loop. This module is the ONLY place that touches
 * RTCPeerConnection; everything above it speaks the transport-agnostic `Transport`
 * (which a loopback pipe also satisfies, so the session logic is tested without a
 * browser — this adapter is the thin, un-headless-able remainder).
 *
 * The negotiation is textbook offer/answer + trickle ICE, relayed as opaque `signal`
 * payloads. The guest is the offerer (it creates the data channel); the host answers
 * and adopts the channel the guest opened.
 */

const RTC_CONFIG: RTCConfiguration = {
  // A public STUN server is enough to discover reflexive candidates for peers behind
  // typical NATs; same-LAN peers connect on host candidates without it. No TURN — a
  // fully symmetric-NAT pair won't connect, which is an acceptable first-cut limit.
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

/** One end of the WebRTC data channel as a Transport. Configured ordered + reliable,
 *  so the codec's assumption of in-order delivery holds. */
class WebRTCTransport implements Transport {
  private msgCb: ((data: string) => void) | null = null;
  private closeCb: (() => void) | null = null;

  constructor(
    private readonly pc: RTCPeerConnection,
    private readonly channel: RTCDataChannel,
  ) {
    channel.onmessage = (ev) => this.msgCb?.(String(ev.data));
    channel.onclose = () => this.closeCb?.();
    // A failed/closed connection is a close from the consumer's point of view.
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "failed" || s === "closed" || s === "disconnected") this.closeCb?.();
    };
  }

  send(data: string): void {
    if (this.channel.readyState === "open") this.channel.send(data);
  }

  onMessage(cb: (data: string) => void): void {
    this.msgCb = cb;
  }

  onClose(cb: () => void): void {
    this.closeCb = cb;
  }

  close(): void {
    try {
      this.channel.close();
    } finally {
      this.pc.close();
    }
  }
}

/** Wire a peer connection's local ICE candidates out through the signaling relay. */
function relayIce(pc: RTCPeerConnection, signaling: Signaling, to: PeerId): void {
  pc.onicecandidate = (ev) => {
    if (ev.candidate) signaling.signal(to, { candidate: ev.candidate.toJSON() });
  };
}

type SignalData = { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

/**
 * GUEST side: dial a host peer and resolve with an open Transport. Creates the data
 * channel, sends an offer, applies the host's answer, and trickles ICE both ways.
 */
export function dialHost(
  signaling: Signaling,
  hostId: PeerId,
  timeoutMs = 15000,
): Promise<Transport> {
  return new Promise<Transport>((resolve, reject) => {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const channel = pc.createDataChannel("game", { ordered: true });
    let settled = false;

    const timer = setTimeout(() => fail(new Error("Timed out connecting to the host.")), timeoutMs);
    const unsub = signaling.onSignal((from, data) => {
      if (from !== hostId) return;
      void onSignal(data as SignalData);
    });

    const cleanup = () => {
      clearTimeout(timer);
      unsub();
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      pc.close();
      reject(err);
    };

    relayIce(pc, signaling, hostId);
    channel.onopen = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(new WebRTCTransport(pc, channel));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") fail(new Error("WebRTC connection failed."));
    };

    const onSignal = async (data: SignalData) => {
      try {
        if (data.sdp) await pc.setRemoteDescription(data.sdp);
        else if (data.candidate) await pc.addIceCandidate(data.candidate);
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    };

    void (async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        signaling.signal(hostId, { sdp: offer });
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    })();
  });
}

/**
 * HOST side: listen on the signaling socket for guests dialing in, and hand each opened
 * data channel to `onGuest` as a Transport. One RTCPeerConnection per guest peer, keyed
 * by peer id; ICE that arrives before the offer is buffered by the browser once the
 * remote description is set. Returns an unsubscribe that tears every peer down.
 */
export function acceptGuests(signaling: Signaling, onGuest: (t: Transport) => void): () => void {
  const peers = new Map<PeerId, RTCPeerConnection>();

  const ensurePeer = (from: PeerId): RTCPeerConnection => {
    let pc = peers.get(from);
    if (pc) return pc;
    pc = new RTCPeerConnection(RTC_CONFIG);
    peers.set(from, pc);
    relayIce(pc, signaling, from);
    pc.ondatachannel = (ev) => {
      const channel = ev.channel;
      channel.onopen = () => onGuest(new WebRTCTransport(pc!, channel));
      // If it opened before we attached (fast path), adopt it immediately.
      if (channel.readyState === "open") onGuest(new WebRTCTransport(pc!, channel));
    };
    pc.onconnectionstatechange = () => {
      const s = pc!.connectionState;
      if (s === "failed" || s === "closed") {
        peers.delete(from);
      }
    };
    return pc;
  };

  const unsub = signaling.onSignal((from, raw) => {
    const data = raw as SignalData;
    const pc = ensurePeer(from);
    void (async () => {
      try {
        if (data.sdp) {
          await pc.setRemoteDescription(data.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          signaling.signal(from, { sdp: answer });
        } else if (data.candidate) {
          await pc.addIceCandidate(data.candidate);
        }
      } catch {
        // A bad/late candidate is non-fatal — drop it and let ICE keep trying.
      }
    })();
  });

  const unsubLeft = signaling.onPeerLeft((peerId) => {
    peers.get(peerId)?.close();
    peers.delete(peerId);
  });

  return () => {
    unsub();
    unsubLeft();
    for (const pc of peers.values()) pc.close();
    peers.clear();
  };
}
