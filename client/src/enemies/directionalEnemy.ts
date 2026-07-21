import Phaser from "phaser";
import { Facing, EnemyType } from "shared";
import { defineClips } from "../entities/SpriteClips";
import { ClientEnemyDef } from "./types";
import { ENEMY_SPRITE_GEOMETRY, frameRow } from "./spriteGeometry";

// Directional enemies (bones, kultist, the beasts, snakes) ship a 4-row sheet
// with one row per facing. Row order matches the humanoid sheets — verified for
// this art pack by checking that row 3 is a per-cell mirror of row 1.
//
// Never flipX these: left has its own row.

const ROW: Record<Facing, number> = { up: 0, right: 1, down: 2, left: 3 };
const FACINGS: Facing[] = ["up", "right", "down", "left"];

export interface DirectionalSpec {
  name: string;
  frameRate?: number;
  deathFrameRate?: number;
}

// Frame layout comes from ENEMY_SPRITE_GEOMETRY (see makeSheetEnemyDef).
export function makeDirectionalEnemyDef(id: EnemyType, spec: DirectionalSpec): ClientEnemyDef {
  const geo = ENEMY_SPRITE_GEOMETRY[id];
  const size = geo.displayW;
  const moveKey = (f: Facing) => `${id}-move-${f}`;
  const deathKey = `${id}-death`;

  return {
    name: spec.name,
    textureKey: id,
    displayW: size,
    displayH: size,
    preload: (scene) =>
      scene.load.spritesheet(id, `/sprites/${id}.png`, {
        frameWidth: geo.frameWidth,
        frameHeight: geo.frameHeight,
      }),
    defineAnimations: (scene) => {
      const clips: Record<string, { frames: number[]; frameRate: number; repeat: number }> = {};
      for (const f of FACINGS) {
        clips[moveKey(f)] = {
          frames: frameRow(geo.cols, ROW[f], 0, geo.cols),
          frameRate: spec.frameRate ?? 8,
          repeat: -1,
        };
      }
      // One death clip for every facing: the front-facing row, reversed.
      clips[deathKey] = {
        frames: frameRow(geo.cols, ROW.down, 0, geo.cols).reverse(),
        frameRate: spec.deathFrameRate ?? 6,
        repeat: 0,
      };
      defineClips(scene, id, clips);
    },
    resolve: ({ isDying, facing }) => ({
      key: isDying ? deathKey : moveKey(facing),
      flipX: false,
    }),
  };
}
