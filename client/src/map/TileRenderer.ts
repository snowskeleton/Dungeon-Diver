import Phaser from "phaser";
import {
  TileId,
  TILE_SIZE,
  TILE,
  ROOM_W,
  ROOM_H,
  RoomData,
  DungeonResult,
  roomCellAt,
} from "shared";
import {
  FLOOR_FRAMES,
  WALL_FRAME_BY_MASK,
  SPECIAL_FRAMES,
  BLOCK_FRAMES,
} from "./tilesetFrames.generated";

const TILESET_KEY = "dungeon-tiles";

// Depth band for the map. Everything here sits below entities (2+) and the
// darkness overlay (5); the three layers only need to order against each other.
const DEPTH_FLOOR = 0;
const DEPTH_SHADOW = 0.05;
const DEPTH_WALL = 0.1;

// Room interior in cells (the walkable box, excluding the 1-tile wall ring).
const IW = ROOM_W - 2;
const IH = ROOM_H - 2;

type FloorSize = "tiny" | "regular" | "large";

/**
 * How a room lays out its flagstone sizes. The floor is one colour set, so a
 * room reads as different from its neighbour through the SIZE of its stones, not
 * colour — the whole thing one size, a small-stone rim around big inner slabs,
 * or a size change down the middle. Picked per room from its id so it's stable.
 */
type FloorPlan =
  | { kind: "uniform"; size: FloorSize }
  | { kind: "rim"; rim: FloorSize; inner: FloorSize }
  | { kind: "halfH"; top: FloorSize; bottom: FloorSize }
  | { kind: "halfV"; left: FloorSize; right: FloorSize };

const FLOOR_PLANS: FloorPlan[] = [
  { kind: "uniform", size: "regular" },
  { kind: "uniform", size: "regular" },
  { kind: "uniform", size: "large" },
  { kind: "uniform", size: "tiny" },
  { kind: "rim", rim: "tiny", inner: "large" },
  { kind: "rim", rim: "tiny", inner: "regular" },
  { kind: "rim", rim: "regular", inner: "large" },
  { kind: "halfV", left: "regular", right: "large" },
  { kind: "halfH", top: "tiny", bottom: "regular" },
];

/** Stable hash so the floor never reshuffles when a room is rebuilt (a barrier
 *  update, a re-entered room). */
function hash2(a: number, b: number): number {
  let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return h >>> 0;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The stone size at an interior cell (ic, ir are 0-based from the interior's
 *  top-left) under a plan. Rim thickness is 2 (even) so large inner blocks stay
 *  aligned to the 2×2 grid. */
function sizeAt(plan: FloorPlan, ic: number, ir: number): FloorSize {
  switch (plan.kind) {
    case "uniform":
      return plan.size;
    case "rim": {
      const onRim = ic < 2 || ir < 2 || ic >= IW - 2 || ir >= IH - 2;
      return onRim ? plan.rim : plan.inner;
    }
    case "halfV":
      return ic < IW / 2 ? plan.left : plan.right;
    case "halfH":
      return ir < IH / 2 ? plan.top : plan.bottom;
  }
}

/** The texture key + frame BarrierOverlays draws over a locked doorway. It comes
 *  out of the tileset like everything else now — it used to be a red rectangle
 *  drawn with Graphics at boot, which is why locked doors looked like a debug
 *  overlay rather than part of the dungeon. */
export const BARRIER_TEXTURE = TILESET_KEY;
export const BARRIER_FRAME = SPECIAL_FRAMES.barrier;

export function preloadTiles(scene: Phaser.Scene) {
  scene.load.spritesheet(TILESET_KEY, "/sprites/dungeon-tiles.png", {
    frameWidth: TILE_SIZE,
    frameHeight: TILE_SIZE,
  });
}

export function buildMap(scene: Phaser.Scene, dungeon: DungeonResult): Phaser.GameObjects.Group {
  const group = scene.add.group();
  const { mapData, rows, cols } = { mapData: dungeon.mapData, rows: dungeon.rows, cols: dungeon.cols };

  /** Out of bounds counts as wall, so the dungeon's outer edge doesn't grow a
   *  lit rim facing a void the player can never stand in. */
  const isWall = (col: number, row: number): boolean => {
    if (col < 0 || row < 0 || col >= cols || row >= rows) return true;
    return mapData[row][col] === TILE.WALL;
  };

  const roomById = new Map<string, RoomData>();
  for (const room of dungeon.rooms) roomById.set(room.id, room);
  const planCache = new Map<string, FloorPlan>();

  /** Choose the frame for one floor cell: find its room, its size under that
   *  room's plan, and a scattered variant. `large` cells resolve to one quadrant
   *  of a 2×2 stone; if the cell's 2×2 block would be clipped (room edge / odd
   *  dimension) it falls back to a regular stone so no half-slabs appear. */
  const floorFrameAt = (col: number, row: number): number => {
    const id = roomCellAt(col * TILE_SIZE + TILE_SIZE / 2, row * TILE_SIZE + TILE_SIZE / 2).id;
    const room = roomById.get(id);
    if (!room) return FLOOR_FRAMES.regular[hash2(col, row) % FLOOR_FRAMES.regular.length];

    let plan = planCache.get(id);
    if (!plan) {
      plan = FLOOR_PLANS[hashStr(id) % FLOOR_PLANS.length];
      planCache.set(id, plan);
    }

    // Interior-relative cell (excludes the wall ring). Doorway/corridor tiles
    // fall outside the interior box — give them a plain regular stone.
    const ic = col - (room.tileCol + 1);
    const ir = row - (room.tileRow + 1);
    if (ic < 0 || ir < 0 || ic >= IW || ir >= IH) {
      return FLOOR_FRAMES.regular[hash2(col, row) % FLOOR_FRAMES.regular.length];
    }

    let size = sizeAt(plan, ic, ir);
    if (size === "large") {
      // A large stone is 48px and tiles on a 3×3-cell block. The block this cell
      // belongs to is anchored to the interior grid; it must be fully inside the
      // interior AND entirely `large`, or a partial block would show clipped
      // stones — so those cells fall back to a regular stone instead.
      const bic = ic - (ic % 3);
      const bir = ir - (ir % 3);
      let blockComplete = bic + 2 < IW && bir + 2 < IH;
      for (let dy = 0; dy < 3 && blockComplete; dy++) {
        for (let dx = 0; dx < 3; dx++) {
          if (sizeAt(plan, bic + dx, bir + dy) !== "large") {
            blockComplete = false;
            break;
          }
        }
      }
      if (blockComplete) {
        const set = FLOOR_FRAMES.large[hash2(bic, bir) % FLOOR_FRAMES.large.length];
        const quadrant = (ir % 3) * 3 + (ic % 3);
        return set[quadrant];
      }
      size = "regular";
    }
    const pool = size === "tiny" ? FLOOR_FRAMES.tiny : FLOOR_FRAMES.regular;
    return pool[hash2(col, row) % pool.length];
  };

  /** A wall tile that sits INSIDE a room's interior is an obstacle the level
   *  designer placed (a cover block / tetris piece), not part of the room's
   *  structural shell — so it gets a block tile, not brick autotiling. Returns
   *  the block frame, or null for structural walls (perimeter ring, the void
   *  between rooms). */
  const coverBlockFrameAt = (col: number, row: number): number | null => {
    const id = roomCellAt(col * TILE_SIZE + TILE_SIZE / 2, row * TILE_SIZE + TILE_SIZE / 2).id;
    const room = roomById.get(id);
    if (!room) return null;
    const ic = col - (room.tileCol + 1);
    const ir = row - (room.tileRow + 1);
    if (ic < 0 || ir < 0 || ic >= IW || ir >= IH) return null;
    return BLOCK_FRAMES[hash2(col, row) % BLOCK_FRAMES.length];
  };

  const place = (col: number, row: number, frame: number, depth: number) => {
    const img = scene.add.image(
      col * TILE_SIZE + TILE_SIZE / 2,
      row * TILE_SIZE + TILE_SIZE / 2,
      TILESET_KEY,
      frame,
    );
    img.setDepth(depth);
    group.add(img);
    return img;
  };

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tileId: TileId = mapData[row][col];

      if (tileId === TILE.WALL) {
        // An obstacle placed inside a room reads as a block, not as more of the
        // room's brick shell.
        const blockFrame = coverBlockFrameAt(col, row);
        if (blockFrame !== null) {
          place(col, row, blockFrame, DEPTH_WALL);
          continue;
        }
        // Autotile: the eight neighbours pick the frame, so edges, outer corners
        // and inner corners all fall out of the geometry rather than being
        // authored per room shape.
        const mask =
          (isWall(col, row - 1) ? 1 : 0) |
          (isWall(col + 1, row - 1) ? 2 : 0) |
          (isWall(col + 1, row) ? 4 : 0) |
          (isWall(col + 1, row + 1) ? 8 : 0) |
          (isWall(col, row + 1) ? 16 : 0) |
          (isWall(col - 1, row + 1) ? 32 : 0) |
          (isWall(col - 1, row) ? 64 : 0) |
          (isWall(col - 1, row - 1) ? 128 : 0);
        place(col, row, WALL_FRAME_BY_MASK[mask], DEPTH_WALL);
        continue;
      }

      // Every walkable tile gets a floor underneath it, and the special tiles
      // are drawn on top. That way a stairwell or a trap sits IN the room's
      // stone instead of replacing a square of it.
      place(col, row, floorFrameAt(col, row), DEPTH_FLOOR);

      if (isWall(col, row - 1)) place(col, row, SPECIAL_FRAMES.wallShadow, DEPTH_SHADOW);

      switch (tileId) {
        case TILE.FLOOR:
          break;

        case TILE.STAIRS:
          // No tween. This used to pulse and scale, which read as a magic rune;
          // the art is a stairwell now and standing still is what makes it read
          // as architecture.
          place(col, row, SPECIAL_FRAMES.stairs, DEPTH_SHADOW);
          break;

        case TILE.TRAP:
          place(col, row, SPECIAL_FRAMES.trap, DEPTH_SHADOW);
          break;

        case TILE.BOSS_FLOOR: {
          const img = place(col, row, SPECIAL_FRAMES.bossFloor, DEPTH_SHADOW);
          breathe(scene, img, { from: 0.62, to: 1.0 }, 900 + Math.random() * 300);
          break;
        }

        case TILE.FIRE: {
          const img = place(col, row, SPECIAL_FRAMES.fire, DEPTH_SHADOW);
          breathe(scene, img, { from: 0.7, to: 1 }, 300 + Math.random() * 200);
          break;
        }

        case TILE.SLIME:
          place(col, row, SPECIAL_FRAMES.slime, DEPTH_SHADOW);
          break;
      }
    }
  }

  return group;
}

/** An endlessly repeating alpha pulse. The repeat:-1 tween outlives its image
 *  unless explicitly killed — group.destroy(true) on a floor change destroys the
 *  images, but the TweenManager would keep ticking them forever. */
function breathe(
  scene: Phaser.Scene,
  img: Phaser.GameObjects.Image,
  alpha: { from: number; to: number },
  duration: number,
) {
  img.once(Phaser.GameObjects.Events.DESTROY, () => scene.tweens.killTweensOf(img));
  scene.tweens.add({
    targets: img,
    alpha,
    duration,
    yoyo: true,
    repeat: -1,
    ease: "Sine.easeInOut",
  });
}
