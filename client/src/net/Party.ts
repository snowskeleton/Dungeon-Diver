import { Client, Room } from "colyseus.js";
import {
  DebugConfig, GameStateView, RoomListing, RoomMetadata,
  ROOM_CODE_LOOKUP_PATH, MAX_CLIENTS,
} from "shared";
import { Loadout } from "../launch";
import { SERVER_URL, SERVER_HTTP_URL } from "./serverUrl";

/**
 * The set of connections one machine holds to one room — the party, as the
 * network sees it.
 *
 * Same-screen co-op is still one Colyseus connection per player, so "the party"
 * was previously an implementation detail buried in LocalPlayerManager, which
 * both dialled the server and built Phaser sprites. That worked while the only
 * way into a game was GameScene doing a joinOrCreate on load. It stopped working
 * the moment a lobby existed: the connections are made in the LOBBY, minutes
 * before any sprite exists, and must survive the scene change into the run.
 *
 * So this owns the socket half and nothing else — no Phaser, no scene. The
 * lobby builds one and hands it to GameScene, which renders the members it
 * finds rather than joining anything itself.
 */

export interface PartyMember {
  room: Room;
  /** What this member joined as. Kept client-side so the lobby can re-open a
   *  picker pre-filled, rather than reverse-engineering it from the schema. */
  loadout: Loadout;
  /** True for players 2–4 on this machine — they follow the host's choices. */
  couch: boolean;
}

export interface HostOptions {
  roomName: string;
  isPrivate: boolean;
  debug: DebugConfig | null;
}

/** Thrown for every failed join so callers can show one message. Colyseus's own
 *  errors are protocol-shaped ("room is locked"); this is player-shaped. */
export class JoinError extends Error {}

/** One Colyseus client for the whole app. It holds an endpoint, not a socket —
 *  each join opens its own — so the browser's polling and a party's four
 *  connections have no reason to disagree about where the server is. */
const client = new Client(SERVER_URL);

/** Public, unlocked rooms. Colyseus filters both for us — a private room is
 *  absent and a started run is locked — so this list is exactly the rooms a
 *  stranger may walk into. Free-standing because the browser lists rooms before
 *  there is a party to list them for. */
export async function listRooms(): Promise<RoomListing[]> {
  const available = await client.getAvailableRooms("game");
  return available
    .filter((room) => room.metadata)
    .map((room) => ({
      roomId: room.roomId,
      clients: room.clients,
      maxClients: room.maxClients,
      metadata: room.metadata as RoomMetadata,
    }));
}

export class Party {
  private readonly membersList: PartyMember[] = [];
  private joinedRoomId: string | null = null;
  /** Non-null only on the machine that created the room — the debug knobs the
   *  floor was generated with. Joiners read the same knobs off the schema. */
  debug: DebugConfig | null = null;
  playerName: string;
  /** The loadout the next join should use: this machine's profile choice, which
   *  `setLoadout` keeps in step as it's changed in the lobby. */
  pendingLoadout: Loadout;

  constructor(playerName: string, loadout: Loadout) {
    this.playerName = playerName;
    this.pendingLoadout = loadout;
  }

  get members(): readonly PartyMember[] {
    return this.membersList;
  }

  /** The connection every non-player-specific read goes through: the first local
   *  player's room is the world observer (it sees all players and enemies). */
  get primary(): Room {
    return this.membersList[0].room;
  }

  get state(): GameStateView {
    // The one boundary cast on this side: colyseus.js types room.state as the
    // untyped decoded state. From here down it's the view the server implements.
    return this.primary.state as unknown as GameStateView;
  }

  get isHost(): boolean {
    return this.membersList.length > 0 && this.state.hostSessionId === this.primary.sessionId;
  }

  get isFull(): boolean {
    return this.membersList.length >= MAX_CLIENTS;
  }

  // ── Getting in ────────────────────────────────────────────────────────────

  /** Create a room and take the first seat in it. */
  async host(options: HostOptions): Promise<void> {
    this.debug = options.debug;
    const room = await client.create("game", {
      roomName: options.roomName,
      isPrivate: options.isPrivate,
      debug: options.debug,
      ...this.joinOptions(this.pendingLoadout, false),
    });
    this.adopt(room, this.pendingLoadout, false);
  }

  async joinById(roomId: string): Promise<void> {
    const room = await this.dial(roomId, this.pendingLoadout, false);
    this.adopt(room, this.pendingLoadout, false);
  }

  /** Resolve a 4-character code to a room id, then join it. Private rooms are
   *  absent from the public listing, so only the server can do the first half. */
  async joinByCode(code: string): Promise<void> {
    const url = `${SERVER_HTTP_URL}${ROOM_CODE_LOOKUP_PATH}/${encodeURIComponent(code.toUpperCase())}`;
    let payload: { roomId?: string; error?: string };
    try {
      payload = await (await fetch(url)).json();
    } catch {
      throw new JoinError("Couldn't reach the server.");
    }
    if (!payload.roomId) throw new JoinError(payload.error ?? "That room isn't available.");
    await this.joinById(payload.roomId);
  }

  /** Add a couch player (the `P` key in the lobby) to the room we're already in. */
  async addCouch(loadout: Loadout): Promise<PartyMember | null> {
    if (this.isFull || !this.joinedRoomId) return null;
    const room = await this.dial(this.joinedRoomId, loadout, true);
    return this.adopt(room, loadout, true);
  }

  /** The `couch` flag rides along so the server can mark these players ready on
   *  arrival — they share a screen with whoever added them. */
  private joinOptions(loadout: Loadout, couch: boolean) {
    return {
      playerName: couch ? `${this.playerName} (P${this.membersList.length + 1})` : this.playerName,
      characterClass: loadout.characterClass,
      characterType: loadout.characterType,
      weaponId: loadout.weaponId,
      couch,
    };
  }

  private async dial(roomId: string, loadout: Loadout, couch: boolean): Promise<Room> {
    try {
      return await client.joinById(roomId, this.joinOptions(loadout, couch));
    } catch (err) {
      // Colyseus reports a started run and a full room the same way (both are
      // "locked"), so say the thing that's true of both rather than guessing.
      const message = err instanceof Error ? err.message : String(err);
      if (/lock/i.test(message)) {
        throw new JoinError("That room is full, or its run has already started.");
      }
      throw new JoinError(message);
    }
  }

  private adopt(room: Room, loadout: Loadout, couch: boolean): PartyMember {
    this.joinedRoomId = room.roomId;
    const member: PartyMember = { room, loadout, couch };
    this.membersList.push(member);
    return member;
  }

  // ── In the lobby ──────────────────────────────────────────────────────────

  setName(name: string) {
    this.playerName = name;
    this.membersList[0]?.room.send("setName", { name });
  }

  setLoadout(index: number, loadout: Loadout) {
    const member = this.membersList[index];
    if (!member) return;
    member.loadout = loadout;
    if (index === 0) this.pendingLoadout = loadout;
    member.room.send("setLoadout", loadout);
  }

  setReady(ready: boolean) {
    this.membersList[0]?.room.send("setReady", { ready });
  }

  startRun() {
    this.membersList[0]?.room.send("startRun");
  }

  // ── Getting out ───────────────────────────────────────────────────────────

  async leaveAll() {
    const rooms = this.membersList.map((m) => m.room);
    this.membersList.length = 0;
    this.joinedRoomId = null;
    await Promise.all(rooms.map((room) => room.leave()));
  }
}
