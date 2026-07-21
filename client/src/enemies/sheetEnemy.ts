import Phaser from "phaser";
import { EnemyType } from "shared";
import { defineClips } from "../entities/SpriteClips";
import { ClientEnemyDef } from "./types";
import { ENEMY_SPRITE_GEOMETRY, frameAt, frameRow } from "./spriteGeometry";

export { frameAt, frameRow };

// Horizontal-facing enemies: the art has a single side view, mirrored with flipX
// for left. Most are one strip of frames (goos, bats); some sheets carry several
// rows (spider's idle/walk/jump) or several colour variants (float-skull), so the
// move frames can be given explicitly as sheet-wide frame indices.

export interface SheetSpec {
  name: string;
  /** Defaults to the locomotion frames played backwards, which reads as a collapse. */
  death?: { frames: number[]; frameRate: number };
  frameRate?: number;
  /** True for flyers — the sprite is lifted by its synced airHeight and a shadow
   *  is drawn beneath it (see EnemyEntity). */
  airborne?: boolean;
}

// Frame layout comes from ENEMY_SPRITE_GEOMETRY, never from the call site: that
// table is also what the hurtbox generator measures against, so the client can't
// render one layout while the server hit-tests another.
export function makeSheetEnemyDef(id: EnemyType, spec: SheetSpec): ClientEnemyDef {
  const geo = ENEMY_SPRITE_GEOMETRY[id];
  const { textureKey, frameHeight } = geo;
  const moveFrames = geo.frames;
  const death = spec.death ?? { frames: [...moveFrames].reverse(), frameRate: 6 };

  const moveKey = `${id}-move`;
  const deathKey = `${id}-death`;

  return {
    name: spec.name,
    textureKey,
    airborne: spec.airborne,
    displayW: geo.displayW,
    displayH: geo.displayH,
    preload: (scene) =>
      scene.load.spritesheet(textureKey, `/sprites/${textureKey}.png`, {
        frameWidth: geo.frameWidth,
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
