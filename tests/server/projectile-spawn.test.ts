import { describe, it, expect } from "vitest";
import {
  TILE,
  TILE_SIZE,
  TILE_PROPS,
  TileId,
  AMMO_REGISTRY,
  PLAYER_PROJECTILE_AFFECTS,
  SERVER_TICK_MS,
} from "shared";
import { PhysicsWorld } from "../../server/src/physics/PhysicsWorld";
import { Player } from "../../server/src/entities/Player";
import { Projectile } from "../../server/src/entities/Projectile";
import { flatMap, COLS, ROWS } from "../helpers/world";

// BUG B2 regression: a ranged shot spawns at a muzzle offset AHEAD of the caster
// so its swept-ellipse tail clears the shooter's body. Standing flush against a
// wall, that muzzle point used to land inside the wall tile, so the projectile was
// born blocked and died on its first sample — the shot silently never appeared.
// Entity.spawnProjectile now clamps the spawn back to the last walkable point
// along feet→muzzle.
//
// The real playtest repro was firing PARALLEL to a NORTH wall, not perpendicular
// into a wall: because the sprite centre sits FOOT_OFFSET(8) above the collision
// body (radius ENTITY_RADIUS(5)), pressing against a north wall leaves the feet
// clear but the sprite centre ~3px INSIDE the wall. The muzzle is taken at
// centre-height, so a sideways shot's muzzle is inside the wall — which is why the
// clamp must anchor at the (always-walkable) feet, not the sprite centre.

const arrow = AMMO_REGISTRY["arrow"];

/** The single queued projectile spawn point from an entity's effect buffer. */
function spawnPoint(entity: Player): { x: number; y: number } {
  const effects = entity.drainEffects();
  const proj = effects.find((e) => e.kind === "projectile");
  if (!proj || proj.kind !== "projectile") throw new Error("no projectile queued");
  return { x: proj.x, y: proj.y };
}

function walkable(physics: PhysicsWorld, x: number, y: number): boolean {
  const tile = physics.tileAt(x, y);
  if (tile === null) return false;
  return TILE_PROPS[tile as TileId].walkable && !physics.barrierAt(x, y);
}

describe("ranged spawn against a wall (BUG B2)", () => {
  it("clamps a muzzle that lands in a wall back to a walkable point", () => {
    const map = flatMap();
    map[10][15] = TILE.WALL;
    const physics = new PhysicsWorld(map, COLS, ROWS);
    // Player in the tile just left of the wall, aiming straight into it. The raw
    // muzzle (caster.x + MUZZLE_OFFSET) sits inside the wall tile.
    const px = 14 * TILE_SIZE + 16;
    const py = 10 * TILE_SIZE + 16;
    const player = new Player(physics, px, py, "ranger", "guy");

    // The muzzle a ranged spell would ask for: 18px to the right, into the wall.
    const muzzleX = px + 18;
    expect(walkable(physics, muzzleX, py)).toBe(false); // precondition: blocked

    player.spawnProjectile(arrow.id, muzzleX, py, 0);
    const spawn = spawnPoint(player);

    expect(walkable(physics, spawn.x, spawn.y)).toBe(true);
    // The clamped spawn is strictly nearer the caster than the wall-embedded muzzle.
    expect(spawn.x).toBeLessThan(muzzleX);
    expect(spawn.x).toBeGreaterThan(14 * TILE_SIZE); // still in the player's own tile

    // Contrast: born at the RAW muzzle a shot dies on its first swept sample (it
    // starts inside the wall). Born at the clamped spawn it lives long enough to
    // exist and travel — the whole point of the fix.
    const atMuzzle = new Projectile(physics, arrow, muzzleX, py, 0, "p1", PLAYER_PROJECTILE_AFFECTS);
    atMuzzle.tick(SERVER_TICK_MS);
    expect(atMuzzle.dead).toBe(true);

    const atSpawn = new Projectile(physics, arrow, spawn.x, spawn.y, 0, "p1", PLAYER_PROJECTILE_AFFECTS);
    expect(atSpawn.dead).toBe(false);
  });

  it("fires PARALLEL along a north wall, where the sprite centre is inside the wall", () => {
    // The playtest repro. A north wall on row 10; the player pressed against it so
    // the feet (state.y + FOOT_OFFSET) are in the walkable row below but the sprite
    // centre (state.y) is inside the wall tile.
    const map = flatMap();
    map[10][14] = TILE.WALL;
    map[10][15] = TILE.WALL;
    const physics = new PhysicsWorld(map, COLS, ROWS);
    const px = 14 * TILE_SIZE + 16;
    const py = 10 * TILE_SIZE + 29; // centre inside wall row 10 (320..352); feet at 357 → row 11
    const player = new Player(physics, px, py, "ranger", "guy");

    // Root-cause preconditions: the sprite CENTRE is in the wall, and so is the
    // sideways muzzle taken at centre height. Anchoring the search at the centre
    // (the pre-fix behaviour) could not recover from this.
    expect(walkable(physics, px, py)).toBe(false);
    const muzzleX = px + 18; // firing right, parallel to the wall
    expect(walkable(physics, muzzleX, py)).toBe(false);

    player.spawnProjectile(arrow.id, muzzleX, py, 0);
    const spawn = spawnPoint(player);

    // Clamped to a walkable point (down toward the feet), so the shot actually exists.
    expect(walkable(physics, spawn.x, spawn.y)).toBe(true);
    const atSpawn = new Projectile(physics, arrow, spawn.x, spawn.y, 0, "p1", PLAYER_PROJECTILE_AFFECTS);
    expect(atSpawn.dead).toBe(false);
  });

  it("leaves an unobstructed muzzle exactly where the spell asked", () => {
    const physics = new PhysicsWorld(flatMap(), COLS, ROWS);
    const px = 300;
    const py = 300;
    const player = new Player(physics, px, py, "ranger", "guy");

    player.spawnProjectile(arrow.id, px + 18, py, 0);
    const spawn = spawnPoint(player);

    expect(spawn.x).toBeCloseTo(px + 18, 6);
    expect(spawn.y).toBeCloseTo(py, 6);
  });

  it("clamps a muzzle blocked by a raised barrier too", () => {
    const physics = new PhysicsWorld(flatMap(), COLS, ROWS);
    // A locked-door barrier one tile to the right of the player.
    const px = 14 * TILE_SIZE + 8; // clear of the barrier body (spans 464..496)
    const py = 10 * TILE_SIZE + 16;
    physics.addBarrier("b1", 15 * TILE_SIZE, 10 * TILE_SIZE, TILE_SIZE, TILE_SIZE * 3);
    const player = new Player(physics, px, py, "ranger", "guy");

    const muzzleX = px + 30; // reaches into the barrier
    expect(physics.barrierAt(px, py)).toBe(false); // caster itself is clear
    expect(physics.barrierAt(muzzleX, py)).toBe(true); // precondition: muzzle blocked

    player.spawnProjectile(arrow.id, muzzleX, py, 0);
    const spawn = spawnPoint(player);
    expect(walkable(physics, spawn.x, spawn.y)).toBe(true);
  });
});
