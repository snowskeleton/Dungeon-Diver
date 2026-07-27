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
// wall and firing into/along it, that muzzle point used to land inside the wall
// tile, so the projectile was born blocked and died on its first sample — the
// shot silently never appeared. Entity.spawnProjectile now clamps the spawn back
// to the last walkable point along caster→muzzle.

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
