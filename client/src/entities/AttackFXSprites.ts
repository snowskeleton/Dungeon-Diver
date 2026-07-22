import Phaser from "phaser";
import { Facing, AttackFXType, StripFXType } from "shared";

export type { AttackFXType, StripFXType };

// The directional swing/stab strips are keyed by StripFXType (shared): "nova" is
// a weapon FX type too, but it's a procedural expanding blast (see NovaFX), not
// one of these right-facing strips. That type lives in shared because the melee
// hurtboxes are measured from these same strips (see shared/weapons/hurtbox.ts),
// so the strip set has to be one definition, not two.

// All FX strips are right-facing, played once at 14fps, then hidden.
// Rotation: right=0° down=90° left=180° up=270°
//
// Frame geometry comes from the asset pack's template sheets ("Slash Generic
// 48x48.png" etc.): within each cell the character body is a 16×16 square
// whose center sits 24px from the cell's top-left — NOT the cell center; the
// wide strips (64/96px) extend rightward from the body. The sprite origin is
// set to that body anchor, so placing the sprite at the entity center lines
// every frame up, and facing rotation pivots around the body.
const BODY_ANCHOR_PX = 24;

const FX_CONFIG: Record<StripFXType, { key: string; file: string; fw: number; fh: number; frames: number }> = {
  "slash":      { key: "slash-generic",      file: "/sprites/slash-generic.png",      fw: 48, fh: 48, frames: 4 },
  "long-slash": { key: "long-slash-generic", file: "/sprites/long-slash-generic.png", fw: 64, fh: 48, frames: 4 },
  "stab":       { key: "stab-generic",       file: "/sprites/stab-generic.png",       fw: 64, fh: 48, frames: 4 },
  "long-stab":  { key: "long-stab-generic",  file: "/sprites/long-stab-generic.png",  fw: 96, fh: 48, frames: 4 },
};

const FACING_ROTATION: Record<Facing, number> = {
  right:   0,
  down:   90,
  left:  180,
  up:    270,
};

// Per-frame weapon icon placement for a right-facing attack, decoded from the
// pack's template sheets (the orange "UP" icon around the blue body square):
// offset of the icon center from the body center, plus the icon angle in
// degrees clockwise (icon art points up at 0°). null = icon hidden that frame.
// Other facings rotate the whole keyframe by FACING_ROTATION.
type IconKeyframe = { x: number; y: number; angle: number } | null;
const ICON_KEYFRAMES: Record<StripFXType, IconKeyframe[]> = {
  "slash": [
    { x: -12, y:  0, angle: -90 },
    { x: -12, y:  0, angle: 180 },
    { x:  12, y: 12, angle:  90 },
    { x:   0, y:  8, angle:  90 },
  ],
  "long-slash": [
    { x: -10, y:  3, angle: -90 },
    { x: -10, y:  2, angle: 180 },
    { x:  12, y: 13, angle:  90 },
    { x:  -4, y:  9, angle:  90 },
  ],
  "stab": [
    { x:  -8, y:  8, angle: 180 },
    { x:  -4, y: -4, angle: 180 },
    { x:  20, y:  4, angle:  90 },
    { x:   4, y:  8, angle:  90 },
  ],
  "long-stab": [
    { x:  -4, y:  0, angle:   0 },
    { x:   0, y: -8, angle:   0 },
    null,
    { x:   0, y:  8, angle:  90 },
  ],
};

// Template icons occupy a 16×16 box in FX pixel space (same size as the body
// square) — the keyframe offsets assume this display size.
export const WEAPON_ICON_DISPLAY_SIZE = 16;

// ── Held-at-rest pose ────────────────────────────────────────────────────────
// Between swings the weapon icon is HELD in the player's right hand, the same way
// the staff is (see CastFX.showHeldStaff) — every weapon stays in hand, not just
// the caster ones. The rest angle is the weapon's own `iconAngle` (its natural
// hold tilt: -45° for a slashing blade, 0° for a thrust/point weapon); the icon
// art points up at 0°, so this reads as the weapon carried at that angle.
const HELD_HAND_X = 7; // matches the staff's hand offset
const HELD_HAND_Y = -6; // just above sprite centre, at hand height
// In front of the body (depth 2), except facing away, where the far-side hand
// tucks the weapon behind the player — mirrors the staff's depth flip.
const HELD_DEPTH_FRONT = 2.6;
const HELD_DEPTH_BEHIND = 1.9;
// Which side the right hand lands on depends on facing (see CastFX for the full
// reasoning): toward the viewer it's on the viewer's left, away it's on the right.
const HELD_HAND_OFFSET: Record<Facing, { x: number; y: number }> = {
  down:  { x: -HELD_HAND_X, y: HELD_HAND_Y },
  up:    { x:  HELD_HAND_X, y: HELD_HAND_Y },
  right: { x:  HELD_HAND_X, y: HELD_HAND_Y },
  left:  { x: -HELD_HAND_X, y: HELD_HAND_Y },
};

/** Rest the weapon icon in the player's right hand, at its natural hold angle.
 *  Called every frame a weapon is equipped but not mid-swing. */
export function holdWeaponIconAtRest(
  icon: Phaser.GameObjects.Image,
  px: number,
  py: number,
  facing: Facing,
  iconAngle: number,
) {
  const off = HELD_HAND_OFFSET[facing];
  icon.x = px + off.x;
  icon.y = py + off.y;
  // Mirror when facing left, exactly as the character sheet does (playtest B10:
  // "axes don't mirror when held"). The art is drawn pointing right, so facing
  // left it must be flipped AND its hold tilt negated — flipping alone leaves an
  // asymmetric weapon like an axe cocked the wrong way.
  const mirrored = facing === "left";
  icon.setFlipX(mirrored);
  icon.setAngle(mirrored ? -iconAngle : iconAngle);
  icon.setDepth(facing === "up" ? HELD_DEPTH_BEHIND : HELD_DEPTH_FRONT);
  icon.setVisible(true);
}

// Active-swing state per FX sprite, so syncAttackFX() can re-anchor the strip
// and icon to the entity's current position every frame while it moves.
type ActiveSwing = { facing: Facing; kf: IconKeyframe };
const activeSwings = new WeakMap<Phaser.GameObjects.Sprite, ActiveSwing>();

export function preloadAttackFX(scene: Phaser.Scene) {
  for (const cfg of Object.values(FX_CONFIG)) {
    scene.load.spritesheet(cfg.key, cfg.file, { frameWidth: cfg.fw, frameHeight: cfg.fh });
  }
}

export function defineAttackFXAnimations(scene: Phaser.Scene) {
  for (const [type, cfg] of Object.entries(FX_CONFIG) as [StripFXType, typeof FX_CONFIG[StripFXType]][]) {
    const key = `fx-${type}`;
    if (!scene.anims.exists(key)) {
      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(cfg.key, {
          frames: Array.from({ length: cfg.frames }, (_, i) => i),
        }),
        frameRate: 14,
        repeat: 0,
      });
    }
  }
}

export function createAttackFXSprite(scene: Phaser.Scene, fxType: StripFXType): Phaser.GameObjects.Sprite {
  const cfg = FX_CONFIG[fxType];
  const sprite = scene.add.sprite(0, 0, cfg.key);
  sprite.setOrigin(BODY_ANCHOR_PX / cfg.fw, BODY_ANCHOR_PX / cfg.fh);
  sprite.setVisible(false);
  sprite.setDepth(2.5);
  return sprite;
}

function applyIconKeyframe(
  icon: Phaser.GameObjects.Image,
  kf: IconKeyframe,
  px: number,
  py: number,
  facing: Facing,
) {
  if (!kf) {
    icon.setVisible(false);
    return;
  }
  const rot = FACING_ROTATION[facing];
  const rad = Phaser.Math.DegToRad(rot);
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));
  icon.x = px + kf.x * cos - kf.y * sin;
  icon.y = py + kf.x * sin + kf.y * cos;
  icon.setAngle(kf.angle + rot);
  icon.setVisible(true);
}

export function playAttackFX(
  sprite: Phaser.GameObjects.Sprite,
  fxType: StripFXType,
  px: number,
  py: number,
  facing: Facing,
  weaponIcon?: Phaser.GameObjects.Image,
) {
  sprite.x = px;
  sprite.y = py;
  sprite.setAngle(FACING_ROTATION[facing]);
  sprite.setVisible(true);

  // Clear listeners from a previous swing that may have been interrupted.
  sprite.off(Phaser.Animations.Events.ANIMATION_UPDATE);
  sprite.off(Phaser.Animations.Events.ANIMATION_COMPLETE);

  const swing: ActiveSwing = { facing, kf: null };
  activeSwings.set(sprite, swing);

  if (weaponIcon) {
    const keyframes = ICON_KEYFRAMES[fxType];
    swing.kf = keyframes[0];
    applyIconKeyframe(weaponIcon, swing.kf, px, py, facing);
    sprite.on(
      Phaser.Animations.Events.ANIMATION_UPDATE,
      (_anim: Phaser.Animations.Animation, frame: Phaser.Animations.AnimationFrame) => {
        // AnimationFrame.index is 1-based.
        swing.kf = keyframes[frame.index - 1] ?? null;
        applyIconKeyframe(weaponIcon, swing.kf, sprite.x, sprite.y, facing);
      },
    );
  }

  sprite.play(`fx-${fxType}`);
  sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
    sprite.setVisible(false);
    sprite.off(Phaser.Animations.Events.ANIMATION_UPDATE);
    // Leave the weapon ICON visible — the swing is over, but the weapon stays in
    // hand. The owner's sync re-anchors it to the held-at-rest pose next frame
    // (see HeldWeaponVisual). Only the transient slash STRIP is hidden here.
    activeSwings.delete(sprite);
  });
}

// Call every frame while the entity moves: re-anchors an in-flight swing's FX
// strip and weapon icon to the entity's current position.
export function syncAttackFX(
  sprite: Phaser.GameObjects.Sprite,
  px: number,
  py: number,
  weaponIcon?: Phaser.GameObjects.Image,
) {
  const swing = activeSwings.get(sprite);
  if (!swing || !sprite.visible) return;
  sprite.x = px;
  sprite.y = py;
  if (weaponIcon) {
    applyIconKeyframe(weaponIcon, swing.kf, px, py, swing.facing);
  }
}
