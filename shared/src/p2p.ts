/**
 * The peer-channel protocol: what a host and a guest say to each other over the
 * WebRTC data channel, ONCE the signaling server has introduced them (see
 * `signaling.ts` for the introduction). This is the game wire — it carries commands
 * up and state down — and is transport-agnostic: the same messages ride a real
 * RTCDataChannel in the browser and an in-memory pipe in the headless tests.
 *
 * The host runs the authoritative GameRoom; a guest holds only its own copy of the
 * GameState and never simulates. So the traffic is asymmetric:
 *   guest → host:  `join` (request a seat), `cmd` (input/buy/startRun/…), `leave`
 *   host → guest:  `welcome` (your session id), `snapshot` (full state, once),
 *                  `delta` (per-tick change), `msg` (a broadcast or directed send)
 *
 * `snapshot`/`delta` payloads are the replication codec's `Encoded` form (plain JSON).
 * Everything is JSON — `Transport.send` takes a string, so these are stringified.
 */

import type { Encoded } from "./observable/replication";

// ── Guest → Host ────────────────────────────────────────────────────────────────

/** Request a seat in the room. The host answers with `welcome` then `snapshot`. */
export interface JoinChannelMsg {
  k: "join";
  options: import("./lobby").JoinRoomOptions;
}

/** A command from this guest — the exact (type, payload) a local seat would dispatch
 *  (`input`, `buy`, `startRun`, `setReady`, …). The host dispatches it into GameRoom
 *  under this guest's session id. */
export interface CmdChannelMsg {
  k: "cmd";
  type: string;
  payload?: unknown;
}

/** The guest is leaving the room. */
export interface LeaveChannelMsg {
  k: "leave";
}

export type GuestChannelMsg = JoinChannelMsg | CmdChannelMsg | LeaveChannelMsg;

// ── Host → Guest ────────────────────────────────────────────────────────────────

/** The session id the host assigned this guest — the key for its player row, so the
 *  guest knows which player in the synced state is itself. */
export interface WelcomeChannelMsg {
  k: "welcome";
  sessionId: string;
}

/** The full current state, sent once right after `welcome`, so the guest's GameState
 *  is populated before it reads anything. Deltas follow. */
export interface SnapshotChannelMsg {
  k: "snapshot";
  data: Encoded;
}

/** One tick's change, applied on top of the snapshot (and prior deltas). */
export interface DeltaChannelMsg {
  k: "delta";
  data: Encoded;
}

/** A broadcast or a directed `client.send` from the sim (`hits`, `floor_change`,
 *  `loot_error`, …) — delivered to the guest's `onMessage` listeners verbatim. */
export interface RelayChannelMsg {
  k: "msg";
  type: string;
  payload?: unknown;
}

export type HostChannelMsg =
  | WelcomeChannelMsg
  | SnapshotChannelMsg
  | DeltaChannelMsg
  | RelayChannelMsg;

export type ChannelMsg = GuestChannelMsg | HostChannelMsg;
