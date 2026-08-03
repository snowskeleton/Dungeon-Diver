import { describe, it, expect } from "vitest";
import { Observable, tracked, ObservableMap, ObservableList } from "shared";

// The observable primitive replaces @colyseus/schema. These tests pin the callback
// semantics the client renders off — especially the load-bearing "onAdd fires for
// items already present when the callback registers", which GameScene.setupWorldSync
// relies on to handle initial state the same way as later additions.

class Row extends Observable {
  @tracked("number") x = 0;
  @tracked("number") y = 0;
  @tracked("string") name = "";
}

describe("Observable + @tracked", () => {
  it("fires onChange when a tracked field actually changes", () => {
    const r = new Row();
    let fires = 0;
    r.onChange(() => fires++);
    r.x = 5;
    expect(fires).toBe(1);
    r.y = 9;
    expect(fires).toBe(2);
  });

  it("does not fire when a field is set to its current value", () => {
    const r = new Row();
    r.x = 5;
    let fires = 0;
    r.onChange(() => fires++);
    r.x = 5; // no-op
    expect(fires).toBe(0);
  });

  it("reads back the assigned value (the accessor stores it)", () => {
    const r = new Row();
    r.x = 42;
    r.name = "goo";
    expect(r.x).toBe(42);
    expect(r.name).toBe("goo");
  });

  it("records dirty fields for delta encoding, and drains them", () => {
    const r = new Row();
    r.consumeDirty(); // a fresh row is fully dirty (needs a full encode); clear that
    r.x = 1;
    r.name = "a";
    expect(r.isDirty).toBe(true);
    expect([...r.consumeDirty()].sort()).toEqual(["name", "x"]);
    expect(r.isDirty).toBe(false);
    expect([...r.consumeDirty()]).toEqual([]);
  });

  it("supports multiple subscribers and unsubscribe", () => {
    const r = new Row();
    let a = 0;
    let b = 0;
    const off = r.onChange(() => a++);
    r.onChange(() => b++);
    r.x = 1;
    expect([a, b]).toEqual([1, 1]);
    off();
    r.x = 2;
    expect([a, b]).toEqual([1, 2]);
  });

  it("keeps per-field storage per instance (no cross-talk)", () => {
    const a = new Row();
    const b = new Row();
    a.x = 10;
    b.x = 20;
    expect(a.x).toBe(10);
    expect(b.x).toBe(20);
  });
});

describe("ObservableMap", () => {
  it("fires onAdd for items already present when the callback registers", () => {
    const m = new ObservableMap<Row>();
    m.set("a", new Row());
    m.set("b", new Row());
    const seen: string[] = [];
    m.onAdd((_item, key) => seen.push(key));
    expect(seen.sort()).toEqual(["a", "b"]);
  });

  it("fires onAdd for a NEW key but treats set of an existing key as an update", () => {
    const m = new ObservableMap<Row>();
    const seen: string[] = [];
    m.onAdd((_i, k) => seen.push(k));
    const row = new Row();
    m.set("a", row);
    m.set("a", row); // update, not add
    expect(seen).toEqual(["a"]);
  });

  it("fires onRemove on delete and on clear", () => {
    const m = new ObservableMap<Row>();
    m.set("a", new Row());
    m.set("b", new Row());
    const removed: string[] = [];
    m.onRemove((_i, k) => removed.push(k));
    m.delete("a");
    expect(removed).toEqual(["a"]);
    m.clear();
    expect(removed.sort()).toEqual(["a", "b"]);
    expect(m.size).toBe(0);
  });

  it("supports get / has / size / forEach / iteration", () => {
    const m = new ObservableMap<number>();
    m.set("a", 1);
    m.set("b", 2);
    expect(m.get("a")).toBe(1);
    expect(m.has("b")).toBe(true);
    expect(m.size).toBe(2);
    const via: Record<string, number> = {};
    m.forEach((v, k) => { via[k] = v; });
    expect(via).toEqual({ a: 1, b: 2 });
    expect([...m]).toEqual([["a", 1], ["b", 2]]);
  });

  it("tracks the key delta (added/removed) for encoding", () => {
    const m = new ObservableMap<number>();
    m.set("a", 1);
    m.set("b", 2);
    m.delete("a");
    expect(m.consumeKeyDelta()).toEqual({ added: ["b"], removed: [] });
    // 'a' added then removed within the window nets to nothing on either list.
  });
});

describe("ObservableList", () => {
  it("fires onAdd for existing elements then for each push", () => {
    const l = new ObservableList<number>();
    l.push(1, 2);
    const seen: number[] = [];
    l.onAdd((v) => seen.push(v));
    expect(seen).toEqual([1, 2]);
    l.push(3);
    expect(seen).toEqual([1, 2, 3]);
  });

  it("supports length / at / forEach / iteration", () => {
    const l = new ObservableList<string>();
    l.push("a", "b", "c");
    expect(l.length).toBe(3);
    expect(l.at(1)).toBe("b");
    expect([...l]).toEqual(["a", "b", "c"]);
    expect(Array.from(l)).toEqual(["a", "b", "c"]);
  });

  it("splices out elements and flags the list dirty", () => {
    const l = new ObservableList<number>();
    l.push(10, 20, 30);
    l.consumeDirty();
    const removed = l.splice(1, 1);
    expect(removed).toEqual([20]);
    expect([...l]).toEqual([10, 30]);
    expect(l.consumeDirty()).toBe(true);
  });
});
