import Phaser from "phaser";
import { Facing, CharacterType } from "shared";
import { CharacterAction, CharacterSpriteConfig } from "./Entity";
import { defineClips } from "./SpriteClips";

// All humanoid spritesheets share the same 15-col × 4-row layout at 32×32px.
// Row 0=Up  Row 1=Right  Row 2=Down  Row 3=Left
// Cols 0-3=Idle  4-7=Walk  8-11=Attack  12=Stunned  13=Burned  14=Bleeding

const FRAME_SIZE = 32;
const COLS = 15;

const frameAt = (row: number, col: number) => row * COLS + col;
const frameRange = (row: number, startCol: number, count: number): number[] =>
  Array.from({ length: count }, (_, i) => frameAt(row, startCol + i));

const ROW: Record<Facing, number> = { up: 0, right: 1, down: 2, left: 3 };

export function humanoidAnimKey(type: CharacterType, action: string, facing: Facing): string {
  return `${type}-${action}-${facing}`;
}

export function preloadHumanoid(scene: Phaser.Scene, type: CharacterType) {
  scene.load.spritesheet(type, `/sprites/${type}.png`, {
    frameWidth: FRAME_SIZE,
    frameHeight: FRAME_SIZE,
  });
}

export function defineHumanoidAnimations(scene: Phaser.Scene, type: CharacterType) {
  const facings: Facing[] = ["up", "right", "down", "left"];
  for (const facing of facings) {
    const r = ROW[facing];
    defineClips(scene, type, {
      [humanoidAnimKey(type, "idle", facing)]:   { frames: frameRange(r, 0, 4),  frameRate: 6,  repeat: -1 },
      [humanoidAnimKey(type, "walk", facing)]:   { frames: frameRange(r, 4, 4),  frameRate: 8,  repeat: -1 },
      [humanoidAnimKey(type, "attack", facing)]: { frames: frameRange(r, 8, 4),  frameRate: 12, repeat: 0 },
      [humanoidAnimKey(type, "hurt", facing)]:   { frames: [frameAt(r, 12)],     frameRate: 8,  repeat: 0 },
    });
  }
}

export function makeHumanoidSpriteConfig(type: CharacterType): CharacterSpriteConfig {
  return {
    textureKey: type,
    usesFlipX: false,
    resolveAnim: (action: CharacterAction, facing: Facing) => {
      if (action === "attack") return humanoidAnimKey(type, "attack", facing);
      if (action === "walk")   return humanoidAnimKey(type, "walk",   facing);
      return humanoidAnimKey(type, "idle", facing);
    },
    hurtAnim: (facing: Facing) => humanoidAnimKey(type, "hurt", facing),
  };
}
