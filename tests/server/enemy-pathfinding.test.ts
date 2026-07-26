import { describe, it, expect } from "vitest";
import {
  TILE,
  TileId,
  TILE_SIZE,
  ROOM_W,
  ROOM_H,
  RoomData,
  SERVER_TICK_MS,
  roomInteriorRect,
} from "shared";
import { PhysicsWorld } from "../../server/src/physics/PhysicsWorld";
import { PlayerState } from "../../server/src/schema/PlayerState";
import { GooGreen } from "../../server/src/entities/enemies/goos";
import { Bat } from "../../server/src/entities/enemies/bats";
import { FlowFieldSystem } from "../../server/src/pathfinding/FlowFieldSystem";
import { physicsTick } from "../helpers/world";

const ROOM: RoomData = {
  id: "0,0",
  gx: 0,
  gy: 0,
  tileCol: 0,
  tileRow: 0,
  centerCol: 10,
  centerRow: 8,
  type: "combat",
};

const center = (tile: number) => tile * TILE_SIZE + TILE_SIZE / 2;

function player(x: number, y: number): PlayerState {
  const p = new PlayerState();
  p.x = x;
  p.y = y;
  return p;
}

describe("Enemy aggro — pickTarget via threat", () => {
  it("chases the nearest player, then flips to whoever deals it enough damage", () => {
    const enemy = new GooGreen(new PhysicsWorld(mapFloor(), ROOM_W, ROOM_H), center(10), center(8));
    // A is close, B is far (both inside the 360px aggro radius).
    const players = new Map<string, PlayerState>([
      ["A", player(center(11), center(8))],
      ["B", player(center(16), center(8))],
    ]);

    enemy.tick(players, SERVER_TICK_MS);
    expect(enemy.state.targetId).toBe("A"); // nearest wins with no threat

    // B lands a series of hits — threat overtakes A's proximity edge.
    for (let i = 0; i < 4; i++) enemy.registerThreat("B", 20);
    enemy.tick(players, SERVER_TICK_MS);
    expect(enemy.state.targetId).toBe("B");

    // With no further damage, B's threat decays and attention returns to A.
    for (let i = 0; i < 120; i++) enemy.tick(players, SERVER_TICK_MS);
    expect(enemy.state.targetId).toBe("A");
  });
});

describe("Walker pathfinding — routes around a cover block instead of wedging", () => {
  it("reaches a player on the far side of a wall via the gap", () => {
    // Wall at col 10, rows 2..14, leaving a 1-tile corridor at row 1 (the top).
    const walls: Array<[number, number]> = [];
    for (let r = 2; r <= 14; r++) walls.push([10, r]);
    const map = mapFloor(walls);
    const physics = new PhysicsWorld(map, ROOM_W, ROOM_H);
    const ff = new FlowFieldSystem(map, [ROOM]);

    const target = player(center(6), center(6));
    const players = new Map<string, PlayerState>([["p1", target]]);

    const enemy = new GooGreen(physics, center(14), center(10));
    enemy.confineTo(roomInteriorRect(ROOM));
    enemy.setNavigation(ff, "0,0");

    // Line of sight is blocked at the start, so a beeline would grind the wall.
    expect(ff.lineOfSight("ground", "0,0", enemy.state.x, enemy.state.y, target.x, target.y)).toBe(false);

    let reached = false;
    for (let t = 0; t < 1000; t++) {
      ff.rebuild(new Set(["0,0"]), [{ id: "p1", x: target.x, y: target.y }]);
      enemy.tick(players, SERVER_TICK_MS);
      physicsTick(physics, [enemy]);
      if (Math.hypot(enemy.state.x - target.x, enemy.state.y - target.y) < 40) {
        reached = true;
        break;
      }
    }
    expect(reached).toBe(true);
    // It genuinely crossed to the player's side of the wall.
    expect(enemy.state.x).toBeLessThan(center(10));
  });
});

describe("Flyer collision — flies over interior cover", () => {
  // Drive an enemy straight east into the middle of a 3-tall cover wall at col 10.
  // A tall flat face (not a lone tile) so the walker can't just slide off a
  // chamfered corner — this isolates "flies over" from "rounds the corner".
  function pushThrough(makeEnemy: (p: PhysicsWorld) => GooGreen | Bat): number {
    const map = mapFloor([[10, 7], [10, 8], [10, 9]]);
    const physics = new PhysicsWorld(map, ROOM_W, ROOM_H);
    const enemy = makeEnemy(physics);
    for (let t = 0; t < 120; t++) {
      enemy.move(1, 0, 300);
      physicsTick(physics, [enemy]);
    }
    return enemy.state.x;
  }

  it("a flyer passes the cover block while a walker is stopped by it", () => {
    const coverLeftEdge = 10 * TILE_SIZE; // x = 320
    const coverRightEdge = 11 * TILE_SIZE; // x = 352

    const batX = pushThrough((p) => new Bat(p, center(7), center(8)));
    const gooX = pushThrough((p) => new GooGreen(p, center(7), center(8)));

    expect(batX).toBeGreaterThan(coverRightEdge); // flew over cover
    expect(gooX).toBeLessThan(coverLeftEdge); // wedged against it
  });
});

describe("Cover corners are chamfered — bodies slide off instead of deadlocking", () => {
  it("an enemy driven diagonally at a cover corner rounds it rather than sticking", () => {
    // Single cover block at (10,8): x∈[320,352], y∈[256,288]; its bottom-right
    // corner is (352,288). Drive an enemy up-and-left straight at that corner —
    // on a sharp corner the round body wedges on the apex and never progresses.
    const map = mapFloor([[10, 8]]);
    const physics = new PhysicsWorld(map, ROOM_W, ROOM_H);
    const enemy = new GooGreen(physics, 366, 302);
    for (let t = 0; t < 200; t++) {
      enemy.move(-1, -1, 120);
      physicsTick(physics, [enemy]);
    }
    // It slid past the corner and cleared the block (well left of the block or above
    // it), rather than stalling in the corner pocket around (352, 288).
    const cleared = enemy.state.x < 320 || enemy.state.y < 256;
    expect(cleared).toBe(true);
  });
});

/** A ROOM_W×ROOM_H all-floor map with optional WALL cells. */
function mapFloor(walls: Array<[number, number]> = []): TileId[][] {
  const map: TileId[][] = Array.from({ length: ROOM_H }, () =>
    Array.from({ length: ROOM_W }, () => TILE.FLOOR as TileId),
  );
  for (const [c, r] of walls) map[r][c] = TILE.WALL;
  return map;
}
