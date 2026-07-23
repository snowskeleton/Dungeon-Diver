import { describe, it, expect } from "vitest";
import {
  TILE,
  TILE_SIZE,
  Layer,
  FOOT_OFFSET,
  ENTITY_RADIUS,
  PLAYER_BODY_PROFILE,
  ENEMY_BODY_PROFILE,
  CORPSE_SOLID_MASK,
  PLAYER_COMMITTED_SOLID_MASK,
  SERVER_TICK_MS,
  canAffect,
  PLAYER_ATTACK_AFFECTS,
  ENEMY_ATTACK_AFFECTS,
} from "shared";
import {
  PhysicsWorld,
  pxPerSecToVelocity,
  syncStateFromBody,
} from "../../server/src/physics/PhysicsWorld";
import { Player } from "../../server/src/entities/Player";
import { GooGreen } from "../../server/src/entities/enemies/goos";
import { flatWorld, flatMap, physicsTick, COLS, ROWS } from "../helpers/world";

// PhysicsWorld is the only file that touches matter-js, so the coordinate
// mapping and the px/sec conversion are tested here or nowhere.

describe("coordinate mapping", () => {
  it("puts the body at the sprite's FEET and reads the centre back", () => {
    const world = flatWorld();
    const body = world.createEntityBody(300, 400, Layer.PLAYER, PLAYER_BODY_PROFILE.solidMask);

    expect(body.position.x).toBe(300);
    expect(body.position.y).toBe(400 + FOOT_OFFSET);

    const state = { x: 0, y: 0 };
    syncStateFromBody(state, body);
    expect(state).toEqual({ x: 300, y: 400 });
  });

  it("round-trips a position through setEntityPosition", () => {
    const world = flatWorld();
    const body = world.createEntityBody(0, 0, Layer.PLAYER, PLAYER_BODY_PROFILE.solidMask);
    world.setEntityPosition(body, 512, 256);

    const state = { x: 0, y: 0 };
    syncStateFromBody(state, body);
    expect(state).toEqual({ x: 512, y: 256 });
  });

  it("zeroes velocity when teleporting, so a warp doesn't carry momentum", () => {
    const world = flatWorld();
    const body = world.createEntityBody(0, 0, Layer.PLAYER, PLAYER_BODY_PROFILE.solidMask);
    world.setVelocityPxPerSec(body, 500, 500);
    world.setEntityPosition(body, 300, 300);
    expect(body.velocity).toEqual({ x: 0, y: 0 });
  });
});

describe("velocity conversion", () => {
  it("converts px/sec to matter's per-frame units", () => {
    // Get this wrong and everything in the game moves ~3× off.
    expect(pxPerSecToVelocity(60)).toBe(1);
    expect(pxPerSecToVelocity(300)).toBe(5);
    expect(pxPerSecToVelocity(0)).toBe(0);
  });

  it("actually moves a body that far in a second of ticks", () => {
    const world = flatWorld();
    const body = world.createEntityBody(300, 300, Layer.PLAYER, PLAYER_BODY_PROFILE.solidMask);

    const ticks = Math.round(1000 / SERVER_TICK_MS);
    for (let i = 0; i < ticks; i++) {
      world.setVelocityPxPerSec(body, 100, 0);
      world.step();
    }

    expect(body.position.x - 300).toBeCloseTo(100, 0);
  });
});

describe("tile lookup", () => {
  it("reads the tile under a world position", () => {
    const map = flatMap();
    map[10][15] = TILE.SLIME;
    const world = new PhysicsWorld(map, COLS, ROWS);

    expect(world.tileAt(15 * TILE_SIZE + 16, 10 * TILE_SIZE + 16)).toBe(TILE.SLIME);
    expect(world.tileAt(14 * TILE_SIZE + 16, 10 * TILE_SIZE + 16)).toBe(TILE.FLOOR);
  });

  it("returns null outside the map rather than throwing", () => {
    const world = flatWorld();
    expect(world.tileAt(-1, -1)).toBeNull();
    expect(world.tileAt(1e6, 1e6)).toBeNull();
  });
});

describe("walls", () => {
  it("stop an entity walking into them", () => {
    const map = flatMap();
    for (let r = 0; r < ROWS; r++) map[r][15] = TILE.WALL;
    const world = new PhysicsWorld(map, COLS, ROWS);
    const p = new Player(world, 13 * TILE_SIZE, 10 * TILE_SIZE);

    for (let i = 0; i < 60; i++) {
      p.move(1, 0, 200);
      physicsTick(world, [p]);
    }

    expect(p.state.x).toBeLessThan(15 * TILE_SIZE);
  });

  it("leave a one-tile gap passable — ENTITY_RADIUS must stay small enough", () => {
    // The documented constraint: radius ≤ ~14 or 32px gaps close up.
    expect(ENTITY_RADIUS * 2).toBeLessThan(TILE_SIZE);

    const map = flatMap();
    for (let r = 0; r < ROWS; r++) map[r][15] = TILE.WALL;
    map[10][15] = TILE.FLOOR; // a single-tile doorway
    const world = new PhysicsWorld(map, COLS, ROWS);
    const p = new Player(world, 13 * TILE_SIZE + 16, 10 * TILE_SIZE + 16 - FOOT_OFFSET);

    for (let i = 0; i < 80; i++) {
      p.move(1, 0, 200);
      physicsTick(world, [p]);
    }

    expect(p.state.x).toBeGreaterThan(16 * TILE_SIZE);
  });

  it("are rebuilt when the floor changes", () => {
    const world = flatWorld();
    expect(world.tileAt(15 * TILE_SIZE + 16, 10 * TILE_SIZE + 16)).toBe(TILE.FLOOR);

    const map = flatMap();
    map[10][15] = TILE.WALL;
    world.rebuildWalls(map, COLS, ROWS);

    expect(world.tileAt(15 * TILE_SIZE + 16, 10 * TILE_SIZE + 16)).toBe(TILE.WALL);
  });
});

describe("entity separation", () => {
  it("pushes two overlapping bodies apart rather than letting them stack", () => {
    const world = flatWorld();
    const a = new Player(world, 300, 300);
    const b = new Player(world, 302, 300);

    for (let i = 0; i < 30; i++) physicsTick(world, [a, b]);

    expect(Math.hypot(a.state.x - b.state.x, a.state.y - b.state.y))
      .toBeGreaterThanOrEqual(ENTITY_RADIUS);
  });

  it("blocks a player against an enemy body", () => {
    const world = flatWorld();
    const p = new Player(world, 260, 300);
    const e = new GooGreen(world, 300, 300);

    for (let i = 0; i < 40; i++) {
      p.move(1, 0, 200);
      physicsTick(world, [p, e]);
    }

    expect(p.state.x).toBeLessThan(e.state.x);
  });

  it("lets a corpse be walked over — it keeps only its wall mask", () => {
    const world = flatWorld();
    const corpse = new GooGreen(world, 300, 300);
    world.setEntityDead(corpse.body);

    expect(corpse.body.collisionFilter.mask).toBe(CORPSE_SOLID_MASK);
    expect(canAffect(CORPSE_SOLID_MASK, Layer.PLAYER)).toBe(false);
    expect(canAffect(CORPSE_SOLID_MASK, Layer.WALL)).toBe(true);
  });

  it("never displaces a static body — a boss cannot be pushed around", () => {
    const world = flatWorld();
    const wall = new GooGreen(world, 340, 300);
    world.setBodyStatic(wall.body, true);
    const shover = new Player(world, 300, 300);

    for (let i = 0; i < 60; i++) {
      shover.move(1, 0, 300);
      physicsTick(world, [shover, wall]);
    }

    expect(wall.state.x).toBeCloseTo(340, 1);
  });
});

describe("collision profiles", () => {
  it("gives player and enemy bodies their own layer, both blocking everything solid", () => {
    expect(PLAYER_BODY_PROFILE.layer).toBe(Layer.PLAYER);
    expect(ENEMY_BODY_PROFILE.layer).toBe(Layer.ENEMY);
    for (const profile of [PLAYER_BODY_PROFILE, ENEMY_BODY_PROFILE]) {
      expect(canAffect(profile.solidMask, Layer.WALL)).toBe(true);
      expect(canAffect(profile.solidMask, Layer.PLAYER)).toBe(true);
      expect(canAffect(profile.solidMask, Layer.ENEMY)).toBe(true);
      // The body itself deals no damage — attacks are separate hit sources.
      expect(profile.affects).toBe(0);
    }
  });

  it("puts the created body on the layer and mask it was asked for", () => {
    const world = flatWorld();
    const body = world.createEntityBody(0, 0, Layer.ENEMY, Layer.WALL);
    expect(body.collisionFilter.category).toBe(Layer.ENEMY);
    expect(body.collisionFilter.mask).toBe(Layer.WALL);
  });

  it("adds and removes the exit-barrier bit as a player commits", () => {
    const world = flatWorld();
    const body = world.createEntityBody(0, 0, Layer.PLAYER, PLAYER_BODY_PROFILE.solidMask);

    world.setPlayerCommitted(body, true);
    expect(body.collisionFilter.mask).toBe(PLAYER_COMMITTED_SOLID_MASK);
    expect(canAffect(body.collisionFilter.mask!, Layer.BARRIER_EXIT)).toBe(true);

    world.setPlayerCommitted(body, false);
    expect(body.collisionFilter.mask).toBe(PLAYER_BODY_PROFILE.solidMask);
    expect(canAffect(body.collisionFilter.mask!, Layer.BARRIER_EXIT)).toBe(false);
  });
});

describe("barriers", () => {
  it("registers, reports, and removes a barrier", () => {
    const world = flatWorld();
    expect(world.barrierAt(400, 400)).toBe(false);

    world.addBarrier("b1", 400, 400, 32, 96);
    expect(world.barrierAt(400, 400)).toBe(true);
    expect(world.barrierAt(400, 300)).toBe(false); // outside the rect

    world.removeBarrier("b1");
    expect(world.barrierAt(400, 400)).toBe(false);
  });

  it("ignores a duplicate id rather than stacking two bodies", () => {
    const world = flatWorld();
    world.addBarrier("b1", 400, 400, 32, 96);
    world.addBarrier("b1", 800, 800, 32, 96);
    expect(world.barrierAt(800, 800)).toBe(false);
  });

  it("ignores removing a barrier that isn't there", () => {
    expect(() => flatWorld().removeBarrier("nope")).not.toThrow();
  });

  it("keeps solid props in the same map as barriers, so both stop an arrow", () => {
    const world = flatWorld();
    world.addSolidProp("chest", 400, 400, 26, 20);
    expect(world.barrierAt(400, 400)).toBe(true);
  });
});

describe("layer vocabulary", () => {
  it("gives every layer a distinct bit", () => {
    const values = Object.values(Layer).filter(v => typeof v === "number") as number[];
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) expect(v & (v - 1), `${v} is not a single bit`).toBe(0);
  });

  it("keeps WALL/PLAYER/ENEMY in the low three bits, as matter categories", () => {
    expect(Layer.WALL).toBe(1);
    expect(Layer.PLAYER).toBe(2);
    expect(Layer.ENEMY).toBe(4);
  });

  it("makes canAffect a plain directional bit test", () => {
    expect(canAffect(Layer.PLAYER | Layer.ENEMY, Layer.ENEMY)).toBe(true);
    expect(canAffect(Layer.PLAYER, Layer.ENEMY)).toBe(false);
    expect(canAffect(0, Layer.ENEMY)).toBe(false);
  });

  it("keeps the two teams' attack masks disjoint — no friendly fire", () => {
    expect(canAffect(PLAYER_ATTACK_AFFECTS, Layer.ENEMY)).toBe(true);
    expect(canAffect(PLAYER_ATTACK_AFFECTS, Layer.PLAYER)).toBe(false);
    expect(canAffect(ENEMY_ATTACK_AFFECTS, Layer.PLAYER)).toBe(true);
    expect(canAffect(ENEMY_ATTACK_AFFECTS, Layer.ENEMY)).toBe(false);
  });

  it("lets player attacks reach props, so breakables are already wired", () => {
    expect(canAffect(PLAYER_ATTACK_AFFECTS, Layer.PROP)).toBe(true);
  });
});
