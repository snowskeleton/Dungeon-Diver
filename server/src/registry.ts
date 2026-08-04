import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  RoomListing,
  RunPhase,
  CodeLookup,
  PeerId,
} from "shared";

/**
 * The in-memory room registry — the P2P replacement for Colyseus's matchmaker.
 *
 * Rooms live on host browsers, not here; this only remembers who is hosting what,
 * so a stranger can list the public rooms or resolve a private code to a host peer.
 * One entry per hosting socket, keyed by the host's peer id (which IS the room id).
 * Entries vanish when the host disconnects — the caller wires that to socket close.
 *
 * Pure over its own state (no sockets), so it unit-tests directly. The signaling
 * server owns the transport and delegates every room decision here.
 */

interface RoomEntry {
  roomId: PeerId;
  code: string;
  roomName: string;
  hostName: string;
  isPrivate: boolean;
  maxClients: number;
  clients: number;
  phase: RunPhase;
  locked: boolean;
}

export interface RegisterInput {
  roomName: string;
  hostName: string;
  isPrivate: boolean;
  maxClients: number;
}

export interface RoomUpdate {
  phase?: RunPhase;
  locked?: boolean;
  clients?: number;
  roomName?: string;
}

/** A room a stranger may walk into: still gathering, not locked, has a free seat. */
function isJoinable(e: RoomEntry): boolean {
  return e.phase === "lobby" && !e.locked && e.clients < e.maxClients;
}

export class RoomRegistry {
  private readonly byId = new Map<PeerId, RoomEntry>();
  private readonly byCode = new Map<string, PeerId>();

  /** A code no live room is using. Retries rather than trusting randomness: a
   *  collision would silently send a player to a stranger's run, the one failure
   *  mode a join code must not have. After enough tries it returns one anyway —
   *  at that point the registry holds a six-figure number of rooms and the
   *  collision is the lesser problem. `rand` is injectable so tests can force it. */
  allocateCode(rand: () => number = Math.random): string {
    const draw = () => {
      let code = "";
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[Math.floor(rand() * ROOM_CODE_ALPHABET.length)];
      }
      return code;
    };
    for (let attempt = 0; attempt < 24; attempt++) {
      const code = draw();
      if (!this.byCode.has(code)) return code;
    }
    return draw();
  }

  /** Announce a room hosted by `peerId`. Returns its allocated code. Registering a
   *  peer that already hosts replaces the old entry (and frees its code). */
  register(peerId: PeerId, input: RegisterInput, rand: () => number = Math.random): string {
    this.unregister(peerId);
    const code = this.allocateCode(rand);
    const entry: RoomEntry = {
      roomId: peerId,
      code,
      roomName: input.roomName,
      hostName: input.hostName,
      isPrivate: input.isPrivate,
      maxClients: input.maxClients,
      clients: 1,
      phase: "lobby",
      locked: false,
    };
    this.byId.set(peerId, entry);
    this.byCode.set(code, peerId);
    return code;
  }

  /** Apply a host's update to its own room. No-op for an unknown peer. */
  update(peerId: PeerId, patch: RoomUpdate): void {
    const e = this.byId.get(peerId);
    if (!e) return;
    if (patch.phase !== undefined) e.phase = patch.phase;
    if (patch.locked !== undefined) e.locked = patch.locked;
    if (patch.clients !== undefined) e.clients = patch.clients;
    if (patch.roomName !== undefined) e.roomName = patch.roomName;
  }

  /** Forget a host's room (host disconnect or explicit unregister). */
  unregister(peerId: PeerId): void {
    const e = this.byId.get(peerId);
    if (!e) return;
    this.byCode.delete(e.code);
    this.byId.delete(peerId);
  }

  /** True if this peer currently hosts a room. */
  hosts(peerId: PeerId): boolean {
    return this.byId.has(peerId);
  }

  /** The public, joinable rooms — exactly what a stranger in the browser may enter. */
  list(): RoomListing[] {
    const out: RoomListing[] = [];
    for (const e of this.byId.values()) {
      if (e.isPrivate || !isJoinable(e)) continue;
      out.push(this.toListing(e));
    }
    return out;
  }

  /**
   * Resolve a code to a host, including private rooms.
   *
   * The three "no" answers stay distinct because they are three different things
   * for a player to do next. "Already started" wins over "full" for a locked,
   * running room: saying "full" there would send the player back to wait for a
   * seat that is never coming.
   */
  resolveCode(rawCode: string): CodeLookup {
    const code = rawCode.trim().toUpperCase();
    const peerId = this.byCode.get(code);
    const e = peerId ? this.byId.get(peerId) : undefined;
    if (!e) return { ok: false, status: 404, error: `No room with code ${code}.` };
    if (e.phase === "run") {
      return { ok: false, status: 409, error: "That run has already started — you can only join from the lobby." };
    }
    if (e.locked || e.clients >= e.maxClients) {
      return { ok: false, status: 409, error: "That room is full." };
    }
    return { ok: true, roomId: e.roomId };
  }

  private toListing(e: RoomEntry): RoomListing {
    return {
      roomId: e.roomId,
      clients: e.clients,
      maxClients: e.maxClients,
      metadata: {
        roomName: e.roomName,
        code: e.code,
        hostName: e.hostName,
        phase: e.phase,
      },
    };
  }
}
