import { describe, it, expect } from "vitest";
import { GameStateView, PlayerStateView } from "shared";
import { LocalAuthority } from "../../client/src/net/LocalAuthority";
import { HostSession } from "../../client/src/net/HostSession";
import { RemoteAuthority } from "../../client/src/net/RemoteAuthority";
import { loopbackPair } from "../../client/src/net/Transport";

// The whole P2P path, headless: a real host (LocalAuthority running the real GameRoom)
// + HostSession, a real guest RemoteAuthority, joined by an in-memory loopback pipe
// instead of WebRTC. This is exactly the browser path with the one un-headless-able
// piece (RTCDataChannel) swapped for a pipe — so it proves the session logic end to end:
// join → welcome/snapshot → lobby sync → run flip → per-tick state streaming → commands.

/** Wait long enough for a few real sim-tick + delta-pump cycles (both 50ms intervals)
 *  so streamed state reaches the guest. Broadcasts are immediate; only pumped state
 *  needs this. */
const settle = () => new Promise<void>((r) => setTimeout(r, 130));

async function hostWithGuest() {
  const authority = new LocalAuthority({ roomName: "test", isPrivate: false, debug: null });
  const host = new HostSession(authority);
  // The host's own seat (zero-latency, in-process) — the host player.
  const hostSeat = await authority.addSeat({ playerName: "Host", characterClass: "knight" });

  const [guestSide, hostSide] = loopbackPair();
  host.acceptGuest(hostSide);
  const guest = new RemoteAuthority(guestSide, "room1");
  await guest.connect({ playerName: "Guest", characterClass: "rogue" });

  return { authority, host, hostSeat, guest };
}

describe("P2P session (host GameRoom ↔ guest RemoteAuthority over a loopback pipe)", () => {
  it("joins: the guest gets a session id and a populated snapshot", async () => {
    const { guest, host, authority } = await hostWithGuest();
    const gs = guest.state as unknown as GameStateView;

    expect(guest.sessionId).toBe("guest0");
    expect(gs.phase).toBe("lobby");
    // Both players are present on the guest's snapshot: the host + itself.
    expect(gs.players.size).toBe(2);
    expect(gs.players.has(guest.sessionId)).toBe(true);
    const me = gs.players.get(guest.sessionId) as PlayerStateView;
    expect(me.characterClass).toBe("rogue");
    host.dispose();
    authority.addSeat; // keep ref
  });

  it("streams lobby changes, the run flip, and live simulation to the guest", async () => {
    const { guest, hostSeat, host } = await hostWithGuest();
    const gs = guest.state as unknown as GameStateView;

    // A lobby change on the host (the guest readies up) reaches the host's authority via
    // a cmd and comes back down in state.
    guest.send("setReady", { ready: true });
    await settle();
    expect((gs.players.get(guest.sessionId) as PlayerStateView).ready).toBe(true);

    // The host starts the run; the phase flip streams to the guest.
    hostSeat.send("startRun");
    await settle();
    expect(gs.phase).toBe("run");

    // Now drive the guest's player and watch its position track on the guest's own
    // state as the host simulates and pumps deltas.
    const id = guest.sessionId;
    const x0 = (gs.players.get(id) as PlayerStateView).x;
    // The host keeps applying the last input each sim tick, so one send + a few cycles
    // is enough to see sustained movement stream back.
    guest.send("input", { dx: 1, dy: 0, attack: false, ability: false });
    await settle();
    const x1 = (gs.players.get(id) as PlayerStateView).x;
    expect(x1).toBeGreaterThan(x0);
    // The guest's view TRACKS the host's authoritative state. The snapshot pump
    // (NET_SNAPSHOT_MS, 30 Hz) is now decoupled from and slower than the sim (60 Hz),
    // so the guest is deliberately a fraction behind — never ahead of authority, and
    // closely trailing it (the guest interpolates the gap away on screen).
    const hostState = (host as unknown as { authority: { roomState: GameStateView } }).authority
      .roomState;
    const hostX = (hostState.players.get(id) as PlayerStateView).x;
    expect(x1).toBeLessThanOrEqual(hostX + 1e-6); // never ahead of the authority
    expect(hostX - x1).toBeLessThan(60); // trails by well under one snapshot of motion

    // The seq/ack round-trip that drives the guest's prediction reconciliation: stamped
    // inputs flow guest→host, the sim drains one per tick and echoes the processed seq
    // back as lastProcessedInputSeq — the ack the guest's LocalPlayer prunes + replays
    // against. Five sent, more than five ticks of settle, so all are processed.
    for (let s = 1; s <= 5; s++) {
      guest.send("input", { dx: 1, dy: 0, attack: false, ability: false, seq: s });
    }
    await settle();
    await settle();
    expect((gs.players.get(id) as PlayerStateView).lastProcessedInputSeq).toBe(5);
    host.dispose();
  });

  it("relays sim broadcasts to the guest's onMessage", async () => {
    const { guest, hostSeat, host } = await hostWithGuest();
    // startRun fans out barrier broadcasts (empty reward rooms are pre-cleared and
    // their parent barriers unlocked). Any relayed broadcast proves the path.
    const relayed: unknown[] = [];
    guest.onMessage("connections_parent_unlocked", (p) => relayed.push(p));
    guest.onMessage("connections_child_unlocked", (p) => relayed.push(p));
    // Ready the guest (host-side synchronous) so startRun is accepted, then start.
    guest.send("setReady", { ready: true });
    await settle(); // the ready cmd crosses the pipe before the host starts
    hostSeat.send("startRun");
    await settle();
    expect(relayed.length).toBeGreaterThan(0);
    host.dispose();
  });

  it("drops the guest's seat when its transport closes", async () => {
    const { guest, host, authority } = await hostWithGuest();
    const root = authority.roomState as unknown as GameStateView;
    expect(root.players.size).toBe(2);
    guest.leave();
    await settle();
    expect(root.players.size).toBe(1); // only the host remains
    host.dispose();
  });
});
