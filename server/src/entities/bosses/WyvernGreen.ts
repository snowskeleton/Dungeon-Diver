import { EnemyType } from "shared";
import { Boss, BossAbility, volley } from "../Boss";

// Green Wyvern — heavier zoning: a wide 5-shot spread, slower cadence.
// TODO: swap fireballs for poison globs + lingering puddles (needs HAZARD tiles).
export class WyvernGreen extends Boss {
  static readonly type: EnemyType = "wyvern-green";
  static readonly lore = "A venom-veined cousin of the fire wyvern that chokes the battlefield with acid and spores.";
  static readonly abilities = [
    { name: "Acid Spray", desc: "Spits a wide five-shot spread to blanket the ground — heavy area denial." },
    { name: "Attrition", desc: "Fights slow and patient, whittling you down while it keeps its distance." },
  ];

  protected preferredRange = 220;
  protected abilities(): BossAbility[] {
    return [volley({ id: "acid-spray", ammoId: "fireball", count: 5, spreadDeg: 44, windUpMs: 900, recoverMs: 600, cooldownMs: 3000, range: 400 })];
  }
}
