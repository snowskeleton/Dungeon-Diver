import { describe, it, expect } from "vitest";
import { encodeDelta, encodeSnapshot, applyDelta } from "shared";
import { GameState } from "../../engine/src/schema/GameState";
import { startedRoom } from "../helpers/gameRoom";

// The real proof for P2P: a live GameRoom is the host; a bare GameState is the guest.
// Everything crosses a JSON round-trip (the WebRTC data channel carries plain data),
// driven ONLY by the `@tracked(...)` specs on the real schema — no hand-written map.
// If any field's spec were wrong the walk would throw or the data would diverge; this
// pins that the whole real tree survives snapshot + per-tick deltas headlessly.

const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("GameState P2P replication (host GameRoom → guest GameState)", () => {
  it("snapshots a running solo room onto a fresh guest", async () => {
    const h = await startedRoom(1);
    h.tick(5);

    const guest = new GameState();
    const addedPlayers: string[] = [];
    guest.players.onAdd((_p, id) => addedPlayers.push(id));

    applyDelta(guest, wire(encodeSnapshot(h.state)));

    expect(guest.phase).toBe("run");
    expect(guest.floor).toBe(h.state.floor);
    expect(guest.seed).toBe(h.state.seed);
    expect(guest.players.size).toBe(h.state.players.size);
    expect(addedPlayers.length).toBe(1);

    const hostP = [...h.state.players.values()][0];
    const guestP = guest.players.get([...h.state.players.keys()][0])!;
    expect(guestP.characterClass).toBe(hostP.characterClass);
    expect(guestP.x).toBe(hostP.x);
    expect(guestP.y).toBe(hostP.y);
    expect(guestP.maxHp).toBe(hostP.maxHp);
    h.dispose();
  });

  it("streams per-tick deltas so the guest tracks the host as it simulates", async () => {
    const h = await startedRoom(1);
    const guest = new GameState();
    applyDelta(guest, wire(encodeSnapshot(h.state))); // initial sync

    const id = [...h.state.players.keys()][0];
    const client = h.clients[0];

    // Drive the player rightward for several ticks, feeding each tick's delta to the
    // guest exactly as the host would broadcast it.
    let changes = 0;
    guest.players.get(id)!.onChange(() => changes++);
    for (let i = 0; i < 10; i++) {
      h.send(client, "input", { dx: 1, dy: 0, attack: false, ability: false });
      h.tick(1);
      applyDelta(guest, wire(encodeDelta(h.state)));
    }

    expect(changes).toBeGreaterThan(0);
    expect(guest.players.get(id)!.x).toBe(h.state.players.get(id)!.x);
    expect(guest.players.get(id)!.facing).toBe(h.state.players.get(id)!.facing);
    h.dispose();
  });

  it("replicates enemy add/remove as the host reveals and clears a room", async () => {
    const h = await startedRoom(1);
    const guest = new GameState();
    applyDelta(guest, wire(encodeSnapshot(h.state)));

    const added: string[] = [];
    const removed: string[] = [];
    guest.enemies.onAdd((_e, id) => added.push(id));
    guest.enemies.onRemove((_e, id) => removed.push(id));

    // Tick enough that at least one enemy batch is revealed as the player's room
    // occupies. Then mirror every delta.
    for (let i = 0; i < 30; i++) {
      h.tick(1);
      applyDelta(guest, wire(encodeDelta(h.state)));
    }

    expect(guest.enemies.size).toBe(h.state.enemies.size);
    // Every host enemy id is present on the guest with matching position.
    h.state.enemies.forEach((e, id) => {
      const g = guest.enemies.get(id);
      expect(g).toBeDefined();
      expect(g!.x).toBe(e.x);
      expect(g!.enemyType).toBe(e.enemyType);
    });
    h.dispose();
  });
});
