import { EnemyType, FLYING_CRUISE_HEIGHT } from "shared";
import { Boss } from "../Boss";
import { Spell, volley, swoop } from "../../spells";

// Fire Wyvern — aerial zoner: a 3-shot fire-breath cone held at range, punctuated
// by a diving claw swoop when you close the gap.
export class Wyvern extends Boss {
  static readonly type: EnemyType = "wyvern";
  static readonly lore = "A fire-blooded wyrm that rules the air, raining flame on anything that dares approach its roost.";
  static readonly abilities = [
    { name: "Fire Breath", desc: "Fans a spread of fireballs across a wide arc — weave between them." },
    { name: "Diving Swoop", desc: "Coils, then dives claws-first along your position — sidestep the line as it drops." },
    { name: "Aerial Zoning", desc: "Hovers at range and keeps its distance, forcing you to close the gap under fire." },
  ];

  protected preferredRange = 220;
  protected get cruiseHeight() { return FLYING_CRUISE_HEIGHT; }
  protected abilities(): Spell[] {
    return [
      swoop({
        id: "swoop",
        windUpMs: 700,
        recoverMs: 750,
        cooldownMs: 7000,
        range: 300,
        aimLockMs: 250,
        cruiseHeight: FLYING_CRUISE_HEIGHT,
        diveMs: 420,
        riseMs: 380,
        hitRadius: 30,
        damage: 16,
        knockback: 6,
        hitCooldownMs: 600,
      }),
      volley({
        id: "fire-breath",
        ammoId: "fireball",
        count: 3,
        spreadDeg: 26,
        windUpMs: 800,
        recoverMs: 550,
        cooldownMs: 2600,
        range: 420,
      }),
    ];
  }
}
