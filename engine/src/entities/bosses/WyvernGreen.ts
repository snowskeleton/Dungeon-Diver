import { EnemyType, FLYING_CRUISE_HEIGHT } from "shared";
import { Boss } from "../Boss";
import { Spell, volley, swoop } from "../../spells";

// Green Wyvern — heavier zoning: a wide 5-shot spread, slower cadence, and a
// weightier diving swoop.
// TODO: swap fireballs for poison globs + lingering puddles (needs HAZARD tiles).
export class WyvernGreen extends Boss {
  static readonly type: EnemyType = "wyvern-green";
  static readonly lore = "A venom-veined cousin of the fire wyvern that chokes the battlefield with acid and spores.";
  static readonly abilities = [
    { name: "Acid Spray", desc: "Spits a wide five-shot spread to blanket the ground — heavy area denial." },
    { name: "Diving Swoop", desc: "Coils, then dives claws-first along your position — sidestep the line as it drops." },
    { name: "Attrition", desc: "Fights slow and patient, whittling you down while it keeps its distance." },
  ];

  protected preferredRange = 220;
  protected get cruiseHeight() { return FLYING_CRUISE_HEIGHT; }
  protected abilities(): Spell[] {
    return [
      swoop({
        id: "swoop",
        windUpMs: 800,
        recoverMs: 800,
        cooldownMs: 8000,
        range: 300,
        aimLockMs: 300,
        cruiseHeight: FLYING_CRUISE_HEIGHT,
        diveMs: 460,
        riseMs: 420,
        hitRadius: 32,
        damage: 18,
        knockback: 7,
        hitCooldownMs: 600,
      }),
      volley({
        id: "acid-spray",
        ammoId: "fireball",
        count: 5,
        spreadDeg: 44,
        windUpMs: 900,
        recoverMs: 600,
        cooldownMs: 3000,
        range: 400,
      }),
    ];
  }
}
