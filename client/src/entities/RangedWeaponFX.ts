import Phaser from "phaser";
import { Facing } from "shared";

// Ranged weapons (bows, crossbows) render a 2-frame draw sheet instead of a
// melee slash strip: frame 0 = relaxed/unloaded, frame 1 = drawn/loaded. The
// attack plays 0→1→0→0 (windup → draw → release → settle) beside the player,
// rotated toward the fire direction. The actual arrow is a separate server
// projectile spawned on release, so the bow returns to frame 0 as it "fires".

export const BOW_DISPLAY_SIZE = 24;
// How far in front of the player body the bow sits, per axis.
const BOW_REACH = 9;
// The bow art aims up-and-right (~45° above the +x axis). This offset rotates it
// so it lines up with the cardinal fire direction. Tweak if a bow points wrong.
const BOW_ANGLE_OFFSET = 45;

const FACING_DEG: Record<Facing, number> = { right: 0, down: 90, left: 180, up: -90 };
const FACING_OFFSET: Record<Facing, { x: number; y: number }> = {
  right: { x: BOW_REACH, y: 0 },
  left:  { x: -BOW_REACH, y: 0 },
  down:  { x: 0, y: BOW_REACH },
  up:    { x: 0, y: -BOW_REACH },
};

// Active draw state per bow sprite, so syncBowFX() can keep it anchored while
// the player moves mid-shot.
const activeDraws = new WeakMap<Phaser.GameObjects.Sprite, { facing: Facing }>();

/** Full anim key for a weapon's draw clip. */
export function bowDrawKey(weaponId: string): string {
  return `bowdraw-${weaponId}`;
}

/** Load a bow/crossbow 2-frame draw sheet (32×32 frames). */
export function preloadBowSheet(scene: Phaser.Scene, weaponId: string, path: string) {
  scene.load.spritesheet(weaponId, path, { frameWidth: 32, frameHeight: 32 });
}

/** Define the 0→1→0→0 draw clip for a bow/crossbow. */
export function defineBowAnimation(scene: Phaser.Scene, weaponId: string) {
  const key = bowDrawKey(weaponId);
  if (scene.anims.exists(key)) return;
  scene.anims.create({
    key,
    frames: scene.anims.generateFrameNumbers(weaponId, { frames: [0, 1, 0, 0] }),
    frameRate: 12,
    repeat: 0,
  });
}

export function createBowSprite(scene: Phaser.Scene, weaponId: string): Phaser.GameObjects.Sprite {
  const sprite = scene.add.sprite(0, 0, weaponId, 0);
  sprite.setOrigin(0.5, 0.5);
  sprite.setDepth(2.6);
  sprite.setDisplaySize(BOW_DISPLAY_SIZE, BOW_DISPLAY_SIZE);
  sprite.setVisible(false);
  return sprite;
}

function place(sprite: Phaser.GameObjects.Sprite, px: number, py: number, facing: Facing) {
  const off = FACING_OFFSET[facing];
  sprite.x = px + off.x;
  sprite.y = py + off.y;
  sprite.setAngle(FACING_DEG[facing] + BOW_ANGLE_OFFSET);
}

/** Play the draw-and-release clip. Hides the bow when it completes. */
export function playBowFX(
  sprite: Phaser.GameObjects.Sprite,
  weaponId: string,
  px: number,
  py: number,
  facing: Facing,
) {
  activeDraws.set(sprite, { facing });
  place(sprite, px, py, facing);
  sprite.setVisible(true);
  sprite.off(Phaser.Animations.Events.ANIMATION_COMPLETE);
  sprite.play(bowDrawKey(weaponId));
  sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
    sprite.setVisible(false);
    activeDraws.delete(sprite);
  });
}

/** Re-anchor an in-flight draw to the player's current position each frame. */
export function syncBowFX(sprite: Phaser.GameObjects.Sprite, px: number, py: number) {
  const draw = activeDraws.get(sprite);
  if (!draw || !sprite.visible) return;
  place(sprite, px, py, draw.facing);
}
