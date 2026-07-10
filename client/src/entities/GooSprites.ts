import Phaser from "phaser";
import { ClipDef, defineClips } from "./SpriteClips";

// Goo spritesheets: 192×32 = 6 cols × 1 row at 32×32px.
// All 6 frames are a continuous walk/idle cycle — reused for all states.
// No directional variants; flip X for left-facing.

export type GooType = "goo-green" | "goo-blue" | "goo-gold";

const FRAME_SIZE = 32;
const COLS = 6;

const GOO_ANIM: ClipDef = {
  frames: Array.from({ length: COLS }, (_, i) => i),
  frameRate: 8,
  repeat: -1,
};

const GOO_DEATH_ANIM: ClipDef = {
  frames: [5, 4, 3, 2, 1, 0],
  frameRate: 6,
  repeat: 0,
};

export function gooAnimKey(type: GooType, anim: "move" | "death"): string {
  return `${type}-${anim}`;
}

export function resolveGooAnim(isDying: boolean): "move" | "death" {
  return isDying ? "death" : "move";
}

export function preloadGoo(scene: Phaser.Scene, type: GooType) {
  scene.load.spritesheet(type, `/sprites/${type}.png`, {
    frameWidth: FRAME_SIZE,
    frameHeight: FRAME_SIZE,
  });
}

export function defineGooAnimations(scene: Phaser.Scene, type: GooType) {
  defineClips(scene, type, {
    [gooAnimKey(type, "move")]:  GOO_ANIM,
    [gooAnimKey(type, "death")]: GOO_DEATH_ANIM,
  });
}

export function isGooType(type: string): type is GooType {
  return type === "goo-green" || type === "goo-blue" || type === "goo-gold";
}
