import { describe, it, expect } from "vitest";
import {
  generateDungeon,
  DEFAULT_DEBUG_CONFIG,
  DebugConfig,
  DungeonOptions,
  RoomType,
  TILE,
  TILE_SIZE,
  TILE_PROPS,
  TileId,
  ROOM_W,
  ROOM_H,
  partyHpMultiplier,
  ENEMY_HP_PLAYER_SCALE,
  ENEMY_SPAWN_EMERGE_MS,
  roomInteriorContains,
} from "shared";
import { SpawnDirector } from "../../server/src/rooms/SpawnDirector";
import { GameState } from "../../server/src/schema/GameState";
import { FloorManager } from "../../server/src/floor/FloorManager";
import { PhysicsWorld } from "../../server/src/physics/PhysicsWorld";
import { Enemy } from "../../server/src/entities/Enemy";
import { Player } from "../../server/src/entities/Player";
import { REGULAR_ENEMIES } from "../../server/src/entities/enemies";
import { BOSSES } from "../../server/src/entities/bosses";
import { GooGreen } from "../../server/src/entities/enemies/goos";

// SpawnDirector is the ONE place an enemy comes into existence, so the rules it
// enforces there — never in the start room, never in a reward room, always
// confined, always party-scaled — hold for every creature in the game.

function floor(opts: {
  dungeonOpts?: DungeonOptions;
  seed?: number;
  players?: number;
  debug?: Partial<DebugConfig> | null;
  floorNumber?: number;
} = {}) {
  const dungeonOpts = opts.dungeonOpts ?? {};
  const dungeon = generateDungeon(opts.seed ?? 1, dungeonOpts);
  const physics = new PhysicsWorld(dungeon.mapData, dungeon.cols, dungeon.rows);
  const floorManager = new FloorManager(dungeon.rooms, dungeon.connections, physics);
  const state = new GameState();
  state.floor = opts.floorNumber ?? 1;

  const enemies = new Map<string, Enemy>();
  const players = new Map<string, Player>();
  for (let i = 0; i < (opts.players ?? 1); i++) {
    players.set(`p${i}`, new Player(physics, 100, 100));
  }

  const debug = opts.debug === undefined || opts.debug === null
    ? null
    : { ...DEFAULT_DEBUG_CONFIG, enabled: true, ...opts.debug };

  const spawner = new SpawnDirector(state, enemies, players, debug, dungeonOpts);
  spawner.setFloor(dungeon, physics, floorManager);
  return { dungeon, physics, floorManager, state, enemies, players, spawner };
}

const roomOf = (dungeon: ReturnType<typeof generateDungeon>, e: Enemy) =>
  dungeon.rooms.find(r => roomInteriorContains(r, e.state.x, e.state.y));

describe("the rank-and-file pass", () => {
  it("populates the floor", () => {
    const f = floor();
    f.spawner.spawnFloorEnemies();
    expect(f.enemies.size).toBeGreaterThan(0);
  });

  it("registers every enemy with the floor manager but defers the synced state", () => {
    const f = floor();
    f.spawner.spawnFloorEnemies();

    // Spawning is deferred: the creatures exist and are room-assigned, but none are
    // on the wire until a player enters — so the synced map starts empty.
    expect(f.enemies.size).toBeGreaterThan(0);
    expect(f.state.enemies.size).toBe(0);
    for (const id of f.enemies.keys()) {
      expect(f.floorManager.getEnemyRoom(id), id).toBeDefined();
      expect(f.enemies.get(id)!.spawned, id).toBe(false);
    }
  });

  it("reveals a room's whole batch onto the synced state when it is entered", () => {
    const f = floor();
    f.spawner.spawnFloorEnemies();

    // Pick a room that actually got enemies and reveal it.
    const roomId = f.floorManager.getEnemyRoom([...f.enemies.keys()][0])!;
    const inRoom = [...f.enemies].filter(([id]) => f.floorManager.getEnemyRoom(id) === roomId);
    f.spawner.spawnRoom(roomId);

    for (const [id, e] of inRoom) {
      expect(e.spawned, id).toBe(true);
      expect(f.state.enemies.has(id), id).toBe(true);
    }
    // Enemies in other rooms are still hidden.
    expect(f.state.enemies.size).toBe(inRoom.length);
  });

  it("makes a revealed enemy EMERGE — inert in its puff — before it can act", () => {
    const f = floor();
    const enemy = new GooGreen(f.physics, 300, 300);
    enemy.markUnspawned();
    enemy.reveal();

    // Just revealed: visible but still rising, so no contact hazard yet.
    expect(enemy.emerging).toBe(true);
    expect(enemy.contactHitSource("e")).toBeNull();

    // Hold it there for the whole emerge window...
    let waited = 0;
    while (enemy.emerging) {
      enemy.advanceEmerge(50);
      waited += 50;
    }
    // ...which is the shared spawn window, then it becomes a live hazard.
    expect(waited).toBe(ENEMY_SPAWN_EMERGE_MS);
    expect(enemy.contactHitSource("e")).not.toBeNull();
  });

  it("leaves the start room clear, so nobody is jumped on load", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const f = floor({ seed });
      f.spawner.spawnFloorEnemies();
      for (const id of f.enemies.keys()) {
        expect(f.floorManager.getEnemyRoom(id), `seed ${seed}`).not.toBe(f.dungeon.startRoomId);
      }
    }
  });

  it("leaves reward rooms empty — they exist to be safe to walk into", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const f = floor({ seed });
      f.spawner.spawnFloorEnemies();
      const rewardRooms = new Set(
        f.dungeon.rooms.filter(r => ["shop", "shrine", "chest"].includes(r.type)).map(r => r.id),
      );
      for (const id of f.enemies.keys()) {
        expect(rewardRooms.has(f.floorManager.getEnemyRoom(id)!), `seed ${seed}`).toBe(false);
      }
    }
  });

  it("puts every enemy on walkable ground, never on the stairs", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const f = floor({ seed });
      f.spawner.spawnFloorEnemies();
      for (const e of f.enemies.values()) {
        const tile = f.dungeon.mapData[Math.floor(e.state.y / TILE_SIZE)][Math.floor(e.state.x / TILE_SIZE)] as TileId;
        expect(TILE_PROPS[tile].walkable, `seed ${seed}`).toBe(true);
        expect(tile, `seed ${seed}`).not.toBe(TILE.STAIRS);
      }
    }
  });

  it("puts every enemy inside a room's interior, off the doorway tiles", () => {
    // A spawn on a doorway drifts into the neighbour and escapes FloorManager's
    // room classification entirely.
    for (let seed = 1; seed <= 12; seed++) {
      const f = floor({ seed });
      f.spawner.spawnFloorEnemies();
      for (const e of f.enemies.values()) {
        expect(roomOf(f.dungeon, e), `seed ${seed} (${e.state.x},${e.state.y})`).toBeDefined();
      }
    }
  });

  it("confines every enemy to the room it spawned in", () => {
    const f = floor();
    f.spawner.spawnFloorEnemies();
    for (const [id, e] of f.enemies) {
      const home = f.floorManager.getEnemyRoom(id)!;
      const room = f.dungeon.rooms.find(r => r.id === home)!;
      // Drive it hard at the far corner of the map; containment must hold.
      for (let i = 0; i < 60; i++) {
        (e as unknown as { move(dx: number, dy: number, s: number): void })
          .move(1, 1, 200);
        e.commitVelocity();
        f.physics.step();
        e.syncFromBody();
      }
      expect(e.state.x, id).toBeLessThan((room.tileCol + ROOM_W) * TILE_SIZE);
      expect(e.state.y, id).toBeLessThan((room.tileRow + ROOM_H) * TILE_SIZE);
    }
  });

  it("draws only from the rank-and-file pool — no boss shows up as rabble", () => {
    const bossTypes = new Set(BOSSES.map(B => B.type));
    for (let seed = 1; seed <= 12; seed++) {
      const f = floor({ seed });
      f.spawner.spawnFloorEnemies();
      for (const [id, e] of f.enemies) {
        if (f.floorManager.getEnemyRoom(id) === f.dungeon.bossRoomId) continue;
        expect(bossTypes.has(e.state.enemyType as never), `seed ${seed}`).toBe(false);
      }
    }
  });
});

describe("enemy counts", () => {
  it("grows with the floor number", () => {
    const shallow = floor({ floorNumber: 1 }).spawner.enemiesPerRoom();
    const deep = floor({ floorNumber: 9 }).spawner.enemiesPerRoom();
    expect(deep).toBeGreaterThan(shallow);
  });

  it("grows with the party size", () => {
    const solo = floor({ players: 1 }).spawner.enemiesPerRoom();
    const four = floor({ players: 4 }).spawner.enemiesPerRoom();
    expect(four).toBeGreaterThan(solo);
  });

  it("is overridden exactly by the debug knob", () => {
    expect(floor({ debug: { enemiesPerRoom: 7 } }).spawner.enemiesPerRoom()).toBe(7);
    expect(floor({ debug: { enemiesPerRoom: 0 } }).spawner.enemiesPerRoom()).toBe(0);
  });

  it("falls back to the formula at -1", () => {
    const auto = floor({ debug: { enemiesPerRoom: -1 } }).spawner.enemiesPerRoom();
    expect(auto).toBe(floor().spawner.enemiesPerRoom());
  });

  it("spawns no rabble at a count of zero — but still spawns the boss", () => {
    const f = floor({ debug: { enemiesPerRoom: 0 } });
    f.spawner.spawnFloorEnemies();

    const bossTypes = new Set(BOSSES.map(B => B.type));
    expect(f.enemies.size).toBe(1);
    expect(bossTypes.has([...f.enemies.values()][0].state.enemyType as never)).toBe(true);
  });

  it("forces enemies into EVERY room when the debug count is explicit", () => {
    const f = floor({ debug: { enemiesPerRoom: 1 } });
    f.spawner.spawnFloorEnemies();
    const rooms = new Set([...f.enemies.keys()].map(id => f.floorManager.getEnemyRoom(id)));
    // The start room is the one exception that survives the override — players
    // spawn there, so it stays clear whatever the debug knob says.
    const rewardRooms = f.dungeon.rooms.filter(
      r => ["shop", "shrine", "chest"].includes(r.type) && r.id !== f.dungeon.startRoomId,
    );
    expect(rewardRooms.length).toBeGreaterThan(0);
    for (const r of rewardRooms) expect(rooms.has(r.id), r.id).toBe(true);
    expect(rooms.has(f.dungeon.startRoomId)).toBe(false);
  });
});

describe("the enemy pool", () => {
  it("is the whole rank-and-file roster by default", () => {
    expect(floor().spawner.enemyPool()).toEqual(REGULAR_ENEMIES);
  });

  it("is exactly the debug selection, in the order listed", () => {
    const pool = floor({ debug: { enemyTypes: ["bat", "goo-blue"] } }).spawner.enemyPool();
    expect(pool.map(C => C.type)).toEqual(["bat", "goo-blue"]);
  });

  it("resolves a selected BOSS to its real Boss subclass", () => {
    const pool = floor({ debug: { enemyTypes: ["turtle-dragon"] } }).spawner.enemyPool();
    expect(pool.map(C => C.type)).toEqual(["turtle-dragon"]);
  });

  it("falls back to the full roster when the selection names nothing real", () => {
    const pool = floor({ debug: { enemyTypes: ["not-a-creature" as never] } }).spawner.enemyPool();
    expect(pool).toEqual(REGULAR_ENEMIES);
  });

  it("fills round-robin from a named list, so the menu selection is honoured evenly", () => {
    const f = floor({ debug: { enemyTypes: ["bat", "goo-blue"], enemiesPerRoom: 4 } });
    f.spawner.spawnFloorEnemies();
    const types = [...f.enemies.values()]
      .map(e => e.state.enemyType)
      .filter(t => t === "bat" || t === "goo-blue");
    const bats = types.filter(t => t === "bat").length;
    const goos = types.filter(t => t === "goo-blue").length;
    expect(Math.abs(bats - goos)).toBeLessThanOrEqual(1);
  });
});

describe("the boss", () => {
  it("puts exactly one boss in the boss room", () => {
    const f = floor();
    f.spawner.spawnFloorEnemies();
    const bossTypes = new Set(BOSSES.map(B => B.type));
    const bosses = [...f.enemies].filter(([, e]) => bossTypes.has(e.state.enemyType as never));

    expect(bosses).toHaveLength(1);
    expect(f.floorManager.getEnemyRoom(bosses[0][0])).toBe(f.dungeon.bossRoomId);
  });

  it("rotates by floor, so consecutive floors never repeat one", () => {
    const seen: string[] = [];
    for (let n = 1; n <= BOSSES.length + 1; n++) {
      const f = floor({ floorNumber: n, debug: { enemiesPerRoom: 0 } });
      f.spawner.spawnFloorEnemies();
      seen.push([...f.enemies.values()][0].state.enemyType);
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i], `floor ${i + 1} repeats floor ${i}`).not.toBe(seen[i - 1]);
    }
    expect(new Set(seen.slice(0, BOSSES.length)).size).toBe(BOSSES.length);
  });

  it("keeps the boss room locked — it must not be pre-cleared", () => {
    // spawnBoss has to run BEFORE finalizeEmptyRooms or the boss never locks
    // anyone in.
    const f = floor({ debug: { enemiesPerRoom: 0 } });
    f.spawner.spawnFloorEnemies();
    f.floorManager.finalizeEmptyRooms();

    expect(f.floorManager.isRoomCleared(f.dungeon.bossRoomId!)).toBe(false);
  });

  it("never places the boss on the stairs", () => {
    for (let seed = 1; seed <= 15; seed++) {
      const f = floor({ seed, debug: { enemiesPerRoom: 0 } });
      f.spawner.spawnFloorEnemies();
      const boss = [...f.enemies.values()][0];
      if (!boss) continue;
      const tile = f.dungeon.mapData[Math.floor(boss.state.y / TILE_SIZE)][Math.floor(boss.state.x / TILE_SIZE)];
      expect(tile, `seed ${seed}`).not.toBe(TILE.STAIRS);
    }
  });

  it("spawns no boss on a floor generated without one", () => {
    const f = floor({ dungeonOpts: { includeBoss: false }, debug: { enemiesPerRoom: 0 } });
    f.spawner.spawnFloorEnemies();
    expect(f.enemies.size).toBe(0);
  });
});

describe("party-size HP scaling", () => {
  it("is a no-op solo", () => {
    expect(partyHpMultiplier(1)).toBe(1);
    expect(partyHpMultiplier(0)).toBe(1); // clamped
  });

  it("scales linearly with each extra player", () => {
    expect(partyHpMultiplier(2)).toBeCloseTo(1 + ENEMY_HP_PLAYER_SCALE, 9);
    expect(partyHpMultiplier(4)).toBeCloseTo(1 + ENEMY_HP_PLAYER_SCALE * 3, 9);
  });

  it("reaches every creature the director mints, boss included", () => {
    const solo = floor({ players: 1, debug: { enemiesPerRoom: 1 } });
    solo.spawner.spawnFloorEnemies();
    const party = floor({ players: 4, debug: { enemiesPerRoom: 1 } });
    party.spawner.spawnFloorEnemies();

    const hpByType = (f: ReturnType<typeof floor>) => {
      const m = new Map<string, number>();
      for (const e of f.enemies.values()) m.set(e.state.enemyType, e.state.maxHealth);
      return m;
    };
    const a = hpByType(solo);
    const b = hpByType(party);

    let compared = 0;
    for (const [type, hp] of a) {
      if (!b.has(type)) continue;
      expect(b.get(type), type).toBeGreaterThan(hp);
      compared++;
    }
    expect(compared).toBeGreaterThan(0);
  });
});

describe("boss summons", () => {
  it("places a minion at the requested spot when it is walkable", () => {
    const f = floor({ debug: { enemiesPerRoom: 0 } });
    f.spawner.spawnFloorEnemies();
    const [bossId, boss] = [...f.enemies][0];
    const spot = { x: boss.state.x + 20, y: boss.state.y };

    f.spawner.summonEnemy(bossId, GooGreen, spot.x, spot.y);

    const minion = [...f.enemies.values()].find(e => e.state.enemyType === "goo-green")!;
    expect(minion.state.x).toBeCloseTo(spot.x, 5);
  });

  it("drops a minion on its summoner rather than inside a wall", () => {
    const f = floor({ debug: { enemiesPerRoom: 0 } });
    f.spawner.spawnFloorEnemies();
    const [bossId, boss] = [...f.enemies][0];

    f.spawner.summonEnemy(bossId, GooGreen, -5000, -5000); // off the map

    const minion = [...f.enemies.values()].find(e => e.state.enemyType === "goo-green")!;
    expect(minion.state.x).toBe(boss.state.x);
    expect(minion.state.y).toBe(boss.state.y);
  });

  it("joins the summoner's room, so the barrier holds until the adds are down too", () => {
    const f = floor({ debug: { enemiesPerRoom: 0 } });
    f.spawner.spawnFloorEnemies();
    const [bossId, boss] = [...f.enemies][0];

    f.spawner.summonEnemy(bossId, GooGreen, boss.state.x + 20, boss.state.y);

    const minionId = [...f.enemies].find(([, e]) => e.state.enemyType === "goo-green")![0];
    expect(f.floorManager.getEnemyRoom(minionId)).toBe(f.floorManager.getEnemyRoom(bossId));
  });
});

describe("showcase floors", () => {
  it("populates the showcased room but leaves its framing rooms clean", () => {
    for (const type of ["combat", "wave", "timed", "dark"] as RoomType[]) {
      const f = floor({ dungeonOpts: { showcaseRoomType: type } });
      f.spawner.spawnFloorEnemies();
      // The middle room is the showcased one — a showcase frames it with plain
      // combat rooms, so matching on type alone would find the framing room when
      // the showcased type IS combat.
      const showcased = f.dungeon.rooms.find(
        r => r.id !== f.dungeon.startRoomId && r.id !== f.dungeon.exitRoomId,
      )!;
      expect(showcased.type, type).toBe(type);
      const rooms = new Set([...f.enemies.keys()].map(id => f.floorManager.getEnemyRoom(id)));

      expect(rooms.has(showcased.id), type).toBe(true);
      expect(rooms.has(f.dungeon.startRoomId), type).toBe(false);
      expect(rooms.has(f.dungeon.exitRoomId), type).toBe(false);
    }
  });

  it("gives a boss showcase just the boss", () => {
    const f = floor({ dungeonOpts: { showcaseRoomType: "boss" } });
    f.spawner.spawnFloorEnemies();
    expect(f.enemies.size).toBe(1);
  });
});

describe("the party's own spawn points", () => {
  it("never leaves a player out of bounds, even where two share a tile", () => {
    // This is the assertion that matters about duplicate spawn points. The ring
    // in buildPlayerSpawns runs dry in a maze start room and stacks one pair
    // (see tests/shared/dungeon.test.ts) — so check what that actually COSTS:
    // spawn the real party at the real spawns and let the solver settle them.
    for (let seed = 1; seed <= 60; seed++) {
      const d = generateDungeon(seed);
      const physics = new PhysicsWorld(d.mapData, d.cols, d.rows);
      const party = d.playerSpawns.map(s => new Player(physics, s.x, s.y));

      for (let t = 0; t < 60; t++) {
        for (const p of party) p.commitVelocity();
        physics.step();
        for (const p of party) p.syncFromBody();
      }

      for (const p of party) {
        const tile = d.mapData[Math.floor(p.state.y / TILE_SIZE)]?.[Math.floor(p.state.x / TILE_SIZE)] as TileId | undefined;
        expect(tile, `seed ${seed}: player left the map`).toBeDefined();
        expect(TILE_PROPS[tile!].walkable, `seed ${seed}: player settled inside a wall`).toBe(true);
      }
    }
  });

  it("separates a stacked pair by a few pixels rather than flinging one away", () => {
    // Seed 6's start room is a maze corridor, so two of its four spawns are the
    // same tile. Matter resolves the overlap gently; nobody is teleported.
    const d = generateDungeon(6);
    const physics = new PhysicsWorld(d.mapData, d.cols, d.rows);
    const party = d.playerSpawns.map(s => new Player(physics, s.x, s.y));
    const start = party.map(p => ({ x: p.state.x, y: p.state.y }));
    expect(new Set(start.map(s => `${s.x},${s.y}`)).size).toBe(3); // the stacked pair

    for (let t = 0; t < 60; t++) {
      for (const p of party) p.commitVelocity();
      physics.step();
      for (const p of party) p.syncFromBody();
    }

    for (let i = 0; i < party.length; i++) {
      const moved = Math.hypot(party[i].state.x - start[i].x, party[i].state.y - start[i].y);
      expect(moved).toBeLessThan(TILE_SIZE); // nudged, not launched
    }
    // ...and they really did come apart.
    const ends = party.map(p => `${p.state.x.toFixed(1)},${p.state.y.toFixed(1)}`);
    expect(new Set(ends).size).toBe(4);
  });
});
