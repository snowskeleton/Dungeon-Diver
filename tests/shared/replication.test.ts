import { describe, it, expect } from "vitest";
import {
  Observable,
  tracked,
  ObservableMap,
  ObservableList,
  encodeDelta,
  encodeSnapshot,
  applyDelta,
} from "shared";

// The P2P replication codec: the host encodes its authoritative state's delta, the
// guest applies it to its OWN copy of the same classes and its ObservableMap /
// Observable / ObservableList fire the same onAdd/onChange the client renders off.
// These tests pin the round-trip: same data on the guest, AND the callbacks fire.
//
// The schema is NOT hand-passed — the codec derives it from the `@tracked(...)`
// argument on each field (`{ map: Row }`, `[Item]`, `["string"]`, `Item`).

class Item extends Observable {
  @tracked("string") label = "";
  @tracked("number") power = 0;
}

class Row extends Observable {
  @tracked("number") x = 0;
  @tracked("number") y = 0;
  @tracked("string") name = "";
  @tracked([Item]) items = new ObservableList<Item>();
  @tracked(["string"]) tags = new ObservableList<string>();
  @tracked(Item) badge = new Item();
}

class Root extends Observable {
  @tracked("number") gold = 0;
  @tracked({ map: Row }) players = new ObservableMap<Row>();
}

// A JSON round-trip models the wire (WebRTC data channel carries plain data).
const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("observable replication codec", () => {
  it("replicates an added row and a scalar to a fresh guest, firing onAdd", () => {
    const host = new Root();
    host.gold = 5;
    const a = new Row();
    a.x = 1;
    a.y = 2;
    a.name = "goo";
    host.players.set("a", a);

    const delta = wire(encodeDelta(host));

    const guest = new Root();
    const added: string[] = [];
    guest.players.onAdd((_row, key) => added.push(key));
    applyDelta(guest, delta);

    expect(guest.gold).toBe(5);
    expect(added).toEqual(["a"]);
    const ga = guest.players.get("a")!;
    expect({ x: ga.x, y: ga.y, name: ga.name }).toEqual({ x: 1, y: 2, name: "goo" });
  });

  it("sends only changed fields on a subsequent delta, firing the row's onChange", () => {
    const host = new Root();
    host.players.set("a", Object.assign(new Row(), { x: 1, y: 2, name: "goo" }));
    const guest = new Root();
    applyDelta(guest, wire(encodeDelta(host))); // initial sync

    let changes = 0;
    guest.players.get("a")!.onChange(() => changes++);

    // Mutate only x on the host.
    host.players.get("a")!.x = 10;
    host.gold = 9;
    const delta = encodeDelta(host);

    // The row delta carries x (and NOT y/name); the scalar rides at the root.
    expect((delta.players as { changed: Record<string, unknown> }).changed.a).toEqual({ x: 10 });
    expect(delta.gold).toEqual(9);

    applyDelta(guest, wire(delta));
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
    applyDelta(guest, wire(encodeDelta(host)));

    const removed: string[] = [];
    guest.players.onRemove((_row, key) => removed.push(key));

    host.players.delete("a");
    applyDelta(guest, wire(encodeDelta(host)));

    expect(removed).toEqual(["a"]);
    expect(guest.players.size).toBe(0);
  });

  it("an unchanged tick encodes an empty delta", () => {
    const host = new Root();
    host.players.set("a", new Row());
    encodeDelta(host); // drain the initial state
    const delta = encodeDelta(host);
    expect(delta.gold).toBeUndefined();
    expect(delta.players).toEqual({ added: {}, changed: {}, removed: [] });
  });

  it("replicates nested row-lists, scalar-lists and a nested row", () => {
    const host = new Root();
    const a = new Row();
    a.items.push(Object.assign(new Item(), { label: "sword", power: 3 }));
    a.tags.push("cold");
    a.badge.label = "gold";
    a.badge.power = 7;
    host.players.set("a", a);

    const guest = new Root();
    applyDelta(guest, wire(encodeDelta(host)));

    const ga = guest.players.get("a")!;
    expect(ga.items.length).toBe(1);
    expect({ label: ga.items[0].label, power: ga.items[0].power }).toEqual({
      label: "sword",
      power: 3,
    });
    expect([...ga.tags]).toEqual(["cold"]);
    expect({ label: ga.badge.label, power: ga.badge.power }).toEqual({ label: "gold", power: 7 });

    // A later mutation to a nested row inside a list re-syncs (whole-list re-encode),
    // and a scalar-list push grows on the guest.
    host.players.get("a")!.items[0].power = 99;
    host.players.get("a")!.tags.push("sharp");
    applyDelta(guest, wire(encodeDelta(host)));
    expect(guest.players.get("a")!.items[0].power).toBe(99);
    expect([...guest.players.get("a")!.tags]).toEqual(["cold", "sharp"]);
  });

  it("a snapshot sends full state without draining the delta stream", () => {
    const host = new Root();
    host.gold = 3;
    host.players.set("a", Object.assign(new Row(), { x: 1 }));

    // Take a snapshot for a late guest — must NOT consume the host's pending dirty
    // state, so the next encodeDelta still carries the initial 'a' for other guests.
    const snap = wire(encodeSnapshot(host));
    const lateGuest = new Root();
    applyDelta(lateGuest, snap);
    expect(lateGuest.gold).toBe(3);
    expect(lateGuest.players.get("a")!.x).toBe(1);

    const earlyGuest = new Root();
    applyDelta(earlyGuest, wire(encodeDelta(host)));
    expect(earlyGuest.players.get("a")!.x).toBe(1); // delta stream intact
  });
});
