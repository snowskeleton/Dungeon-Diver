import { describe, it, expect } from "vitest";
import { TILE, TileId, TILE_SIZE, ROOM_W, ROOM_H, RoomData } from "shared";
import { FlowFieldSystem } from "../../engine/src/pathfinding/FlowFieldSystem";

// A single room occupying grid cell (0,0). Interior tiles are cols/rows 1..W-2.
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

/** A ROOM_W×ROOM_H all-floor map with WALL stamped at the given interior cells. */
function mapWithWalls(walls: Array<[number, number]>): TileId[][] {
  const map: TileId[][] = Array.from({ length: ROOM_H }, () =>
    Array.from({ length: ROOM_W }, () => TILE.FLOOR as TileId),
  );
  for (const [c, r] of walls) map[r][c] = TILE.WALL;
  return map;
}

const center = (tile: number) => tile * TILE_SIZE + TILE_SIZE / 2;

function fieldWith(walls: Array<[number, number]>, playerTile: [number, number]): FlowFieldSystem {
  const ff = new FlowFieldSystem(mapWithWalls(walls), [ROOM]);
  ff.rebuild(new Set(["0,0"]), [{ id: "p1", x: center(playerTile[0]), y: center(playerTile[1]) }]);
  return ff;
}

describe("FlowFieldSystem — open room", () => {
  it("points an enemy toward the player", () => {
    const ff = fieldWith([], [3, 3]);
    // Enemy east of the player should be sent west (negative dx).
    const h = ff.sample("ground", "0,0", "p1", center(15), center(3));
    expect(h).not.toBeNull();
    expect(h!.dx).toBeLessThan(0);
  });

  it("returns null on the player's own tile (no downhill step)", () => {
    const ff = fieldWith([], [3, 3]);
    expect(ff.sample("ground", "0,0", "p1", center(3), center(3))).toBeNull();
  });

  it("returns null when the enemy is outside the room interior", () => {
    const ff = fieldWith([], [3, 3]);
    // Row 0 is the border ring — not part of the interior grid.
    expect(ff.sample("ground", "0,0", "p1", center(3), center(0))).toBeNull();
  });

  it("has line of sight across open floor", () => {
    const ff = fieldWith([], [3, 3]);
    expect(ff.lineOfSight("ground", "0,0", center(3), center(3), center(15), center(3))).toBe(true);
  });
});

describe("FlowFieldSystem — cover wall", () => {
  // A vertical wall at col 10, rows 1..12, leaving a gap at rows 13-14.
  const wall: Array<[number, number]> = [];
  for (let r = 1; r <= 12; r++) wall.push([10, r]);

  it("blocks line of sight through the wall but not around it", () => {
    const ff = fieldWith(wall, [3, 3]);
    // Straight across the wall — blocked.
    expect(ff.lineOfSight("ground", "0,0", center(3), center(3), center(15), center(3))).toBe(false);
    // Along an open row on one side — clear.
    expect(ff.lineOfSight("ground", "0,0", center(3), center(3), center(3), center(10))).toBe(true);
  });

  it("routes a follower around the wall to the player without ever entering a wall tile", () => {
    const ff = fieldWith(wall, [3, 3]);
    const wallSet = new Set(wall.map(([c, r]) => `${c},${r}`));
    // Walk a virtual follower one tile per step along the gradient from the far side.
    let c = 15;
    let r = 3;
    let steps = 0;
    while (!(c === 3 && r === 3) && steps < 200) {
      const h = ff.sample("ground", "0,0", "p1", center(c), center(r));
      if (!h) break;
      c += h.dx;
      r += h.dy;
      expect(wallSet.has(`${c},${r}`)).toBe(false); // never steps onto the wall
      steps++;
    }
    // It reached the player's tile (routed through the bottom gap).
    expect([c, r]).toEqual([3, 3]);
  });

  it("air grid flies straight over cover (line of sight clear, gradient direct)", () => {
    const ff = fieldWith(wall, [3, 3]);
    // Cover is passable in the air, so the same straight shot is unobstructed.
    expect(ff.lineOfSight("air", "0,0", center(3), center(3), center(15), center(3))).toBe(true);
    // And the air gradient from the far side points straight west (dx < 0), unlike
    // the ground field which would first detour toward the gap.
    const h = ff.sample("air", "0,0", "p1", center(15), center(3));
    expect(h).not.toBeNull();
    expect(h!.dx).toBeLessThan(0);
  });
});
