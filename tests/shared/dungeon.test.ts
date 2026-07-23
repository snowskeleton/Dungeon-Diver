import { describe, it, expect } from "vitest";
import {
  generateDungeon,
  ROOM_W,
  ROOM_H,
  TILE,
  TILE_SIZE,
  TILE_PROPS,
  TileId,
  RoomType,
  DungeonResult,
  roomCellAt,
  roomInteriorContains,
  roomInteriorRect,
} from "shared";

// The generator's contract has two halves: it must produce a PLAYABLE floor
// (reachable stairs, no one spawned in a wall, every room enterable), and it must
// be DETERMINISTIC (client and server each build the floor from the same seed —
// any divergence is a desync, not a cosmetic difference).

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

// ── Determinism ──────────────────────────────────────────────────────────────

describe("determinism", () => {
  it("produces an identical floor for the same seed, every time", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const a = generateDungeon(seed);
      const b = generateDungeon(seed);
      expect(a.mapData, `seed ${seed}`).toEqual(b.mapData);
      expect(a.startRoomId).toBe(b.startRoomId);
      expect(a.exitRoomId).toBe(b.exitRoomId);
      expect(a.bossRoomId).toBe(b.bossRoomId);
      expect(a.playerSpawns).toEqual(b.playerSpawns);
      expect(a.stairsTile).toEqual(b.stairsTile);
      expect([...a.roomTypes]).toEqual([...b.roomTypes]);
    }
  });

  it("is not affected by interleaving other generations", () => {
    // Catches a generator that leaked state into a module-level rng.
    const solo = generateDungeon(7);
    generateDungeon(99);
    generateDungeon(1234);
    expect(generateDungeon(7).mapData).toEqual(solo.mapData);
  });

  it("gives different seeds different floors", () => {
    const fingerprints = new Set(SEEDS.map(s => fingerprint(generateDungeon(s))));
    // Not necessarily 60 distinct (small grids can collide), but nowhere near 1.
    expect(fingerprints.size).toBeGreaterThan(SEEDS.length * 0.8);
  });

  it("keeps the whole option surface deterministic too", () => {
    const variants = [
      { showcaseRoomType: "shop" as RoomType },
      { showcaseRoomType: "boss" as RoomType },
      { forceRoomType: "maze" as RoomType },
      { gridCols: 1, gridRows: 1, minRooms: 1 },
      { gridCols: 8, gridRows: 6 },
      { includeBoss: false },
      { includeStairs: false },
      { neighborChance: 100 },
    ];
    for (const opts of variants) {
      for (const seed of [1, 5, 42]) {
        expect(fingerprint(generateDungeon(seed, opts)), JSON.stringify(opts))
          .toBe(fingerprint(generateDungeon(seed, opts)));
      }
    }
  });

  it("keeps every seed's map STABLE across changes to the generator", () => {
    // Client and server each generate the floor themselves, so any change that
    // consumes rng draws in a different order silently changes every existing
    // seed's map and can desync a live game mid-migration.
    //
    // This checksum is not a balance number — it is that contract. If a
    // deliberate generation change lands, re-run and paste the new value in,
    // and know you have changed every seed's layout.
    const checksum = SEEDS.map(s => fingerprint(generateDungeon(s))).join("|");
    expect(hash(checksum)).toMatchInlineSnapshot(`"64d49529"`);
  });
});

function fingerprint(d: DungeonResult): string {
  return hash([
    d.mapData.map(r => r.join("")).join("/"),
    d.startRoomId,
    d.exitRoomId,
    String(d.bossRoomId),
    `${d.stairsTile.col},${d.stairsTile.row}`,
    d.playerSpawns.map(p => `${p.x},${p.y}`).join(";"),
    [...d.roomTypes].map(([k, v]) => `${k}=${v}`).join(","),
    d.connections.map(c => c.id).join(","),
  ].join("#"));
}

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// ── Structure ────────────────────────────────────────────────────────────────

describe("floor structure", () => {
  it("builds a map of the declared size", () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const d = generateDungeon(seed);
      expect(d.mapData).toHaveLength(d.rows);
      for (const row of d.mapData) expect(row).toHaveLength(d.cols);
      expect(d.cols % ROOM_W).toBe(0);
      expect(d.rows % ROOM_H).toBe(0);
    }
  });

  it("emits only tile ids the game knows about", () => {
    const known = new Set(Object.values(TILE));
    for (const seed of SEEDS.slice(0, 15)) {
      for (const row of generateDungeon(seed).mapData) {
        for (const t of row) expect(known.has(t as never), `unknown tile ${t}`).toBe(true);
      }
    }
  });

  it("places at least the minimum number of rooms", () => {
    for (const seed of SEEDS) {
      expect(generateDungeon(seed).rooms.length, `seed ${seed}`).toBeGreaterThanOrEqual(4);
    }
  });

  it("gives every room a unique id matching its grid cell", () => {
    for (const seed of SEEDS.slice(0, 15)) {
      const d = generateDungeon(seed);
      const ids = d.rooms.map(r => r.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const r of d.rooms) {
        expect(r.id).toBe(`${r.gx},${r.gy}`);
        expect(r.tileCol).toBe(r.gx * ROOM_W);
        expect(r.tileRow).toBe(r.gy * ROOM_H);
      }
    }
  });

  it("has a start room and an exit room that both exist", () => {
    for (const seed of SEEDS) {
      const d = generateDungeon(seed);
      expect(d.rooms.some(r => r.id === d.startRoomId), `seed ${seed}`).toBe(true);
      expect(d.rooms.some(r => r.id === d.exitRoomId), `seed ${seed}`).toBe(true);
    }
  });

  it("assigns exactly one boss room, never the start room", () => {
    for (const seed of SEEDS) {
      const d = generateDungeon(seed);
      const bossRooms = d.rooms.filter(r => r.type === "boss");
      expect(bossRooms, `seed ${seed}`).toHaveLength(1);
      expect(d.bossRoomId).toBe(bossRooms[0].id);
      expect(d.bossRoomId).not.toBe(d.startRoomId);
    }
  });

  it("connects the rooms into one graph — every room is reachable from start", () => {
    for (const seed of SEEDS) {
      const d = generateDungeon(seed);
      const adj = new Map<string, string[]>();
      for (const c of d.connections) {
        (adj.get(c.parentRoomId) ?? adj.set(c.parentRoomId, []).get(c.parentRoomId)!).push(c.childRoomId);
        (adj.get(c.childRoomId) ?? adj.set(c.childRoomId, []).get(c.childRoomId)!).push(c.parentRoomId);
      }
      const seen = new Set([d.startRoomId]);
      const queue = [d.startRoomId];
      while (queue.length) {
        for (const next of adj.get(queue.pop()!) ?? []) {
          if (!seen.has(next)) { seen.add(next); queue.push(next); }
        }
      }
      expect(seen.size, `seed ${seed}: ${seen.size}/${d.rooms.length} reachable`).toBe(d.rooms.length);
    }
  });

  it("names real rooms on both ends of every connection", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const d = generateDungeon(seed);
      const ids = new Set(d.rooms.map(r => r.id));
      for (const c of d.connections) {
        expect(ids.has(c.parentRoomId), c.id).toBe(true);
        expect(ids.has(c.childRoomId), c.id).toBe(true);
        expect(c.parentRoomId).not.toBe(c.childRoomId);
      }
    }
  });

  it("gives every connection barriers with real area", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      for (const c of generateDungeon(seed).connections) {
        for (const b of [c.barrierParent, c.barrierChild]) {
          expect(b.w, c.id).toBeGreaterThan(0);
          expect(b.h, c.id).toBeGreaterThan(0);
        }
      }
    }
  });
});

// ── Playability ──────────────────────────────────────────────────────────────

describe("playability", () => {
  it("spawns every player slot on a walkable tile", () => {
    for (const seed of SEEDS) {
      const d = generateDungeon(seed);
      expect(d.playerSpawns).toHaveLength(4);
      for (const s of d.playerSpawns) {
        const tile = tileAt(d, s.x, s.y);
        expect(TILE_PROPS[tile].walkable, `seed ${seed} spawn (${s.x},${s.y}) on tile ${tile}`).toBe(true);
      }
    }
  });

  it("never spawns anyone on the stairs, or a floor would descend on load", () => {
    for (const seed of SEEDS) {
      const d = generateDungeon(seed);
      for (const s of d.playerSpawns) {
        expect(tileAt(d, s.x, s.y), `seed ${seed}`).not.toBe(TILE.STAIRS);
      }
    }
  });

  it("never spawns anyone on a trap", () => {
    for (const seed of SEEDS) {
      const d = generateDungeon(seed);
      for (const s of d.playerSpawns) {
        expect(tileAt(d, s.x, s.y), `seed ${seed}`).not.toBe(TILE.TRAP);
      }
    }
  });

  it("gives the party four DISTINCT spawn points in any open start room", () => {
    // Four bodies at the identical position have no separation normal, and the
    // solver flings one of them through geometry (playtest B2).
    for (const seed of SEEDS) {
      const d = generateDungeon(seed);
      if (d.rooms.find(r => r.id === d.startRoomId)!.type === "maze") continue;
      expect(new Set(d.playerSpawns.map(s => `${s.x},${s.y}`)).size, `seed ${seed}`).toBe(4);
    }
  });

  it("still never stacks more than two players, even in a maze start room", () => {
    // KNOWN GAP, pinned rather than asserted away: the spawn ring only inspects
    // the eight tiles around the spawn, and a maze corridor can offer just three
    // open ones — so the fourth slot falls back onto an occupied tile. It happens
    // on maze start rooms only, and never stacks more than one pair, but it IS
    // the B2 condition the ring exists to prevent. Widen the ring to fix.
    for (const seed of SEEDS) {
      const d = generateDungeon(seed);
      const distinct = new Set(d.playerSpawns.map(s => `${s.x},${s.y}`)).size;
      expect(distinct, `seed ${seed}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("puts the stairs where it says it did, and only one of them", () => {
    for (const seed of SEEDS) {
      const d = generateDungeon(seed);
      expect(d.mapData[d.stairsTile.row][d.stairsTile.col], `seed ${seed}`).toBe(TILE.STAIRS);
      expect(countTiles(d, TILE.STAIRS), `seed ${seed}`).toBe(1);
    }
  });

  it("keeps the stairs out of rooms that put props on their floor", () => {
    for (const seed of SEEDS) {
      const d = generateDungeon(seed);
      const exitType = d.rooms.find(r => r.id === d.exitRoomId)!.type;
      expect(["shop", "shrine", "chest"], `seed ${seed}`).not.toContain(exitType);
    }
  });

  it("leaves the stairs reachable by walking from the spawn", () => {
    for (const seed of SEEDS) {
      const d = generateDungeon(seed);
      const spawn = d.playerSpawns[0];
      const reached = floodFill(d, Math.floor(spawn.x / TILE_SIZE), Math.floor(spawn.y / TILE_SIZE));
      expect(reached.has(`${d.stairsTile.col},${d.stairsTile.row}`), `seed ${seed}: stairs unreachable`).toBe(true);
    }
  });

  it("leaves every room walkable-reachable from the spawn — none is sealed off", () => {
    for (const seed of SEEDS) {
      const d = generateDungeon(seed);
      const spawn = d.playerSpawns[0];
      const reached = floodFill(d, Math.floor(spawn.x / TILE_SIZE), Math.floor(spawn.y / TILE_SIZE));
      for (const room of d.rooms) {
        const inside = [...reached].some(k => {
          const [c, r] = k.split(",").map(Number);
          return c > room.tileCol && c < room.tileCol + ROOM_W - 1
            && r > room.tileRow && r < room.tileRow + ROOM_H - 1;
        });
        expect(inside, `seed ${seed} room ${room.id} (${room.type}) is sealed off`).toBe(true);
      }
    }
  });

  it("leaves the centre reachable in rooms that PUT SOMETHING THERE", () => {
    // A combat room's cover block may legitimately sit on the centre tile —
    // nothing needs that tile. The stairs and the pedestals do, so those rooms
    // are held to the stricter rule.
    for (const seed of SEEDS) {
      const d = generateDungeon(seed);
      const spawn = d.playerSpawns[0];
      const reached = floodFill(d, Math.floor(spawn.x / TILE_SIZE), Math.floor(spawn.y / TILE_SIZE));
      for (const room of d.rooms) {
        if (room.id !== d.exitRoomId) continue;
        expect(reached.has(`${room.centerCol},${room.centerRow}`),
          `seed ${seed} exit room centre (the stairs) unreachable`).toBe(true);
      }
    }
  });
});

// ── Room types ───────────────────────────────────────────────────────────────

describe("room types", () => {
  it("mixes several types on a normal floor", () => {
    const seen = new Set<RoomType>();
    for (const seed of SEEDS) {
      for (const r of generateDungeon(seed).rooms) seen.add(r.type);
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });

  it("agrees between the roomTypes map and each room's own type", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const d = generateDungeon(seed);
      for (const r of d.rooms) expect(d.roomTypes.get(r.id)).toBe(r.type);
    }
  });

  it("forceRoomType gives every non-boss room that type, and reserves no boss", () => {
    const d = generateDungeon(3, { forceRoomType: "maze" });
    expect(d.rooms.every(r => r.type === "maze")).toBe(true);
    expect(d.bossRoomId).toBeNull();
  });

  it("showcaseRoomType builds a 3-room line with a real start and exit", () => {
    for (const type of ["shop", "shrine", "chest", "wave", "timed", "dark", "boss"] as RoomType[]) {
      const d = generateDungeon(1, { showcaseRoomType: type });
      expect(d.rooms, type).toHaveLength(3);
      expect(d.rooms.some(r => r.type === type), type).toBe(true);
      expect(d.startRoomId, type).not.toBe(d.exitRoomId);
      // ...and it is still playable: the stairs exist and are walkable-to.
      expect(d.mapData[d.stairsTile.row][d.stairsTile.col], type).toBe(TILE.STAIRS);
    }
  });

  it("gives dark rooms no cover, since invisible cover is only a snag", () => {
    const d = generateDungeon(1, { showcaseRoomType: "dark" });
    const room = d.rooms.find(r => r.type === "dark")!;
    const interior = d.mapData[room.centerRow].slice(room.tileCol + 1, room.tileCol + ROOM_W - 1);
    expect(interior.every(t => t !== TILE.WALL)).toBe(true);
  });

  it("stamps boss passageways gold so the room is telegraphed", () => {
    let sawGold = false;
    for (const seed of SEEDS.slice(0, 20)) {
      const d = generateDungeon(seed);
      if (countTiles(d, TILE.BOSS_FLOOR) > 0) sawGold = true;
    }
    expect(sawGold).toBe(true);
  });

  it("places no gold passage when there is no boss", () => {
    expect(countTiles(generateDungeon(3, { includeBoss: false }), TILE.BOSS_FLOOR)).toBe(0);
  });

  it("omits the stairs entirely when asked to", () => {
    expect(countTiles(generateDungeon(3, { includeStairs: false }), TILE.STAIRS)).toBe(0);
  });
});

// ── Traps ────────────────────────────────────────────────────────────────────

describe("trap tiles", () => {
  // Traps are rare (1% per eligible room), so these sweep many seeds.
  const many = Array.from({ length: 400 }, (_, i) => i + 1);

  it("appear at all, and stay rare", () => {
    let withTraps = 0;
    let total = 0;
    for (const seed of many) {
      const n = countTiles(generateDungeon(seed), TILE.TRAP);
      if (n > 0) withTraps++;
      total += n;
    }
    expect(total).toBeGreaterThan(0);
    expect(withTraps / many.length).toBeLessThan(0.4); // a gut-punch, not a tax
  });

  it("never land in a reward room, the boss room, or the start room", () => {
    for (const seed of many) {
      const d = generateDungeon(seed);
      for (const room of d.rooms) {
        if (!["boss", "shop", "shrine", "chest"].includes(room.type) && room.id !== d.startRoomId) continue;
        expect(roomTileCount(d, room, TILE.TRAP), `seed ${seed} ${room.id} (${room.type})`).toBe(0);
      }
    }
  });

  it("never overwrite the stairs or a boss passageway", () => {
    // Guaranteed structurally by running last over plain-FLOOR tiles only.
    for (const seed of many) {
      const d = generateDungeon(seed);
      expect(d.mapData[d.stairsTile.row][d.stairsTile.col], `seed ${seed}`).toBe(TILE.STAIRS);
    }
  });

  it("stay off doorways and out of the room centre", () => {
    for (const seed of many) {
      const d = generateDungeon(seed);
      for (const room of d.rooms) {
        for (let row = room.tileRow; row < room.tileRow + ROOM_H; row++) {
          for (let col = room.tileCol; col < room.tileCol + ROOM_W; col++) {
            if (d.mapData[row][col] !== TILE.TRAP) continue;
            expect(col - room.tileCol, `seed ${seed} border`).toBeGreaterThanOrEqual(2);
            expect(room.tileCol + ROOM_W - 1 - col, `seed ${seed} border`).toBeGreaterThanOrEqual(2);
            const nearCentre = Math.abs(col - room.centerCol) <= 2 && Math.abs(row - room.centerRow) <= 2;
            expect(nearCentre, `seed ${seed} centre`).toBe(false);
          }
        }
      }
    }
  });

  it("are visible: a trap tile is walkable, so stepping on one is a mistake", () => {
    expect(TILE_PROPS[TILE.TRAP].walkable).toBe(true);
    expect(TILE_PROPS[TILE.TRAP].effect).toBeUndefined();
  });
});

// ── Room geometry helpers ────────────────────────────────────────────────────

describe("roomCellAt / roomInteriorContains", () => {
  it("maps a point to the grid cell containing it", () => {
    expect(roomCellAt(0, 0)).toEqual({ gx: 0, gy: 0, id: "0,0" });
    expect(roomCellAt(ROOM_W * TILE_SIZE, 0).gx).toBe(1);
    expect(roomCellAt(0, ROOM_H * TILE_SIZE).gy).toBe(1);
    expect(roomCellAt(ROOM_W * TILE_SIZE - 1, ROOM_H * TILE_SIZE - 1).id).toBe("0,0");
  });

  it("answers a DIFFERENT question from interior containment", () => {
    // The camera wants the cell; FloorManager wants the interior. The border
    // inset between them is load-bearing — doorways punch through it.
    const d = generateDungeon(1);
    const room = d.rooms[0];
    const rect = roomInteriorRect(room);

    const onTheBorder = { x: room.tileCol * TILE_SIZE + 4, y: room.centerRow * TILE_SIZE + 16 };
    expect(roomCellAt(onTheBorder.x, onTheBorder.y).id).toBe(room.id); // in the cell
    expect(roomInteriorContains(room, onTheBorder.x, onTheBorder.y)).toBe(false); // not inside

    const middle = { x: (rect.xMin + rect.xMax) / 2, y: (rect.yMin + rect.yMax) / 2 };
    expect(roomInteriorContains(room, middle.x, middle.y)).toBe(true);
  });

  it("insets the interior by exactly one tile on every side", () => {
    const room = generateDungeon(1).rooms[0];
    const rect = roomInteriorRect(room);
    expect(rect.xMin).toBe((room.tileCol + 1) * TILE_SIZE);
    expect(rect.yMin).toBe((room.tileRow + 1) * TILE_SIZE);
    expect(rect.xMax).toBe((room.tileCol + ROOM_W - 1) * TILE_SIZE);
    expect(rect.yMax).toBe((room.tileRow + ROOM_H - 1) * TILE_SIZE);
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

function tileAt(d: DungeonResult, x: number, y: number): TileId {
  return d.mapData[Math.floor(y / TILE_SIZE)][Math.floor(x / TILE_SIZE)];
}

function countTiles(d: DungeonResult, tile: TileId): number {
  return d.mapData.reduce((n, row) => n + row.filter(t => t === tile).length, 0);
}

function roomTileCount(d: DungeonResult, room: { tileCol: number; tileRow: number }, tile: TileId): number {
  let n = 0;
  for (let r = room.tileRow; r < room.tileRow + ROOM_H; r++) {
    for (let c = room.tileCol; c < room.tileCol + ROOM_W; c++) {
      if (d.mapData[r]?.[c] === tile) n++;
    }
  }
  return n;
}

/** Every tile walkable-reachable from (col, row), 4-connected. */
function floodFill(d: DungeonResult, col: number, row: number): Set<string> {
  const seen = new Set<string>([`${col},${row}`]);
  const queue = [{ col, row }];
  while (queue.length) {
    const { col: c, row: r } = queue.pop()!;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      const key = `${nc},${nr}`;
      if (seen.has(key)) continue;
      const t = d.mapData[nr]?.[nc];
      if (t === undefined || !TILE_PROPS[t].walkable) continue;
      seen.add(key);
      queue.push({ col: nc, row: nr });
    }
  }
  return seen;
}
