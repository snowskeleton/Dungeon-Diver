/**
 * The transport-agnostic base the game room runs on — the replacement for Colyseus
 * `Room`. It provides the small surface GameRoom actually used (state, broadcast,
 * onMessage, lock/setPrivate/setMetadata/setPatchRate, a clients list) with NO network
 * attached. The same class is driven three ways:
 *
 *   - the test harness, which pumps onCreate/onJoin/tick directly;
 *   - the in-process LocalAuthority (Phase 4), for solo — the client subscribes to
 *     broadcasts and dispatches its input straight in, zero serialization;
 *   - the P2P host (Phase 5), which serialises broadcasts + state deltas to guests.
 *
 * Everything transport-specific lives in the Authority that wraps this, not here.
 */
export interface RoomClient {
  sessionId: string;
  /** Deliver a directed message to this client (Colyseus `client.send`). */
  send(type: string, payload?: unknown): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MessageHandler = (client: RoomClient, message: any) => void;
type BroadcastListener = (type: string, payload: unknown) => void;

export abstract class LocalRoom<State> {
  state!: State;
  maxClients = 0;
  readonly clients: RoomClient[] = [];

  private readonly handlers = new Map<string, MessageHandler>();
  private readonly broadcastListeners = new Set<BroadcastListener>();

  setState(s: State): void {
    this.state = s;
  }

  /** No transport here — the wrapping Authority owns snapshot cadence. Kept so the
   *  room can express its intended patch rate. */
  setPatchRate(_ms: number): void {
    /* no-op */
  }

  async setPrivate(_v: boolean): Promise<void> {
    /* lobby visibility is the Authority/session layer's concern */
  }

  async setMetadata(_m: unknown): Promise<void> {
    /* matchmaking metadata is the session layer's concern */
  }

  async lock(): Promise<void> {
    /* "no dropping into a run" is enforced by the session layer */
  }

  async unlock(): Promise<void> {
    /* no-op */
  }

  onMessage(type: string, fn: MessageHandler): void {
    this.handlers.set(type, fn);
  }

  /** Deliver a client message to its registered handler. The Authority calls this
   *  when a (local or remote) client sends. Unknown types are ignored, as Colyseus
   *  did for unregistered messages. */
  dispatch(client: RoomClient, type: string, message: unknown): void {
    this.handlers.get(type)?.(client, message);
  }

  broadcast(type: string, payload?: unknown): void {
    this.broadcastListeners.forEach((l) => l(type, payload));
  }

  /** The Authority subscribes here to relay broadcasts out to clients. */
  onBroadcast(l: BroadcastListener): () => void {
    this.broadcastListeners.add(l);
    return () => {
      this.broadcastListeners.delete(l);
    };
  }
}
