import { Weapon, Facing } from "shared";
import { DebugShape, DEBUG_COLORS } from "./DebugDraw";

// A player's melee swing hurtbox, shared by LocalPlayer and RemotePlayer.
//
// The region is now DERIVED FROM THE ATTACK ANIMATION (see shared/weapons/
// hurtbox.ts), so unlike the old static rect it is not positional: there is
// nothing to outline at rest, and nothing during the swing's wind-up frames.
// That's what makes the overlay worth having — it draws the same per-frame box
// the server's resolver is testing against, so art and hitbox disagreeing is
// visible here rather than only as a feel problem.
//
// `swingMs` is elapsed time into the attack animation; callers measure it from
// the attackSeq bump that marks a fresh swing.
export function meleeHurtboxShapes(
  weapon: Weapon,
  x: number,
  y: number,
  facing: Facing,
  swingMs: number,
): DebugShape[] {
  const region = weapon.getHurtbox(x, y, facing, swingMs);
  if (!region || region.shape !== "rect") return [];
  return [
    {
      kind: "rect",
      x: region.x,
      y: region.y,
      w: region.w,
      h: region.h,
      color: DEBUG_COLORS.melee,
      fill: 0.25,
    },
  ];
}
