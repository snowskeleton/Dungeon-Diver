import Phaser from "phaser";
import { defineClips } from "./SpriteClips";

// Bat spritesheet: 96×16 = 6 cols × 1 row at 16×16px.
// Single row of wing-flap frames; displayed scaled up to 32×32.
// No directional variants; flip X for left-facing.

const FRAME_SIZE = 16;
const DISPLAY_SIZE = 32;
const COLS = 6;

export function batAnimKey(anim: "fly" | "death"): string {
  return `bat-${anim}`;
}

export function preloadBat(scene: Phaser.Scene) {
  scene.load.spritesheet("bat", "/sprites/bat.png", {
    frameWidth: FRAME_SIZE,
    frameHeight: FRAME_SIZE,
  });
}

export function defineBatAnimations(scene: Phaser.Scene) {
  defineClips(scene, "bat", {
    [batAnimKey("fly")]: {
      frames: Array.from({ length: COLS }, (_, i) => i),
      frameRate: 10,
      repeat: -1,
    },
    [batAnimKey("death")]: {
      frames: [5, 4, 3],
      frameRate: 8,
      repeat: 0,
    },
  });
}

export function isBatType(type: string): type is "bat" {
  return type === "bat";
}

export const BAT_DISPLAY_SIZE = DISPLAY_SIZE;
