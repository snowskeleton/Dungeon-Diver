import { EnemyType } from "shared";
import { Boss } from "../Boss";
import { Spell, volley } from "../../spells";

// Batwing Buttstomper — wide 5-orb spray to weave through.
// TODO: the airborne buttstomp AOE (needs airborne state + tracking marker).
export class BatwingButtstomper extends Boss {
  static readonly type: EnemyType = "batwing-buttstomper";
  static readonly lore = "A hulking winged brute that carpets the arena with magic orbs, then drops out of the sky on your head.";
  static readonly abilities = [
    { name: "Orb Spray", desc: "Breathes a wide fan of slow orbs — thread a gap in the wall." },
    { name: "Buttstomp", desc: "Leaps offscreen; a growing marker tracks you, then it slams down for a shockwave. Keep moving. (in progress)" },
    { name: "Wing Gust", desc: "A damageless blast of wind that shoves you toward hazards. (in progress)" },
  ];

  protected preferredRange = 200;
  protected abilities(): Spell[] {
    return [volley({ id: "orb-spray", ammoId: "magic-orb", count: 5, spreadDeg: 60, windUpMs: 800, recoverMs: 600, cooldownMs: 2600, range: 430 })];
  }
}
