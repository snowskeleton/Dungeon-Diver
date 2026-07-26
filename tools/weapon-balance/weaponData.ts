// Weapon sheet config for the generic getter-class analyzer (getterSheet.ts).
import * as path from "path";
import { SheetConfig } from "./getterSheet";

export const WEAPON_SHEET: SheetConfig = {
  domain: "weapon",
  title: "Weapons",
  dir: path.resolve(__dirname, "../../shared/src/weapons"),
  stats: [
    { key: "damage", label: "Damage", unit: "" },
    { key: "attackCooldownMs", label: "Atk CD", unit: "ms" },
    { key: "attackForce", label: "Knockback", unit: "" },
    { key: "iconAngle", label: "Icon Angle", unit: "°" },
    // Melee combo per-swing multipliers (first / reverse / finisher). Ranged/AOE
    // weapons carry these but never combo, so they're inert there.
    { key: "combo1DamageMult", label: "Combo1 Dmg×", unit: "" },
    { key: "combo2DamageMult", label: "Combo2 Dmg×", unit: "" },
    { key: "combo3DamageMult", label: "Combo3 Dmg×", unit: "" },
    { key: "combo1KnockbackMult", label: "Combo1 KB×", unit: "" },
    { key: "combo2KnockbackMult", label: "Combo2 KB×", unit: "" },
    { key: "combo3KnockbackMult", label: "Combo3 KB×", unit: "" },
  ],
  noCategoryGroup: "other",
};
