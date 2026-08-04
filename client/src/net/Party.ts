import {
  DebugConfig, GameStateView, RoomListing, MAX_CLIENTS,
} from "shared";
import { Loadout } from "../launch";
import { RoomLike } from "./RoomLike";
import { LocalAuthority } from "./LocalAuthority";
import { signaling } from "./Signaling";

/**
 * The set of connections one machine holds to one room — the party, as the
 * network sees it.
 *
 * Same-screen co-op is still one room seat per player, so "the party" was
 * previously an implementation detail buried in LocalPlayerManager, which both
 * opened the seats and built Phaser sprites. That worked while the only way into a
 * game was GameScene joining on load. It stopped working the moment a lobby
 * existed: the seats are taken in the LOBBY, minutes before any sprite exists, and
 * must survive the scene change into the run.
 *
 * So this owns the connection half and nothing else — no Phaser, no scene. The
 * lobby builds one and hands it to GameScene, which renders the members it
 * finds rather than joining anything itself. A seat is a RoomLike: an in-process
 * LocalAuthority seat today, a WebRTC-backed RemoteAuthority once P2P lands.
 */

export interface PartyMember {
  room: RoomLike;
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

/** Thrown for every failed join so callers can show one message. This is
 *  player-shaped ("that room is full"), not protocol-shaped. */
export class JoinError extends Error {}

/** The online path (join/list a room hosted by another machine) is host-authoritative
 *  P2P over WebRTC, being built in stages after the Colyseus→single-client migration.
 *  Until the signaling server + transport land, every online entry point routes here so
 *  the lobby shows one honest message instead of dialling a server that no longer exists.
 *  Solo and same-screen couch play (the LocalAuthority path) are unaffected. */
const ONLINE_COMING_SOON = "Online multiplayer is coming soon — solo and same-screen co-op work now.";
function onlineComingSoon(): never {
  throw new JoinError(ONLINE_COMING_SOON);
}

/** Public, joinable rooms hosted by other machines, from the signaling registry. The
 *  browser calls this before a party exists, so it stays free-standing. Rooms only
 *  appear once a host announces one (the host/guest WebRTC path lands in M3–M4); until
 *  then this returns whatever is registered, which for now is nothing joinable. */
export async function listRooms(): Promise<RoomListing[]> {
  try {
    return await signaling.list();
  } catch {
    // The signaling server being unreachable is a normal "no rooms" for the browser,
    // not an error to surface — offline play still works.
    return [];
  }
}

export class Party {
  private readonly membersList: PartyMember[] = [];
  private joinedRoomId: string | null = null;
  /** Non-null only on the machine that created the room — the debug knobs the
   *  floor was generated with. Joiners read the same knobs off the schema. */
  debug: DebugConfig | null = null;
  /** The in-process authority for a solo/local game — null on an online (P2P guest)
   *  join. Held so couch players seat onto the same running sim. */
  private local: LocalAuthority | null = null;
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
  get primary(): RoomLike {
    return this.membersList[0].room;
  }

  get state(): GameStateView {
    // The one boundary cast on this side: RoomLike types state as unknown (a guest
    // decodes it; the host holds the live Observable). From here down it's the view.
    return this.primary.state as unknown as GameStateView;
  }

  get isHost(): boolean {
    return this.membersList.length > 0 && this.state.hostSessionId === this.primary.sessionId;
  }

  get isFull(): boolean {
    return this.membersList.length >= MAX_CLIENTS;
  }

  // ── Getting in ────────────────────────────────────────────────────────────

  /** Create a room and take the first seat in it. The authoritative sim now runs
   *  IN THIS PROCESS (no server) — the responsiveness win. Online multiplayer moves
   *  to host-authoritative P2P (Phase 5); until then every host is local. */
  async host(options: HostOptions): Promise<void> {
    this.debug = options.debug;
    this.local = new LocalAuthority({
      roomName: options.roomName,
      isPrivate: options.isPrivate,
      debug: options.debug,
    });
    const room = await this.local.addSeat(this.joinOptions(this.pendingLoadout, false));
    this.adopt(room, this.pendingLoadout, false);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async joinById(_roomId: string): Promise<void> {
    onlineComingSoon();
  }

  /** Resolve a 4-character code to a room and join it — an online path, so stubbed
   *  until the P2P registry + transport land (see onlineComingSoon). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async joinByCode(_code: string): Promise<void> {
    onlineComingSoon();
  }

  /** Add a couch player (the `P` key in the lobby) to the room we're already in. */
  async addCouch(loadout: Loadout): Promise<PartyMember | null> {
    if (this.isFull) return null;
    // Local (solo/couch): another seat on the same in-process sim.
    if (this.local) {
      const room = await this.local.addSeat(this.joinOptions(loadout, true));
      return this.adopt(room, loadout, true);
    }
    // Online: a couch player would join the same remote room again — stubbed until
    // the P2P path lands. Reachable only from an online room, which can't be entered yet.
    return null;
  }

  /** The `couch` flag rides along so the server can mark these players ready on
   *  arrival — they share a screen with whoever added them. */
  private joinOptions(loadout: Loadout, couch: boolean) {
    return {
      playerName: couch ? `${this.playerName} (P${this.membersList.length + 1})` : this.playerName,
      characterClass: loadout.characterClass,
      characterType: loadout.characterType,
      couch,
    };
  }

  private adopt(room: RoomLike, loadout: Loadout, couch: boolean): PartyMember {
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
