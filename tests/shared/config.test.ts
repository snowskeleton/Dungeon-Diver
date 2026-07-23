import { describe, it, expect } from "vitest";
import {
  TILE,
  TILE_PROPS,
  TILE_SIZE,
  TileId,
  tileCenter,
  SERVER_TICK_MS,
  TRAP_MIN_FLOORS,
  TRAP_MAX_FLOORS,
  ENTITY_RADIUS,
  FOOT_OFFSET,
  CHARACTER_REGISTRY,
  CharacterClass,
  getCharacterConfig,
  WEAPON_REGISTRY,
  DEFAULT_DEBUG_CONFIG,
  DebugConfig,
  toDungeonOptions,
  isRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  MAX_ROOM_NAME_LEN,
  MAX_PLAYER_NAME_LEN,
  MAP_SEED,
  MAP_DATA,
  MAP_COLS,
  MAP_ROWS,
  DUNGEON_PLAYER_SPAWNS,
  generateDungeon,
} from "shared";

describe("tiles", () => {
  it("gives every tile id properties", () => {
    for (const id of Object.values(TILE)) {
      expect(TILE_PROPS[id as TileId], `tile ${id}`).toBeDefined();
    }
  });

  it("makes only walls unwalkable", () => {
    for (const [id, props] of Object.entries(TILE_PROPS)) {
      expect(props.walkable, `tile ${id}`).toBe(Number(id) !== TILE.WALL);
    }
  });

  it("gives a damage tile an amount and a slow tile a multiplier", () => {
    for (const props of Object.values(TILE_PROPS)) {
      if (props.effect === "damage") {
        expect(props.effectAmount).toBeGreaterThan(0);
      }
      if (props.effect === "slow") {
        expect(props.speedMultiplier).toBeGreaterThan(0);
        expect(props.speedMultiplier).toBeLessThan(1);
      }
    }
  });

  it("leaves the trap with no per-entity effect — the warp is a floor event", () => {
    expect(TILE_PROPS[TILE.TRAP].effect).toBeUndefined();
    expect(TILE_PROPS[TILE.TRAP].walkable).toBe(true);
  });

  it("centres a tile at its middle, not its corner", () => {
    expect(tileCenter(0, 0)).toEqual({ x: TILE_SIZE / 2, y: TILE_SIZE / 2 });
    expect(tileCenter(3, 4)).toEqual({
      x: 3 * TILE_SIZE + TILE_SIZE / 2,
      y: 4 * TILE_SIZE + TILE_SIZE / 2,
    });
  });
});

describe("cross-cutting constants", () => {
  it("keeps the tick rate a sane simulation step", () => {
    expect(SERVER_TICK_MS).toBeGreaterThan(0);
    expect(1000 / SERVER_TICK_MS).toBeGreaterThanOrEqual(10); // at least 10 Hz
  });

  it("keeps the collision circle small enough for a one-tile gap", () => {
    expect(ENTITY_RADIUS * 2).toBeLessThan(TILE_SIZE);
    expect(ENTITY_RADIUS).toBeGreaterThan(0);
  });

  it("offsets the body below the sprite centre, at the feet", () => {
    expect(FOOT_OFFSET).toBeGreaterThan(0);
  });

  it("makes a trap warp forward by a real, bounded number of floors", () => {
    expect(TRAP_MIN_FLOORS).toBeGreaterThanOrEqual(1);
    expect(TRAP_MAX_FLOORS).toBeGreaterThanOrEqual(TRAP_MIN_FLOORS);
  });
});

describe("character classes", () => {
  const classes = Object.keys(CHARACTER_REGISTRY) as CharacterClass[];

  it("registers all four classes under their own id", () => {
    expect(classes).toHaveLength(4);
    for (const cls of classes) {
      expect(CHARACTER_REGISTRY[cls].id).toBe(cls);
      expect(getCharacterConfig(cls)).toBe(CHARACTER_REGISTRY[cls]);
    }
  });

  it("gives every class a name, a viable stat line, and a real starting weapon", () => {
    for (const cls of classes) {
      const c = CHARACTER_REGISTRY[cls];
      expect(c.name.length, cls).toBeGreaterThan(0);
      expect(c.maxHp, cls).toBeGreaterThan(0);
      expect(c.speed, cls).toBeGreaterThan(0);
      expect(WEAPON_REGISTRY[c.defaultWeaponId], `${cls} → ${c.defaultWeaponId}`).toBeDefined();
    }
  });

  it("differentiates the roster — they are not four reskins", () => {
    const hp = new Set(classes.map(c => CHARACTER_REGISTRY[c].maxHp));
    const speed = new Set(classes.map(c => CHARACTER_REGISTRY[c].speed));
    const weapons = new Set(classes.map(c => CHARACTER_REGISTRY[c].defaultWeaponId));
    expect(hp.size + speed.size).toBeGreaterThan(2);
    expect(weapons.size).toBe(4);
  });

  it("gives the tank more HP than the glass cannon", () => {
    expect(CHARACTER_REGISTRY.knight.maxHp).toBeGreaterThan(CHARACTER_REGISTRY.mage.maxHp);
  });
});

describe("debug config", () => {
  const cfg = (over: Partial<DebugConfig> = {}): DebugConfig => ({ ...DEFAULT_DEBUG_CONFIG, ...over });

  it("defaults to off, which means play the real game", () => {
    expect(DEFAULT_DEBUG_CONFIG.enabled).toBe(false);
    expect(toDungeonOptions(DEFAULT_DEBUG_CONFIG)).toEqual({});
  });

  it("ignores every other knob while disabled", () => {
    expect(toDungeonOptions(cfg({ enabled: false, gridCols: 9, roomType: "boss" }))).toEqual({});
  });

  it("passes the grid through when enabled", () => {
    const opts = toDungeonOptions(cfg({ enabled: true, gridCols: 3, gridRows: 2 }));
    expect(opts.gridCols).toBe(3);
    expect(opts.gridRows).toBe(2);
    expect(opts.forceRoomType).toBeNull(); // "random"
  });

  it("forces a room type across a multi-room grid", () => {
    const opts = toDungeonOptions(cfg({ enabled: true, roomType: "maze" }));
    expect(opts.forceRoomType).toBe("maze");
    expect(opts.showcaseRoomType).toBeUndefined();
  });

  it("expands a single room + a chosen type into a 3-room showcase", () => {
    // Otherwise a shop/shrine/boss room is tested with no spawn point and no exit.
    const opts = toDungeonOptions(cfg({ enabled: true, gridCols: 1, gridRows: 1, roomType: "shop" }));
    expect(opts.showcaseRoomType).toBe("shop");
    expect(opts.forceRoomType).toBeUndefined();
    expect(opts.gridCols).toBeUndefined();
  });

  it("leaves a single RANDOM room as a plain 1×1 grid", () => {
    const opts = toDungeonOptions(cfg({ enabled: true, gridCols: 1, gridRows: 1 }));
    expect(opts.showcaseRoomType).toBeUndefined();
    expect(opts.gridCols).toBe(1);
    expect(opts.minRooms).toBe(1);
  });

  it("never asks for more minimum rooms than the grid can hold", () => {
    for (const [c, r] of [[1, 1], [2, 1], [2, 2], [5, 4]]) {
      const opts = toDungeonOptions(cfg({ enabled: true, gridCols: c, gridRows: r }));
      expect(opts.minRooms!).toBeLessThanOrEqual(c * r);
    }
  });

  it("carries the boss and stairs toggles through", () => {
    const opts = toDungeonOptions(cfg({ enabled: true, includeBoss: false, includeStairs: false }));
    expect(opts.includeBoss).toBe(false);
    expect(opts.includeStairs).toBe(false);
  });

  it("survives a JSON round trip, which is how it reaches the client", () => {
    const original = cfg({ enabled: true, roomType: "shrine", enemyTypes: ["bat"], startingUpgrades: ["iron-skin"] });
    expect(JSON.parse(JSON.stringify(original))).toEqual(original);
  });
});

describe("room codes", () => {
  it("excludes the character pairs people misread", () => {
    for (const c of "O0I1") expect(ROOM_CODE_ALPHABET).not.toContain(c);
  });

  it("accepts a well-formed code in either case", () => {
    const code = ROOM_CODE_ALPHABET.slice(0, ROOM_CODE_LENGTH);
    expect(isRoomCode(code)).toBe(true);
    expect(isRoomCode(code.toLowerCase())).toBe(true);
  });

  it("rejects the wrong length or an illegal character", () => {
    expect(isRoomCode("")).toBe(false);
    expect(isRoomCode("ABC")).toBe(false);
    expect(isRoomCode("ABCDE")).toBe(false);
    expect(isRoomCode("ABC0")).toBe(false); // 0 is not in the alphabet
    expect(isRoomCode("AB-D")).toBe(false);
  });

  it("offers a code space big enough that collisions are worth retrying against", () => {
    expect(ROOM_CODE_ALPHABET.length ** ROOM_CODE_LENGTH).toBeGreaterThan(500_000);
  });

  it("clamps names to lengths a UI can render", () => {
    expect(MAX_ROOM_NAME_LEN).toBeGreaterThan(0);
    expect(MAX_PLAYER_NAME_LEN).toBeGreaterThan(0);
  });
});

describe("the shipped floor-1 map", () => {
  it("is exactly what the declared seed generates", () => {
    // Client and server both import this rather than each rolling their own.
    expect(typeof MAP_SEED).toBe("number");
    expect(MAP_DATA).toEqual(generateDungeon(MAP_SEED).mapData);
    expect(MAP_DATA).toHaveLength(MAP_ROWS);
    expect(MAP_DATA[0]).toHaveLength(MAP_COLS);
  });

  it("spawns the party on walkable ground", () => {
    for (const s of DUNGEON_PLAYER_SPAWNS) {
      const tile = MAP_DATA[Math.floor(s.y / TILE_SIZE)][Math.floor(s.x / TILE_SIZE)];
      expect(TILE_PROPS[tile].walkable).toBe(true);
    }
  });
});
