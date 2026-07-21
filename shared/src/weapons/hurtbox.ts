import { Facing } from "../types";
import { StripFXType, HitRegion } from "./base";
import { FX_HURTBOX_FRAMES, FX_FRAME_MS, FxFrameBounds } from "./fxHurtboxes.generated";

// Turns the generated per-frame FX bounds into a live hurtbox.
//
// The generated table is measured right-facing and relative to the caster's body
// center (see assets/generate-fx-hurtboxes.js). Everything here is the transform
// from that to a world-space region: pick the frame the swing is currently on,
// rotate it to the caster's facing, translate to the caster.
//
// Both the server (weaponSpell's melee effect, which emits the real hit source)
// and the client (the H debug overlay) call this, so what you see outlined is
// exactly what the resolver tests against.

/** Total on-screen duration of a swing's animation, in ms. */
export function swingDurationMs(fxType: StripFXType): number {
  return FX_HURTBOX_FRAMES[fxType].length * FX_FRAME_MS;
}

/** Which animation frame a swing is showing `swingMs` into its animation, or
 *  null once the animation has finished. */
function frameAt(fxType: StripFXType, swingMs: number): FxFrameBounds | null {
  const frames = FX_HURTBOX_FRAMES[fxType];
  if (swingMs < 0) return null;
  const index = Math.floor(swingMs / FX_FRAME_MS);
  if (index >= frames.length) return null; // swing over — art is gone, so is the hitbox
  return frames[index];
}

/**
 * The hurtbox for a swing `swingMs` into its animation, or null when nothing is
 * drawn — either a wind-up frame (the art's leading frames are empty, so the
 * swing genuinely has no hitbox yet) or after the animation ends.
 *
 * Rotation is by quarter turns, so an axis-aligned rect stays axis-aligned:
 * right 0°, down 90°, left 180°, up 270° — matching AttackFXSprites' rotation of
 * the strip itself.
 */
export function fxHurtboxAt(
  fxType: StripFXType,
  swingMs: number,
  px: number,
  py: number,
  facing: Facing,
): HitRegion | null {
  const f = frameAt(fxType, swingMs);
  if (!f) return null;

  // Inclusive-exclusive edges of the frame's box in anchor space.
  const x0 = f.x;
  const y0 = f.y;
  const x1 = f.x + f.w;
  const y1 = f.y + f.h;

  switch (facing) {
    case "right":
      return { shape: "rect", x: px + x0, y: py + y0, w: f.w, h: f.h };
    case "down":
      // (x, y) → (-y, x): the strip's rightward reach becomes downward reach.
      return { shape: "rect", x: px - y1, y: py + x0, w: f.h, h: f.w };
    case "left":
      return { shape: "rect", x: px - x1, y: py - y1, w: f.w, h: f.h };
    case "up":
      // (x, y) → (y, -x).
      return { shape: "rect", x: px + y0, y: py - x1, w: f.h, h: f.w };
  }
}
