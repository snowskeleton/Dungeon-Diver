import { describe, it, expect } from "vitest";
import { Observable, tracked, ObservableMap, encodeDelta, applyDelta, MapSchema } from "shared";

// The P2P replication codec: the host encodes its authoritative state's delta, the
// guest applies it to its OWN copy of the same classes and its ObservableMap /
// Observable fire the same onAdd/onChange the client renders off. These tests pin the
// round-trip: same data on the guest, AND the callbacks fire.

class Row extends Observable {
  @tracked("number") x = 0;
  @tracked("number") y = 0;
  @tracked("string") name = "";
}

class Root extends Observable {
  @tracked("number") gold = 0;
  @tracked() players = new ObservableMap<Row>();
}

const SCHEMA: MapSchema = { players: Row };

// A JSON round-trip models the wire (WebRTC data channel carries plain data).
const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("observable replication codec", () => {
  it("replicates an added row and a scalar to a fresh guest, firing onAdd", () => {
    const host = new Root();
    host.gold = 5;
    const a = new Row();
    a.x = 1; a.y = 2; a.name = "goo";
    host.players.set("a", a);

    const delta = wire(encodeDelta(host, SCHEMA));

    const guest = new Root();
    const added: string[] = [];
    guest.players.onAdd((_row, key) => added.push(key));
    applyDelta(guest, SCHEMA, delta);

    expect(guest.gold).toBe(5);
    expect(added).toEqual(["a"]);
    const ga = guest.players.get("a")!;
    expect({ x: ga.x, y: ga.y, name: ga.name }).toEqual({ x: 1, y: 2, name: "goo" });
  });

  it("sends only changed fields on a subsequent delta, firing the row's onChange", () => {
    const host = new Root();
    host.players.set("a", Object.assign(new Row(), { x: 1, y: 2, name: "goo" }));
    const guest = new Root();
    applyDelta(guest, SCHEMA, wire(encodeDelta(host, SCHEMA))); // initial sync

    let changes = 0;
    guest.players.get("a")!.onChange(() => changes++);

    // Mutate only x on the host.
    host.players.get("a")!.x = 10;
    host.gold = 9;
    const delta = encodeDelta(host, SCHEMA);

    // The row delta carries x (and NOT y/name); the scalar carries gold.
    expect(delta.maps.players.changed.a).toEqual({ x: 10 });
    expect(delta.scalars).toEqual({ gold: 9 });

    applyDelta(guest, SCHEMA, wire(delta));
    expect(changes).toBeGreaterThan(0);
    const ga = guest.players.get("a")!;
    expect(ga.x).toBe(10);
    expect(ga.y).toBe(2); // untouched
    expect(guest.gold).toBe(9);
  });

  it("replicates a removal, firing onRemove", () => {
    const host = new Root();
    host.players.set("a", new Row());
    const guest = new Root();
    applyDelta(guest, SCHEMA, wire(encodeDelta(host, SCHEMA)));

    const removed: string[] = [];
    guest.players.onRemove((_row, key) => removed.push(key));

    host.players.delete("a");
    applyDelta(guest, SCHEMA, wire(encodeDelta(host, SCHEMA)));

    expect(removed).toEqual(["a"]);
    expect(guest.players.size).toBe(0);
  });

  it("an unchanged tick encodes an empty delta", () => {
    const host = new Root();
    host.players.set("a", new Row());
    encodeDelta(host, SCHEMA); // drain the initial state
    const delta = encodeDelta(host, SCHEMA);
    expect(delta.scalars).toEqual({});
    expect(delta.maps.players).toEqual({ added: {}, changed: {}, removed: [] });
  });
});
