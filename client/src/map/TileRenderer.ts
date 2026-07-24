import Phaser from "phaser";
import { TileId, TILE_SIZE, TILE, RoomType, DungeonResult, roomCellAt } from "shared";
import {
  FLOOR_VARIANT_FRAMES,
  WALL_FRAME_BY_MASK,
  SPECIAL_FRAMES,
  FloorTheme,
} from "./tilesetFrames.generated";

const TILESET_KEY = "dungeon-tiles";

// Depth band for the map. Everything here sits below entities (2+) and the
// darkness overlay (5); the three layers only need to order against each other.
const DEPTH_FLOOR = 0;
const DEPTH_SHADOW = 0.05;
const DEPTH_WALL = 0.1;

/**
 * Which floor look a room type wears.
 *
 * An exhaustive switch, not a lookup table: adding a RoomType has to be a
 * compile error here, because the alternative is a new room type silently
 * inheriting stone and nobody noticing for a month.
 *
 * Combat, wave, timed and dark all map to plain stone deliberately — they are
 * all "a room with enemies in it", and giving each its own palette would spend
 * the player's attention on a distinction that doesn't exist. The themes mark
 * the rooms that genuinely mean something else.
 */
function themeFor(type: RoomType): FloorTheme {
  switch (type) {
    case "combat":
    case "wave":
    case "timed":
    case "dark":
      return "stone";
    case "maze":
      return "maze";
    case "shop":
      return "shop";
    case "shrine":
      return "shrine";
    case "chest":
      return "chest";
    case "boss":
      return "boss";
  }
}

/** Stable per-tile scatter. The same tile must pick the same variant every time
 *  the floor is rebuilt (a barrier update or a re-entered room), or the stones
 *  visibly reshuffle underfoot. */
function tileHash(col: number, row: number): number {
  let h = Math.imul(col, 0x27d4eb2d) ^ Math.imul(row, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return h >>> 0;
}

/** Mostly the base tile, with a detailed variant roughly one tile in six. Enough
 *  to kill the grid, little enough that the details don't read as clutter. A
 *  theme with a single frame (the SOA2 paneled floors, which already tile into a
 *  varied surface) just returns it. */
function floorVariant(frames: readonly number[], col: number, row: number): number {
  if (frames.length < 2) return frames[0];
  const h = tileHash(col, row);
  if (h % 6 !== 0) return frames[0];
  return frames[1 + ((h >>> 8) % (frames.length - 1))];
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

  const themeCache = new Map<string, FloorTheme>();
  const themeAt = (col: number, row: number): FloorTheme => {
    const cell = roomCellAt(col * TILE_SIZE + TILE_SIZE / 2, row * TILE_SIZE + TILE_SIZE / 2);
    let theme = themeCache.get(cell.id);
    if (theme === undefined) {
      theme = themeFor(dungeon.roomTypes.get(cell.id) ?? "combat");
      themeCache.set(cell.id, theme);
    }
    return theme;
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
      const frames = FLOOR_VARIANT_FRAMES[themeAt(col, row)];
      place(col, row, floorVariant(frames, col, row), DEPTH_FLOOR);

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
