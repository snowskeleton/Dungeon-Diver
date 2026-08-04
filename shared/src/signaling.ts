/**
 * The P2P signaling protocol: how a browser talks to the serving process to find,
 * announce, and connect to rooms that are HOSTED ON OTHER BROWSERS.
 *
 * Multiplayer is host-authoritative peer-to-peer — one player's browser runs the
 * simulation as host, guests connect to it directly over WebRTC. The serving
 * process is not in the game loop; it only brokers the introduction:
 *
 *   - a host announces its room (`host-register`) and keeps the socket open,
 *   - a browser discovers public rooms (`list`) or resolves a private code
 *     (`resolve-code`) to a host,
 *   - the two peers then exchange WebRTC offer/answer/ICE as opaque `signal`
 *     payloads the server relays between them (never inspects).
 *
 * Every message is JSON with a `type` tag. Requests may carry a `reqId` the reply
 * echoes, so a client can have several in flight without confusing the answers.
 */

import { RoomListing, RunPhase } from "./lobby";

/** The path the signaling WebSocket connects on, beside the static file routes. */
export const SIGNALING_PATH = "/ws";

/** Identifies one browser's socket to the server. A hosted room's id IS its host's
 *  peer id — resolving a code hands a guest the peer to open a WebRTC channel to. */
export type PeerId = string;

/** The three distinct answers a code lookup can give — each a different thing for a
 *  player to do next: mistyped, too late, or wait for a seat. */
export type CodeLookup =
  | { ok: true; roomId: PeerId }
  | { ok: false; status: number; error: string };

// ── Client → Server ───────────────────────────────────────────────────────────

/** Announce a room and keep this socket open as its host. The server allocates the
 *  code and uses this socket's peer id as the room id; the room starts in "lobby". */
export interface HostRegisterMsg {
  type: "host-register";
  reqId?: string;
  roomName: string;
  hostName: string;
  isPrivate: boolean;
  maxClients: number;
}

/** Update this host's own room as it changes — phase flips to "run", it locks, the
 *  player count moves. Only the socket that registered the room may update it. */
export interface HostUpdateMsg {
  type: "host-update";
  phase?: RunPhase;
  locked?: boolean;
  clients?: number;
  roomName?: string;
}

/** Drop this host's room from the registry (also happens automatically on disconnect). */
export interface UnregisterMsg {
  type: "unregister";
}

/** Ask for the public, joinable rooms. */
export interface ListMsg {
  type: "list";
  reqId?: string;
}

/** Resolve a 4-character code to a host, including private rooms (absent from `list`). */
export interface ResolveCodeMsg {
  type: "resolve-code";
  reqId?: string;
  code: string;
}

/** Relay an opaque payload (WebRTC offer/answer/ICE) to another peer. */
export interface SignalSendMsg {
  type: "signal";
  to: PeerId;
  data: unknown;
}

export type ClientMessage =
  | HostRegisterMsg
  | HostUpdateMsg
  | UnregisterMsg
  | ListMsg
  | ResolveCodeMsg
  | SignalSendMsg;

// ── Server → Client ───────────────────────────────────────────────────────────

/** This socket's assigned peer id, sent once on connect so a guest can address it. */
export interface WelcomeMsg {
  type: "welcome";
  peerId: PeerId;
}

/** A room was registered — its id (the host's peer id) and allocated code. */
export interface RegisteredMsg {
  type: "registered";
  reqId?: string;
  roomId: PeerId;
  code: string;
}

/** The public, joinable rooms, in reply to `list`. */
export interface RoomListMsg {
  type: "room-list";
  reqId?: string;
  rooms: RoomListing[];
}

/** The answer to `resolve-code`. */
export interface ResolvedMsg {
  type: "resolved";
  reqId?: string;
  result: CodeLookup;
}

/** A relayed payload from another peer (the counterpart to SignalSendMsg). */
export interface SignalRecvMsg {
  type: "signal";
  from: PeerId;
  data: unknown;
}

/** A peer this client was signaling with dropped its socket. */
export interface PeerLeftMsg {
  type: "peer-left";
  peerId: PeerId;
}

/** A request could not be honored (bad payload, not the room's host, …). */
export interface ErrorMsg {
  type: "error";
  reqId?: string;
  reason: string;
}

export type ServerMessage =
  | WelcomeMsg
  | RegisteredMsg
  | RoomListMsg
  | ResolvedMsg
  | SignalRecvMsg
  | PeerLeftMsg
  | ErrorMsg;
