import Phaser from "phaser";
import { TILE_SIZE } from "shared";
import { defineClips } from "../entities/SpriteClips";
import { ClientEnemyDef } from "./types";

// Horizontal-facing enemies: the art has a single side view, mirrored with flipX
// for left. Most are one strip of frames (goos, bats); some sheets carry several
// rows (spider's idle/walk/jump) or several colour variants (float-skull), so the
// move frames can be given explicitly as sheet-wide frame indices.

export interface SheetSpec {
  name: string;
  /** Source cell width in px. */
  frameWidth: number;
  /** Source cell height. Defaults to frameWidth (square cells). */
  frameHeight?: number;
  /** Cells per sheet row — needed to turn (row, col) into a frame index. */
  cols: number;
  /** Defaults to a full first row: 0 … cols-1. */
  moveFrames?: number[];
  /** Defaults to one tile square. Small art (16px bats) is scaled up. */
  displayW?: number;
  displayH?: number;
  /** Share another enemy's sheet. Defaults to the enemy id. */
  textureKey?: string;
  frameRate?: number;
  /** Defaults to the move frames played backwards, which reads as a collapse. */
  death?: { frames: number[]; frameRate: number };
  /** True for flyers — the sprite is lifted by its synced airHeight and a shadow
   *  is drawn beneath it (see EnemyEntity). */
  airborne?: boolean;
}

/** Frame index of (row, col) on a sheet `cols` cells wide. */
export const frameAt = (cols: number, row: number, col: number) => row * cols + col;
/** `count` consecutive frame indices starting at (row, startCol). */
export const frameRow = (cols: number, row: number, startCol: number, count: number): number[] =>
  Array.from({ length: count }, (_, i) => frameAt(cols, row, startCol + i));

export function makeSheetEnemyDef(id: string, spec: SheetSpec): ClientEnemyDef {
  const textureKey = spec.textureKey ?? id;
  const frameHeight = spec.frameHeight ?? spec.frameWidth;
  const moveFrames = spec.moveFrames ?? Array.from({ length: spec.cols }, (_, i) => i);
  const death = spec.death ?? { frames: [...moveFrames].reverse(), frameRate: 6 };

  const moveKey = `${id}-move`;
  const deathKey = `${id}-death`;

  return {
    name: spec.name,
    textureKey,
    airborne: spec.airborne,
    displayW: spec.displayW ?? TILE_SIZE,
    displayH: spec.displayH ?? spec.displayW ?? TILE_SIZE,
    preload: (scene) =>
      scene.load.spritesheet(textureKey, `/sprites/${textureKey}.png`, {
        frameWidth: spec.frameWidth,
        frameHeight,
      }),
    defineAnimations: (scene) =>
      defineClips(scene, textureKey, {
        [moveKey]: { frames: moveFrames, frameRate: spec.frameRate ?? 8, repeat: -1 },
        [deathKey]: { frames: death.frames, frameRate: death.frameRate, repeat: 0 },
      }),
    resolve: ({ isDying, facing }) => ({
      key: isDying ? deathKey : moveKey,
      flipX: facing === "left",
    }),
  };
}
