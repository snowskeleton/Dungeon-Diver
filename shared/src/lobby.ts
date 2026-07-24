/**
 * The lobby / matchmaking layer: what a room IS before anyone is playing it.
 *
 * A run now has two phases inside ONE Colyseus room (playtest decisions D8/D12).
 * The alternative — a separate lobby room that hands you off to a game room —
 * would need every client to tear down one connection and re-establish another
 * at exactly the moment the run starts, with a party to keep in sync across the
 * gap. Instead the room a party gathers in is the room they play in: joining is
 * ordinary matchmaking, and "no dropping into a run in progress" is one
 * `room.lock()` when the phase flips.
 */

/** Which half of its life a room is in. `run` is one-way — a room never goes back. */
export type RunPhase = "lobby" | "run";

/** Join-time options the host sends when creating a room (`client.create`). */
export interface CreateRoomOptions {
  /** Shown in the browser list. Trimmed and clamped to MAX_ROOM_NAME_LEN server-side. */
  roomName?: string;
  /** Private rooms are unlisted and reachable only by their code. */
  isPrivate?: boolean;
  /** Pin the floor-1 dungeon seed. Omitted for a normal run (the server rolls a
   *  random one so no two runs match); supplied to reproduce a specific dungeon. */
  seed?: number;
}

/** What every client sends on join, host or not. */
export interface JoinRoomOptions {
  playerName?: string;
  characterClass?: string;
  characterType?: string;
  weaponId?: string;
  /** True for players 2–4 on one machine: they follow the host and are born ready. */
  couch?: boolean;
}

/** `room.setMetadata` payload — what a client can see WITHOUT joining, because it
 *  is what `getAvailableRooms` returns alongside clients/maxClients. */
export interface RoomMetadata {
  roomName: string;
  code: string;
  hostName: string;
  phase: RunPhase;
}

/** One row in the browser's room list, as the client assembles it. */
export interface RoomListing {
  roomId: string;
  clients: number;
  maxClients: number;
  metadata: RoomMetadata;
}

// ── Lobby messages ──────────────────────────────────────────────────────────

export interface SetNameMessage {
  name: string;
}

export interface SetLoadoutMessage {
  characterClass: string;
  characterType: string;
  weaponId: string;
}

export interface SetReadyMessage {
  ready: boolean;
}

/** Why the server refused something a lobby client asked for. Sent as a
 *  `lobby_error` message so the panel can say what happened rather than
 *  silently ignoring the click. */
export interface LobbyErrorMessage {
  reason: string;
}

// ── Room codes ──────────────────────────────────────────────────────────────

/** No O/0/I/1 — a code is read aloud or typed from a screenshot, and those four
 *  are the pairs people get wrong. 32 symbols ⁴ ≈ 1M codes. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 4;
export const MAX_ROOM_NAME_LEN = 24;
export const MAX_PLAYER_NAME_LEN = 16;

/** True for a syntactically valid code, so the client can reject a typo before
 *  spending a round trip. Case-insensitive — the input is upper-cased first. */
export function isRoomCode(text: string): boolean {
  if (text.length !== ROOM_CODE_LENGTH) return false;
  return [...text.toUpperCase()].every((c) => ROOM_CODE_ALPHABET.includes(c));
}

/** The one path a code takes to a room id: `GET /api/rooms/by-code/:code`.
 *  Private rooms are absent from `getAvailableRooms` by design, so the client
 *  cannot resolve a code on its own — the server has to look it up. */
export const ROOM_CODE_LOOKUP_PATH = "/api/rooms/by-code";
