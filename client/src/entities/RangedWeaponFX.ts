import Phaser from "phaser";
import { Facing } from "shared";
import { WEAPON_ICON_DISPLAY_SIZE } from "./AttackFXSprites";

// Ranged weapons (bows, crossbows) render a 2-frame draw sheet instead of a
// melee slash strip: frame 0 = relaxed/unloaded, frame 1 = drawn/loaded. The
// attack plays 0→1→0→0 (windup → draw → release → settle) beside the player,
// rotated toward the fire direction. The actual arrow is a separate server
// projectile spawned on release, so the bow returns to frame 0 as it "fires".
//
// Like the staff (see CastFX.showHeldStaff), the bow is HELD in hand while the
// weapon is equipped — it rests at frame 0 between shots rather than vanishing.
// (It used to hide itself on animation-complete, so it only existed for the
// ~333ms of the draw clip and blinked out whenever the attack cooldown was
// longer than that — every bow but the fast shortbow.)

// Matched to WEAPON_ICON_DISPLAY_SIZE on purpose. Bows and crossbows used to
// render at 24 while every hand weapon rendered at 16, from art that fills its
// 32×32 frame just as tightly — so a crossbow read as half again the size of the
// character carrying it (playtest B10). One held weapon should not be bigger than
// another just because it shoots.
export const BOW_DISPLAY_SIZE = WEAPON_ICON_DISPLAY_SIZE;
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

/** Show the bow in its resting held pose (called once the weapon is equipped). */
export function showHeldBow(
  sprite: Phaser.GameObjects.Sprite,
  px: number,
  py: number,
  facing: Facing,
) {
  sprite.setFrame(0);
  place(sprite, px, py, facing);
  sprite.setVisible(true);
}

/** Play the draw-and-release clip. The bow stays visible (held) afterwards,
 *  settling back to frame 0 rather than disappearing between shots. */
export function playBowFX(
  sprite: Phaser.GameObjects.Sprite,
  weaponId: string,
  px: number,
  py: number,
  facing: Facing,
) {
  place(sprite, px, py, facing);
  sprite.setVisible(true);
  sprite.off(Phaser.Animations.Events.ANIMATION_COMPLETE);
  sprite.play(bowDrawKey(weaponId));
  // The clip ends on frame 0 (0→1→0→0); make that explicit so an interrupted
  // draw can't leave the bow stuck drawn, and DON'T hide it — it stays in hand.
  sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => sprite.setFrame(0));
}

/** Keep the held bow anchored to the player each frame, aimed at its facing. */
export function syncBowFX(
  sprite: Phaser.GameObjects.Sprite,
  px: number,
  py: number,
  facing: Facing,
) {
  if (!sprite.visible) return;
  place(sprite, px, py, facing);
}
