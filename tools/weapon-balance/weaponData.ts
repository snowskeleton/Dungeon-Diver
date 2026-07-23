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
  ],
  noCategoryGroup: "other",
};
