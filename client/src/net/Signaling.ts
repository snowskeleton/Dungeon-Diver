import {
  SIGNALING_PATH,
  ClientMessage,
  ServerMessage,
  RoomListing,
  CodeLookup,
  PeerId,
} from "shared";
import { SERVER_URL } from "./serverUrl";

/**
 * One WebSocket to the signaling server — the client half of the P2P introduction.
 *
 * It does the discovery half (list public rooms, resolve a private code, announce a
 * hosted room) and relays opaque WebRTC payloads between this browser and a peer.
 * It carries NO game state; once two peers are introduced they talk directly over a
 * WebRTC data channel (Transport, Milestone 3) and this socket only matters again if
 * either wants to renegotiate or host discovery.
 *
 * The socket is lazily opened and shared process-wide: the room browser lists before
 * any party exists, and a host keeps the same socket open for its whole session.
 */

type Pending = { resolve: (msg: ServerMessage) => void; reject: (err: Error) => void };
type SignalHandler = (from: PeerId, data: unknown) => void;

let counter = 0;
const nextReqId = () => `r${counter++}`;

export class Signaling {
  private ws: WebSocket | null = null;
  private opening: Promise<WebSocket> | null = null;
  private peerId: PeerId | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly signalHandlers = new Set<SignalHandler>();
  private readonly peerLeftHandlers = new Set<(peerId: PeerId) => void>();

  /** This browser's peer id, once the socket is open (its hosted room id). */
  get id(): PeerId | null {
    return this.peerId;
  }

  private connect(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    if (this.opening) return this.opening;

    this.opening = new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`${SERVER_URL}${SIGNALING_PATH}`);
      ws.onmessage = (ev) => this.onMessage(ev);
      ws.onerror = () => reject(new Error("Couldn't reach the signaling server."));
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
        this.opening = null;
        for (const p of this.pending.values()) p.reject(new Error("Signaling connection closed."));
        this.pending.clear();
      };
      ws.onopen = () => {
        this.ws = ws;
        resolve(ws);
      };
    });
    return this.opening;
  }

  private onMessage(ev: MessageEvent): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg.type === "welcome") {
      this.peerId = msg.peerId;
      return;
    }
    if (msg.type === "signal") {
      this.signalHandlers.forEach((h) => h(msg.from, msg.data));
      return;
    }
    if (msg.type === "peer-left") {
      this.peerLeftHandlers.forEach((h) => h(msg.peerId));
      return;
    }
    // Request/reply: match on the echoed reqId.
    const reqId = "reqId" in msg ? msg.reqId : undefined;
    if (reqId && this.pending.has(reqId)) {
      const p = this.pending.get(reqId)!;
      this.pending.delete(reqId);
      p.resolve(msg);
    }
  }

  private send(msg: ClientMessage): void {
    this.ws?.send(JSON.stringify(msg));
  }

  /** Send a request and await the reply whose reqId matches. */
  private async request(msg: ClientMessage & { reqId?: string }): Promise<ServerMessage> {
    const ws = await this.connect();
    const reqId = nextReqId();
    return new Promise<ServerMessage>((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      ws.send(JSON.stringify({ ...msg, reqId }));
    });
  }

  /** The public, joinable rooms hosted by other browsers. */
  async list(): Promise<RoomListing[]> {
    const reply = await this.request({ type: "list" });
    return reply.type === "room-list" ? reply.rooms : [];
  }

  /** Resolve a 4-character code to a host peer (or the reason it can't be joined). */
  async resolveCode(code: string): Promise<CodeLookup> {
    const reply = await this.request({ type: "resolve-code", code });
    if (reply.type === "resolved") return reply.result;
    return { ok: false, status: 500, error: "Unexpected signaling reply." };
  }

  /** Announce a room hosted by this browser. Returns the assigned room id + code and
   *  keeps the socket open — the host receives guests' signals on it. */
  async register(input: {
    roomName: string;
    hostName: string;
    isPrivate: boolean;
    maxClients: number;
  }): Promise<{ roomId: PeerId; code: string }> {
    const reply = await this.request({ type: "host-register", ...input });
    if (reply.type !== "registered") throw new Error("Signaling server refused the room.");
    return { roomId: reply.roomId, code: reply.code };
  }

  /** Update this host's room as it changes (phase → run, lock, player count). */
  update(patch: { phase?: "lobby" | "run"; locked?: boolean; clients?: number; roomName?: string }): void {
    this.send({ type: "host-update", ...patch });
  }

  /** Relay an opaque WebRTC payload to another peer. */
  signal(to: PeerId, data: unknown): void {
    this.send({ type: "signal", to, data });
  }

  /** Subscribe to relayed payloads from other peers. Returns an unsubscribe. */
  onSignal(handler: SignalHandler): () => void {
    this.signalHandlers.add(handler);
    return () => this.signalHandlers.delete(handler);
  }

  /** Subscribe to "a peer we were signaling with dropped". Returns an unsubscribe. */
  onPeerLeft(handler: (peerId: PeerId) => void): () => void {
    this.peerLeftHandlers.add(handler);
    return () => this.peerLeftHandlers.delete(handler);
  }

  /** Ensure the socket is open (so `id` is populated) without sending a request. */
  async ready(): Promise<void> {
    await this.connect();
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}

/** The process-wide signaling socket. The browser lists rooms before a party exists,
 *  and a host keeps one socket for its whole session, so this is shared. */
export const signaling = new Signaling();
