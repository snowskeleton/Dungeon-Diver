import Phaser from "phaser";
import { Facing, FOOT_OFFSET } from "shared";

// Staves (rangedStyle "cast") keep the weapon in hand like a bow, but a staff has
// only a single icon PNG — no 2-frame draw sheet to play (see RangedWeaponFX).
// So instead of animating frames, the icon is held beside the player and, on each
// cast, given a quick raise + scale pop + bright flash. The bolt itself is a
// separate server projectile, so this reads as "the staff discharges".

export const CAST_ICON_DISPLAY_SIZE = 20;
// Where the staff sits relative to the body: the player's RIGHT hand. Which side
// of the sprite that lands on depends on which way they're facing — facing down
// (toward the viewer) their right hand is on the viewer's LEFT; facing up (away)
// it's on the viewer's RIGHT; in the side views it's the forward hand.
const HAND_X = 7;
// The staff is drawn corner-to-corner in its icon, so once STAFF_ART_ANGLE stands
// it upright its rendered length is the icon's DIAGONAL, not its side — and the
// origin (0.5, 0.5) sits at the staff's midpoint. Half that length is how far the
// butt hangs below the sprite's anchor point.
const STAFF_HALF_LEN = (CAST_ICON_DISPLAY_SIZE * Math.SQRT2) / 2;
// Rest the butt of the staff on the player's feet — FOOT_OFFSET below the sprite
// centre, the same point the physics body stands on. Then nudge per facing for
// depth: facing away the staff is further into the scene so it reads slightly
// higher; facing the viewer it's nearer, so slightly lower.
const FOOT_NUDGE: Record<Facing, number> = { up: -3, down: 3, left: 0, right: 0 };
const handY = (facing: Facing) => FOOT_OFFSET + FOOT_NUDGE[facing] - STAFF_HALF_LEN;
// Facing away, the staff is on the far side of the body, so it draws behind the
// player; every other facing puts it in front. (Body sprite is depth 2.)
const DEPTH_IN_FRONT = 2.6;
const DEPTH_BEHIND = 1.9;
// How far the staff lifts at the peak of a cast.
const RAISE_PX = 8;
const CAST_MS = 200;
// The staff icons are all drawn on a diagonal — shaft running lower-left to
// upper-right with the head at the top-right, i.e. 45° clockwise of vertical.
// Phaser's setAngle rotates clockwise, so -45° stands the staff upright. The
// cast animation is a straight vertical thrust (lift + scale pop) rather than an
// angular flick, so the staff reads as held straight up and down throughout.
const STAFF_ART_ANGLE = -45;

const FACING_OFFSET: Record<Facing, { x: number; y: number }> = {
  down:  { x: -HAND_X, y: handY("down")  }, // facing viewer → right hand on viewer's left
  up:    { x:  HAND_X, y: handY("up")    }, // facing away   → right hand on viewer's right
  right: { x:  HAND_X, y: handY("right") }, // side view     → forward hand
  left:  { x: -HAND_X, y: handY("left")  },
};

// Where the staff is anchored, per sprite. This is the single source of truth for
// placement: the player's position + facing (updated every frame by syncCastFX)
// and the current cast lift (driven by the cast tween). reposition() derives the
// sprite's actual x/y from it, so the two never fight.
// `baseScale` is the scale setDisplaySize() resolved to for this texture. The pop
// tween MUST scale relative to it — tweening scale to a bare 1.25 would discard
// the display sizing and render the staff at 1.25x its native texture size.
type Anchor = { px: number; py: number; facing: Facing; lift: number; baseScale: number };
const anchors = new WeakMap<Phaser.GameObjects.Image, Anchor>();

/** Create the in-hand staff image. `weaponIconKey` is the already-preloaded icon. */
export function createCastSprite(
  scene: Phaser.Scene,
  weaponIconKey: string,
): Phaser.GameObjects.Image {
  const img = scene.add.image(0, 0, weaponIconKey);
  img.setOrigin(0.5, 0.5);
  img.setDepth(2.6);
  img.setDisplaySize(CAST_ICON_DISPLAY_SIZE, CAST_ICON_DISPLAY_SIZE);
  img.setAngle(STAFF_ART_ANGLE);
  img.setVisible(false);
  return img;
}

function reposition(img: Phaser.GameObjects.Image) {
  const a = anchors.get(img);
  if (!a) return;
  const off = FACING_OFFSET[a.facing];
  img.x = a.px + off.x;
  img.y = a.py + off.y - a.lift;
  img.setDepth(a.facing === "up" ? DEPTH_BEHIND : DEPTH_IN_FRONT);
}

function anchorFor(img: Phaser.GameObjects.Image, px: number, py: number, facing: Facing): Anchor {
  const a = anchors.get(img) ?? { px, py, facing, lift: 0, baseScale: img.scaleX };
  a.px = px;
  a.py = py;
  a.facing = facing;
  anchors.set(img, a);
  return a;
}

/** Play one cast: raise + pop + flash, then settle back into the held pose. */
export function playCastFX(
  img: Phaser.GameObjects.Image,
  px: number,
  py: number,
  facing: Facing,
) {
  const a = anchorFor(img, px, py, facing);
  img.setVisible(true);

  const scene = img.scene;
  scene.tweens.killTweensOf(img);
  scene.tweens.killTweensOf(a);

  img.setScale(a.baseScale);
  img.setAngle(STAFF_ART_ANGLE);
  a.lift = 0;
  reposition(img);

  // Scale pop, paired with the lift below into one vertical thrust. The angle is
  // left alone so the staff stays upright for the whole cast.
  const pop = a.baseScale * 1.25;
  scene.tweens.add({
    targets: img,
    scaleX: pop,
    scaleY: pop,
    duration: CAST_MS * 0.4,
    ease: "Quad.Out",
    yoyo: true,
    hold: CAST_MS * 0.1,
    onComplete: () => img.setScale(a.baseScale),
  });

  // Lift, tweened on the anchor so reposition() stays authoritative.
  scene.tweens.add({
    targets: a,
    lift: RAISE_PX,
    duration: CAST_MS * 0.4,
    ease: "Quad.Out",
    yoyo: true,
    onUpdate: () => reposition(img),
    onComplete: () => { a.lift = 0; reposition(img); },
  });
}

/** Reset a staff to its resting pose — used when a cast is cut short (weapon
 *  swap, death) so it can't be left frozen mid-pop. */
export function resetCastFX(img: Phaser.GameObjects.Image) {
  img.scene.tweens.killTweensOf(img);
  const a = anchors.get(img);
  if (a) {
    a.lift = 0;
    img.setScale(a.baseScale);
  }
  img.setAngle(STAFF_ART_ANGLE);
  reposition(img);
}

/** Keep the held staff anchored to the player each frame. */
export function syncCastFX(
  img: Phaser.GameObjects.Image,
  px: number,
  py: number,
  facing: Facing,
) {
  if (!img.visible) return;
  anchorFor(img, px, py, facing);
  reposition(img);
}

/** Show the staff in its resting held pose (called once the weapon is equipped). */
export function showHeldStaff(
  img: Phaser.GameObjects.Image,
  px: number,
  py: number,
  facing: Facing,
) {
  anchorFor(img, px, py, facing);
  img.setVisible(true);
  reposition(img);
}
