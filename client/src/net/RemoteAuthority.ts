import { applyDelta, HostChannelMsg, JoinRoomOptions } from "shared";
import { GameState } from "@engine/schema/GameState";
import { RoomLike } from "./RoomLike";
import { Transport } from "./Transport";

/**
 * The guest half of P2P: a RoomLike backed by a Transport to the host, so GameScene /
 * LobbyScene / LocalPlayer read the SAME interface a local seat exposes and never learn
 * a socket is involved (RoomLike's whole point).
 *
 * The guest never simulates. It holds its own GameState and rebuilds it from what the
 * host sends: a `snapshot` populates it on join, then each `delta` mutates it — and
 * because it's the real GameState class, those mutations fire the exact onAdd/onChange/
 * onRemove the client renders off, identical to solo. Commands go the other way as
 * `cmd` frames the host dispatches into its authoritative room.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MsgCb = (payload: any) => void;

export class RemoteAuthority implements RoomLike {
  private readonly gameState = new GameState();
  private _sessionId = "";
  private readonly listeners = new Map<string, Set<MsgCb>>();
  private readonly stateChangeCbs = new Set<() => void>();
  private readonly leaveCbs = new Set<() => void>();
  private connectResolve: (() => void) | null = null;
  private connectReject: ((err: Error) => void) | null = null;

  constructor(
    private readonly transport: Transport,
    readonly roomId: string,
  ) {
    transport.onMessage((raw) => this.onHostMessage(raw));
    transport.onClose(() => {
      // A drop before the snapshot arrived fails the connect; after, it's a mid-run
      // disconnect the lobby/scene handles via onLeave.
      this.connectReject?.(new Error("Lost the connection to the host."));
      this.connectReject = null;
      this.connectResolve = null;
      this.leaveCbs.forEach((cb) => cb());
    });
  }

  /** Request a seat and resolve once the host's welcome + snapshot have populated the
   *  state — so callers (Party.joinById) hand a READY room to the lobby. */
  connect(options: JoinRoomOptions): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      this.transport.send(JSON.stringify({ k: "join", options }));
    });
  }

  get state(): unknown {
    return this.gameState;
  }

  get sessionId(): string {
    return this._sessionId;
  }

  send(type: string, payload?: unknown): void {
    this.transport.send(JSON.stringify({ k: "cmd", type, payload }));
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
    this.stateChangeCbs.add(cb);
  }

  onLeave(cb: () => void): void {
    this.leaveCbs.add(cb);
  }

  leave(): void {
    this.transport.send(JSON.stringify({ k: "leave" }));
    this.transport.close();
  }

  private onHostMessage(raw: string): void {
    let msg: HostChannelMsg;
    try {
      msg = JSON.parse(raw) as HostChannelMsg;
    } catch {
      return;
    }
    switch (msg.k) {
      case "welcome":
        this._sessionId = msg.sessionId;
        break;
      case "snapshot":
        applyDelta(this.gameState, msg.data);
        this.connectResolve?.();
        this.connectResolve = null;
        this.connectReject = null;
        this.fireStateChange();
        break;
      case "delta":
        applyDelta(this.gameState, msg.data);
        this.fireStateChange();
        break;
      case "msg":
        this.listeners.get(msg.type)?.forEach((cb) => cb(msg.payload));
        break;
    }
  }

  private fireStateChange(): void {
    this.stateChangeCbs.forEach((cb) => cb());
  }
}
