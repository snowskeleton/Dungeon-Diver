// Ammo sheet config for the generic getter-class analyzer (getterSheet.ts).
// Ammo is now OO like weapons (Ammo → Arrow/Bolt/Boomerang → concrete), so it
// reuses the same core; one-offs (throwing-knife, fireball, …) have no category
// getter and fall into the "one-off" group.
import * as path from "path";
import { SheetConfig } from "./getterSheet";

export const AMMO_SHEET: SheetConfig = {
  domain: "ammo",
  title: "Ammo (projectiles)",
  dir: path.resolve(__dirname, "../../shared/src/ammo"),
  stats: [
    { key: "damage", label: "Damage", unit: "" },
    { key: "speed", label: "Speed", unit: "px/s" },
    { key: "pierce", label: "Pierce", unit: "" },
    { key: "knockback", label: "Knockback", unit: "" },
    { key: "lifetimeMs", label: "Lifetime", unit: "ms" },
    { key: "hitRadiusForward", label: "Hit Fwd", unit: "px" },
    { key: "hitRadiusSide", label: "Hit Side", unit: "px" },
  ],
  noCategoryGroup: "one-off",
};
