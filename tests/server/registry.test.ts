import { describe, it, expect } from "vitest";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "shared";
import { RoomRegistry, RegisterInput } from "../../server/src/registry";

// The registry is the P2P replacement for the Colyseus matchmaker: it remembers who
// is hosting what so a stranger can list public rooms or resolve a private code.
// These cover the collision-retry and the three distinct "no" answers — the logic
// the old room-codes.test.ts pinned, now over live registrations instead of a
// matchmaker query.

const HOST: RegisterInput = {
  roomName: "Test Room",
  hostName: "Host",
  isPrivate: false,
  maxClients: 4,
};

/** An rng that returns each value in turn, then holds the last — lets a test force
 *  the exact codes allocateCode draws. */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

/** The rng value that makes every character land on alphabet index `idx`. */
const pick = (idx: number) => idx / ROOM_CODE_ALPHABET.length;

describe("allocating a code", () => {
  it("produces a code of the right shape from the safe alphabet", () => {
    const code = new RoomRegistry().allocateCode();
    expect(code).toHaveLength(ROOM_CODE_LENGTH);
    for (const c of code) expect(ROOM_CODE_ALPHABET).toContain(c);
  });

  it("avoids a code a live room is already using", () => {
    const reg = new RoomRegistry();
    const taken = ROOM_CODE_ALPHABET[0].repeat(ROOM_CODE_LENGTH); // "AAAA"
    const free = ROOM_CODE_ALPHABET[1].repeat(ROOM_CODE_LENGTH);  // "BBBB"
    // Host a room forced onto "AAAA".
    expect(reg.register("host-a", HOST, () => pick(0))).toBe(taken);
    // Next allocation draws "AAAA" first (collides), then "BBBB".
    const rand = seq(...Array(ROOM_CODE_LENGTH).fill(pick(0)), ...Array(ROOM_CODE_LENGTH).fill(pick(1)));
    expect(reg.allocateCode(rand)).toBe(free);
  });

  it("considers a private room's code taken too — a collision there is the worst case", () => {
    const reg = new RoomRegistry();
    const taken = reg.register("host-p", { ...HOST, isPrivate: true }, () => pick(0));
    // Every draw collides with the private room's code; after exhausting retries it
    // returns one anyway rather than hanging.
    expect(reg.allocateCode(() => pick(0))).toBe(taken);
  });

  it("frees a code when its room is unregistered", () => {
    const reg = new RoomRegistry();
    const code = reg.register("host", HOST, () => pick(0));
    reg.unregister("host");
    // The code is available again — a fresh forced draw reuses it without collision.
    expect(reg.allocateCode(() => pick(0))).toBe(code);
  });

  it("re-registering the same host replaces its room and frees the old code", () => {
    const reg = new RoomRegistry();
    const first = reg.register("host", HOST, () => pick(0));
    const second = reg.register("host", HOST, () => pick(1));
    expect(second).not.toBe(first);
    expect(reg.resolveCode(first)).toMatchObject({ ok: false, status: 404 });
    expect(reg.resolveCode(second)).toEqual({ ok: true, roomId: "host" });
  });
});

describe("resolving a code", () => {
  it("finds a joinable lobby room", () => {
    const reg = new RoomRegistry();
    const code = reg.register("target", HOST, () => pick(0));
    expect(reg.resolveCode(code)).toEqual({ ok: true, roomId: "target" });
  });

  it("accepts a lower-case or padded code, the way a player types it", () => {
    const reg = new RoomRegistry();
    const code = reg.register("target", HOST, () => pick(0));
    expect(reg.resolveCode(code.toLowerCase())).toEqual({ ok: true, roomId: "target" });
    expect(reg.resolveCode(`  ${code.toLowerCase()}  `)).toEqual({ ok: true, roomId: "target" });
  });

  it("says MISTYPED for a code no room has", () => {
    const reg = new RoomRegistry();
    reg.register("other", HOST, () => pick(5));
    const code = ROOM_CODE_ALPHABET[0].repeat(ROOM_CODE_LENGTH);
    const result = reg.resolveCode(code);
    expect(result).toMatchObject({ ok: false, status: 404 });
    expect((result as { error: string }).error).toContain(code);
  });

  it("says TOO LATE when the run has already started", () => {
    const reg = new RoomRegistry();
    const code = reg.register("target", HOST, () => pick(0));
    reg.update("target", { phase: "run" });
    const result = reg.resolveCode(code);
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect((result as { error: string }).error).toMatch(/already started/i);
  });

  it("says FULL when the room is locked but still in the lobby", () => {
    const reg = new RoomRegistry();
    const code = reg.register("target", HOST, () => pick(0));
    reg.update("target", { locked: true });
    const result = reg.resolveCode(code);
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect((result as { error: string }).error).toMatch(/full/i);
  });

  it("says FULL when every seat is taken", () => {
    const reg = new RoomRegistry();
    const code = reg.register("target", { ...HOST, maxClients: 2 }, () => pick(0));
    reg.update("target", { clients: 2 });
    expect(reg.resolveCode(code)).toMatchObject({ ok: false, status: 409 });
  });

  it("prefers 'already started' over 'full' for a locked, running room", () => {
    const reg = new RoomRegistry();
    const code = reg.register("target", HOST, () => pick(0));
    reg.update("target", { phase: "run", locked: true });
    expect(reg.resolveCode(code)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/already started/i),
    });
  });
});

describe("listing public rooms", () => {
  it("returns only public, joinable rooms", () => {
    const reg = new RoomRegistry();
    reg.register("public", HOST, () => pick(0));
    reg.register("private", { ...HOST, isPrivate: true }, () => pick(1));
    reg.register("started", HOST, () => pick(2));
    reg.update("started", { phase: "run" });
    reg.register("full", { ...HOST, maxClients: 1 }, () => pick(3));
    reg.update("full", { clients: 1 });

    const rooms = reg.list();
    expect(rooms.map((r) => r.roomId)).toEqual(["public"]);
    expect(rooms[0]).toMatchObject({
      clients: 1,
      maxClients: 4,
      metadata: { roomName: "Test Room", hostName: "Host", phase: "lobby" },
    });
  });

  it("reflects a host's live updates in the listing", () => {
    const reg = new RoomRegistry();
    reg.register("r", HOST, () => pick(0));
    reg.update("r", { clients: 3, roomName: "Renamed" });
    const [row] = reg.list();
    expect(row.clients).toBe(3);
    expect(row.metadata.roomName).toBe("Renamed");
  });

  it("drops a room from the listing once its host unregisters", () => {
    const reg = new RoomRegistry();
    reg.register("r", HOST, () => pick(0));
    expect(reg.list()).toHaveLength(1);
    reg.unregister("r");
    expect(reg.list()).toHaveLength(0);
  });
});
