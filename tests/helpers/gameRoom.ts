// Drives a REAL GameRoom with only Colyseus's transport surface stubbed.
//
// GameRoom is where every system in the game is wired together — tick ordering,
// the lobby phase, floor advancement, the message handlers — and none of that is
// exercised by testing the pieces separately. What it actually needs from
// Colyseus is small (setState, lock/metadata, broadcast, onMessage, a client's
// sessionId), so those are stubbed and everything else is the shipping code.

import { vi } from "vitest";
import { matchMaker } from "colyseus";
import { CreateRoomOptions, JoinRoomOptions, DebugConfig } from "shared";
import { GameRoom } from "../../server/src/rooms/GameRoom";
import { GameState } from "../../server/src/schema/GameState";

export interface Broadcast {
  type: string;
  payload: unknown;
}

export interface FakeClient {
  sessionId: string;
  /** Messages the server sent to this client specifically. */
  sent: Broadcast[];
  send(type: string, payload?: unknown): void;
}

export interface RoomHarness {
  room: GameRoom;
  state: GameState;
  /** True once the room has locked itself — D12's "no dropping into a run". */
  isLocked(): boolean;
  /** The metadata last published to the matchmaker listing. */
  metadata(): unknown;
  broadcasts: Broadcast[];
  /** Join a client and return its handle. */
  join(sessionId: string, options?: JoinRoomOptions): FakeClient;
  leave(client: FakeClient): void;
  /** Deliver a client message, as Colyseus would. */
  send(client: FakeClient, type: string, payload?: unknown): void;
  /** Run the room's tick N times. */
  tick(n?: number): void;
  /** Broadcasts of one type, in order. */
  of(type: string): unknown[];
  clearBroadcasts(): void;
  dispose(): void;
}

// Room-code allocation scans the matchmaker's own listing, and a unit test has
// no matchmaker running. Booting its in-process LocalDriver gives a real, empty
// listing — no codes taken, so allocation succeeds on its first draw — without
// stubbing the lookup itself.
let matchMakerReady: Promise<unknown> | null = null;
function ensureMatchMaker() {
  matchMakerReady ??= matchMaker.setup(undefined, undefined);
  return matchMakerReady;
}

export async function createRoom(
  options: (CreateRoomOptions & { debug?: DebugConfig }) | undefined = undefined,
): Promise<RoomHarness> {
  await ensureMatchMaker();

  const room = new GameRoom();
  const broadcasts: Broadcast[] = [];
  const handlers = new Map<string, (client: FakeClient, msg: unknown) => void>();
  const clients: FakeClient[] = [];

  const patched = room as unknown as {
    state: GameState;
    setState(s: GameState): void;
    setPrivate(v: boolean): Promise<void>;
    setMetadata(m: unknown): Promise<void>;
    lock(): Promise<void>;
    unlock(): Promise<void>;
    broadcast(type: string, payload?: unknown): void;
    onMessage(type: string, fn: (client: FakeClient, msg: unknown) => void): void;
    clients: FakeClient[];
    tick(): void;
  };

  patched.setState = (s: GameState) => { patched.state = s; };
  patched.setPrivate = async (v: boolean) => { void v; };
  // `metadata` and `locked` are getters on Room, so both are tracked here
  // rather than written back onto the instance.
  let metadata: unknown = undefined;
  let locked = false;
  patched.setMetadata = async (m: unknown) => { metadata = m; };
  patched.lock = async () => { locked = true; };
  patched.unlock = async () => { locked = false; };
  patched.broadcast = (type: string, payload?: unknown) => { broadcasts.push({ type, payload }); };
  patched.onMessage = (type, fn) => { handlers.set(type, fn); };
  patched.clients = clients;

  // The room arms a 20 Hz setInterval in onCreate; tests drive the tick by hand.
  const timers = vi.spyOn(globalThis, "setInterval").mockReturnValue(0 as never);
  await room.onCreate(options);
  timers.mockRestore();

  return {
    room,
    get state() { return patched.state; },
    broadcasts,
    isLocked: () => locked,
    metadata: () => metadata,

    join(sessionId, joinOptions) {
      const client: FakeClient = {
        sessionId,
        sent: [],
        send(type, payload) { this.sent.push({ type, payload }); },
      };
      clients.push(client);
      room.onJoin(client as never, joinOptions);
      return client;
    },

    leave(client) {
      const i = clients.indexOf(client);
      if (i >= 0) clients.splice(i, 1);
      room.onLeave(client as never);
    },

    send(client, type, payload) {
      const handler = handlers.get(type);
      if (!handler) throw new Error(`no handler registered for "${type}"`);
      handler(client, payload);
    },

    tick(n = 1) {
      for (let i = 0; i < n; i++) patched.tick();
    },

    of(type) {
      return broadcasts.filter(b => b.type === type).map(b => b.payload);
    },

    clearBroadcasts() {
      broadcasts.length = 0;
    },

    dispose() {
      room.onDispose();
    },
  } as RoomHarness;
}

/** Start a run: join `count` clients, ready them, and have the host start. */
export async function startedRoom(
  count = 1,
  options?: CreateRoomOptions & { debug?: DebugConfig },
): Promise<RoomHarness & { clients: FakeClient[] }> {
  const h = await createRoom(options);
  const clients: FakeClient[] = [];
  for (let i = 0; i < count; i++) clients.push(h.join(`s${i}`));
  for (const c of clients.slice(1)) h.send(c, "setReady", { ready: true });
  h.send(clients[0], "startRun", {});
  return Object.assign(h, { clients });
}
