import { describe, it, expect, vi, beforeEach } from "vitest";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, RoomMetadata } from "shared";

// The matchmaker is the only thing these functions touch, and it is a live
// Colyseus singleton — so it is mocked and the ROOM LISTING is the input. What's
// under test is the collision retry and the three distinct "no" answers, both of
// which are pure logic over that listing.

interface Listing {
  roomId: string;
  locked?: boolean;
  metadata?: Partial<RoomMetadata>;
}

let listings: Listing[] = [];

vi.mock("colyseus", () => ({
  matchMaker: {
    query: async () => listings,
  },
}));

const { allocateRoomCode, findRoomByCode } = await import("../../server/src/rooms/roomCodes");

const room = (roomId: string, code: string, over: Partial<Listing & RoomMetadata> = {}): Listing => ({
  roomId,
  locked: over.locked ?? false,
  metadata: { code, phase: over.phase ?? "lobby", roomName: "", hostName: "" },
});

beforeEach(() => {
  listings = [];
  vi.restoreAllMocks();
});

describe("allocating a code", () => {
  it("produces a code of the right shape from the safe alphabet", async () => {
    const code = await allocateRoomCode();
    expect(code).toHaveLength(ROOM_CODE_LENGTH);
    for (const c of code) expect(ROOM_CODE_ALPHABET).toContain(c);
  });

  it("avoids a code a live room is already using", async () => {
    // Force the RNG so the first draw always collides and the second doesn't.
    const taken = ROOM_CODE_ALPHABET[0].repeat(ROOM_CODE_LENGTH);
    const free = ROOM_CODE_ALPHABET[1].repeat(ROOM_CODE_LENGTH);
    listings = [room("r1", taken)];

    let call = 0;
    vi.spyOn(Math, "random").mockImplementation(() => (call++ < ROOM_CODE_LENGTH ? 0 : 1 / ROOM_CODE_ALPHABET.length));

    const code = await allocateRoomCode();
    expect(code).not.toBe(taken);
    expect(code).toBe(free);
  });

  it("considers private rooms taken too — a collision there is the worst case", async () => {
    // A collision would silently send a player into a stranger's run, so the
    // scan must cover every listing, not just the public ones.
    const taken = ROOM_CODE_ALPHABET[0].repeat(ROOM_CODE_LENGTH);
    listings = [room("private", taken)];
    vi.spyOn(Math, "random").mockReturnValue(0); // always draws `taken`

    // After exhausting its retries it gives up and returns one anyway rather
    // than hanging — at that point the server holds ~1M rooms.
    expect(await allocateRoomCode()).toBe(taken);
  });

  it("ignores listings with no code at all", async () => {
    listings = [{ roomId: "r1", metadata: {} }, { roomId: "r2" }];
    const code = await allocateRoomCode();
    expect(code).toHaveLength(ROOM_CODE_LENGTH);
  });
});

describe("resolving a code", () => {
  it("finds a joinable lobby room", async () => {
    listings = [room("target", "ABCD")];
    expect(await findRoomByCode("ABCD")).toEqual({ ok: true, roomId: "target" });
  });

  it("accepts a lower-case or padded code, the way a player types it", async () => {
    listings = [room("target", "ABCD")];
    expect(await findRoomByCode("abcd")).toEqual({ ok: true, roomId: "target" });
    expect(await findRoomByCode("  AbCd  ")).toEqual({ ok: true, roomId: "target" });
  });

  it("says MISTYPED for a code no room has", async () => {
    listings = [room("other", "WXYZ")];
    const result = await findRoomByCode("ABCD");
    expect(result).toMatchObject({ ok: false, status: 404 });
    expect((result as { error: string }).error).toContain("ABCD");
  });

  it("says TOO LATE when the run has already started", async () => {
    listings = [room("target", "ABCD", { phase: "run" })];
    const result = await findRoomByCode("ABCD");
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect((result as { error: string }).error).toMatch(/already started/i);
  });

  it("says FULL when the room is locked but still in the lobby", async () => {
    // Colyseus locks a room for BOTH reasons, so the two are told apart by
    // metadata — they are different things for a player to do next.
    listings = [room("target", "ABCD", { locked: true })];
    const result = await findRoomByCode("ABCD");
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect((result as { error: string }).error).toMatch(/full/i);
  });

  it("prefers 'already started' over 'full' for a locked, running room", () => {
    // A started run is locked too; saying "full" there would send the player
    // back to wait for a seat that is never coming.
    listings = [room("target", "ABCD", { phase: "run", locked: true })];
    return expect(findRoomByCode("ABCD")).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/already started/i),
    });
  });

  it("picks the matching room out of a crowded listing", async () => {
    listings = [room("a", "AAAA"), room("b", "BBBB"), room("c", "CCCC")];
    expect(await findRoomByCode("BBBB")).toEqual({ ok: true, roomId: "b" });
  });

  it("does not fall over on listings with no metadata", async () => {
    listings = [{ roomId: "r1" }, room("target", "ABCD")];
    expect(await findRoomByCode("ABCD")).toEqual({ ok: true, roomId: "target" });
  });
});
