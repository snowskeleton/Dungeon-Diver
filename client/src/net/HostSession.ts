import {
  Observable,
  encodeDelta,
  encodeSnapshot,
  SERVER_TICK_MS,
  GuestChannelMsg,
  HostChannelMsg,
  MapDelta,
  Encoded,
  JoinRoomOptions,
} from "shared";
import { RoomClient } from "@engine/rooms/LocalRoom";
import { LocalAuthority } from "./LocalAuthority";
import { Transport } from "./Transport";

/**
 * The host half of P2P. The host runs the authoritative sim in-process (its own
 * players are zero-latency LocalAuthority seats); this bridges every GUEST onto that
 * same GameRoom over a Transport, so one browser's world is shared by everyone.
 *
 * Per guest it: seats a RemoteClient (whose directed `send` goes out over the guest's
 * transport), turns the guest's `cmd` messages into GameRoom dispatches, and streams
 * state down — a full `snapshot` the instant it joins, then a per-tick `delta` from the
 * shared pump. Sim broadcasts (`hits`, `floor_change`, …) fan out to every guest too.
 *
 * It is transport-source-agnostic: `acceptGuest(transport)` is called by the WebRTC
 * signaling glue in the browser and directly by a loopback pipe in the headless tests,
 * so the whole host path is verifiable with no browser.
 */
export class HostSession {
  private readonly guests = new Map<Transport, RoomClient>();
  private seatCounter = 0;
  private pump: ReturnType<typeof setInterval> | null = null;
  private readonly unsubBroadcast: () => void;
  private disposed = false;

  constructor(private readonly authority: LocalAuthority) {
    // Every sim broadcast reaches every connected guest verbatim.
    this.unsubBroadcast = authority.onBroadcast((type, payload) => {
      this.relayToAll({ k: "msg", type, payload });
    });
  }

  /** Take on a newly-connected guest. Wires its transport; the seat itself is created
   *  when the guest sends its `join`. */
  acceptGuest(transport: Transport): void {
    if (this.disposed) {
      transport.close();
      return;
    }
    transport.onMessage((raw) => this.onGuestMessage(transport, raw));
    transport.onClose(() => this.dropGuest(transport));
  }

  private onGuestMessage(transport: Transport, raw: string): void {
    let msg: GuestChannelMsg;
    try {
      msg = JSON.parse(raw) as GuestChannelMsg;
    } catch {
      return; // a malformed frame is dropped, not fatal
    }
    switch (msg.k) {
      case "join":
        void this.onJoin(transport, msg.options);
        break;
      case "cmd": {
        const client = this.guests.get(transport);
        if (client) this.authority.dispatch(client, msg.type, msg.payload);
        break;
      }
      case "leave":
        this.dropGuest(transport);
        break;
    }
  }

  private async onJoin(transport: Transport, options: JoinRoomOptions): Promise<void> {
    if (this.guests.has(transport)) return; // a duplicate join is a no-op
    const sessionId = `guest${this.seatCounter++}`;
    const client: RoomClient = {
      sessionId,
      send: (type, payload) => this.sendTo(transport, { k: "msg", type, payload }),
    };
    this.guests.set(transport, client);
    await this.authority.addRemoteClient(client, options);
    if (this.disposed || !this.guests.has(transport)) return; // left mid-join
    // Session id first (so the guest knows its own player key), then the full state.
    this.sendTo(transport, { k: "welcome", sessionId });
    this.sendTo(transport, { k: "snapshot", data: encodeSnapshot(this.root) });
    this.ensurePump();
  }

  private dropGuest(transport: Transport): void {
    const client = this.guests.get(transport);
    if (!client) return;
    this.guests.delete(transport);
    this.authority.removeRemoteClient(client);
    if (this.guests.size === 0) this.stopPump();
  }

  /** The per-tick state pump. Drains the authoritative state's change delta once and
   *  broadcasts it — so exactly ONE encodeDelta call owns the dirty state. */
  private ensurePump(): void {
    if (this.pump || this.disposed) return;
    this.pump = setInterval(() => this.flush(), SERVER_TICK_MS);
  }

  private stopPump(): void {
    if (this.pump) {
      clearInterval(this.pump);
      this.pump = null;
    }
  }

  private flush(): void {
    if (this.guests.size === 0) return;
    const delta = encodeDelta(this.root);
    if (deltaIsEmpty(delta)) return; // nothing moved this tick — save the frame
    this.relayToAll({ k: "delta", data: delta });
  }

  private relayToAll(msg: HostChannelMsg): void {
    const frame = JSON.stringify(msg);
    for (const t of this.guests.keys()) t.send(frame);
  }

  private sendTo(transport: Transport, msg: HostChannelMsg): void {
    transport.send(JSON.stringify(msg));
  }

  private get root(): Observable {
    return this.authority.roomState as Observable;
  }

  dispose(): void {
    this.disposed = true;
    this.stopPump();
    this.unsubBroadcast();
    for (const t of this.guests.keys()) t.close();
    this.guests.clear();
  }
}

/** A root delta with no scalar changes and every map delta empty carries nothing —
 *  the map fields are always present (encodeRow emits them each call), so emptiness is
 *  "no non-map field AND no map has any add/change/remove". */
function deltaIsEmpty(enc: Encoded): boolean {
  for (const v of Object.values(enc)) {
    if (v && typeof v === "object" && "added" in (v as object)) {
      const m = v as MapDelta;
      if (
        Object.keys(m.added).length > 0 ||
        Object.keys(m.changed).length > 0 ||
        m.removed.length > 0
      ) {
        return false;
      }
    } else {
      return false; // a scalar (or other) field is present → a real change
    }
  }
  return true;
}
