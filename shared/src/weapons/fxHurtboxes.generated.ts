// GENERATED FILE — do not edit by hand.
// Produced by assets/generate-fx-hurtboxes.js from the attack FX strips.
// Re-run that script after changing any FX art; see docs/weapons-and-ammo.md.

import { StripFXType } from "./base";

/** One frame's opaque bounds, relative to the caster's body center, drawn
 *  right-facing. null = the frame draws nothing, so the swing deals no damage
 *  during it (this is the swing's wind-up). */
export interface FxFrameBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How long each FX frame is on screen (ms) — the hurtbox timeline follows
 *  the animation's own frame rate, not the weapon's cooldown. */
export const FX_FRAME_MS = 71.4286;

export const FX_HURTBOX_FRAMES: Record<StripFXType, readonly (FxFrameBounds | null)[]> = {
  // slash-generic.png
  "slash": [
    null,
    null,
    { x: -18, y: -24, w: 42, h: 40 },
    { x: 8, y: 0, w: 16, h: 19 },
  ],
  // long-slash-generic.png
  "long-slash": [
    null,
    null,
    { x: 11, y: -24, w: 29, h: 47 },
    { x: -3, y: 6, w: 40, h: 17 },
  ],
  // stab-generic.png
  "stab": [
    null,
    null,
    { x: 13, y: -6, w: 27, h: 12 },
    { x: -4, y: -4, w: 43, h: 11 },
  ],
  // long-stab-generic.png
  "long-stab": [
    null,
    null,
    { x: 2, y: -8, w: 69, h: 16 },
    null,
  ],
};
