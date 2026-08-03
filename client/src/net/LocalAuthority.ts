import { GameRoom } from "@sim/rooms/GameRoom";
import { RoomClient } from "@sim/rooms/LocalRoom";
import { CreateRoomOptions, JoinRoomOptions, DebugConfig } from "shared";
import { RoomLike } from "./RoomLike";

/**
 * Runs the authoritative simulation (GameRoom) IN-PROCESS and hands each local player
 * a room-shaped seat. This is the solo path — and the same class the P2P host will
 * wrap (Phase 5): there, guest seats are backed by a WebRTC transport instead of a
 * direct call, but the host's own seats stay local like these.
 *
 * No serialization: a seat's `state` IS the sim's live Observable GameState; a
 * `send` is a direct `dispatch`; a broadcast is a direct fan-out. Input → simulate →
 * render in one frame, no round-trip.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MsgCb = (payload: any) => void;

class LocalSeat implements RoomLike {
  readonly roomId = "local";
  private readonly listeners = new Map<string, Set<MsgCb>>();
  /** The RoomClient the sim sees for this seat; directed sends land in our listeners. */
  readonly client: RoomClient;

  constructor(
    readonly sessionId: string,
    private readonly authority: LocalAuthority,
  ) {
    this.client = {
      sessionId,
      send: (type, payload) => this.deliver(type, payload),
    };
  }

  get state(): unknown {
    return this.authority.roomState;
  }

  send(type: string, payload?: unknown): void {
    this.authority.dispatch(this.client, type, payload);
  }

  onMessage(type: string, cb: MsgCb): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(cb);
  }

  onStateChange(cb: () => void): void {
    this.authority.onStateChange(cb);
  }

  onLeave(_cb: () => void): void {
    // A local authority never disconnects — nothing to fire.
  }

  /** Sim → this client: a broadcast fan-out or a directed client.send. */
  deliver(type: string, payload: unknown): void {
    this.listeners.get(type)?.forEach((cb) => cb(payload));
  }

  leave(): void {
    this.authority.removeSeat(this);
  }
}

export class LocalAuthority {
  private readonly room = new GameRoom();
  private readonly seats: LocalSeat[] = [];
  private seatCounter = 0;
  private readonly ready: Promise<unknown>;
  private readonly stateChangeCbs = new Set<() => void>();

  constructor(options: { roomName: string; isPrivate: boolean; debug: DebugConfig | null }) {
    this.room.onBroadcast((type, payload) => {
      for (const seat of this.seats) seat.deliver(type, payload);
    });
    const createOpts: CreateRoomOptions & { debug?: DebugConfig } = {
      roomName: options.roomName,
      isPrivate: options.isPrivate,
      ...(options.debug ? { debug: options.debug } : {}),
    };
    this.ready = this.room.onCreate(createOpts);
  }

  get roomState(): unknown {
    return this.room.state;
  }

  /** Seat a local player. Resolves once the sim has processed the join. */
  async addSeat(joinOptions: JoinRoomOptions): Promise<RoomLike> {
    await this.ready;
    const seat = new LocalSeat(`local${this.seatCounter++}`, this);
    this.seats.push(seat);
    this.room.onJoin(seat.client, joinOptions);
    this.fireStateChange();
    return seat;
  }

  /** A seat's command into the sim. Fire onStateChange after, since in the lobby all
   *  state changes arrive this way (the tick is idle until the run starts). */
  dispatch(client: RoomClient, type: string, message: unknown): void {
    this.room.dispatch(client, type, message);
    this.fireStateChange();
  }

  onStateChange(cb: () => void): void {
    this.stateChangeCbs.add(cb);
  }

  removeSeat(seat: LocalSeat): void {
    const i = this.seats.indexOf(seat);
    if (i >= 0) this.seats.splice(i, 1);
    this.room.onLeave(seat.client);
    this.fireStateChange();
    if (this.seats.length === 0) this.room.onDispose();
  }

  private fireStateChange(): void {
    // Defer to a macrotask. Colyseus delivered state changes asynchronously (off a
    // network message); a state-change handler that starts a Phaser scene
    // (LobbyScene → GameScene on the run flip) must NOT run synchronously inside the
    // sim's dispatch call stack, or it re-enters Phaser's SceneManager mid-op and
    // wedges the transition. This restores the async delivery the handlers expect.
    const cbs = [...this.stateChangeCbs];
    setTimeout(() => cbs.forEach((cb) => cb()), 0);
  }
}
