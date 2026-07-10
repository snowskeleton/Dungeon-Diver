import { Weapon, Facing } from "shared";
import { DebugShape, DEBUG_COLORS } from "./DebugDraw";

// A player's melee swing hurtbox, shared by LocalPlayer and RemotePlayer. The
// region is positional (exists regardless of attack state) so it's always
// outlined to show reach; it's filled only while the swing is actually active.
// Ranged weapons have no melee region (getHurtbox returns null) → no shape.
export function meleeHurtboxShapes(
  weapon: Weapon,
  x: number,
  y: number,
  facing: Facing,
  isAttacking: boolean,
): DebugShape[] {
  const region = weapon.getHurtbox(x, y, facing);
  if (!region || region.shape !== "rect") return [];
  return [
    {
      kind: "rect",
      x: region.x,
      y: region.y,
      w: region.w,
      h: region.h,
      color: DEBUG_COLORS.melee,
      fill: isAttacking ? 0.25 : undefined,
    },
  ];
}
