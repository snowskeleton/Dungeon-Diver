import { EnemyType } from "shared";
import { Boss, BossAbility, volley } from "../Boss";

// Tengu — caster: a 5-orb barrage from range (odd count → one shot dead-on).
// TODO: lightning pillars + teleport + summon/stoneface phase gate.
export class TenguMask extends Boss {
  static readonly type: EnemyType = "tengu-mask";
  static readonly lore = "A masked mountain spirit and trickster mage that bends the fight with spells, blinks, and illusions.";
  static readonly abilities = [
    { name: "Orb Barrage", desc: "Conjures a fan of homing-slow orbs and looses them at you — weave the spread." },
    { name: "Teleport", desc: "Blinks away when you close to melee; punish the moment it reappears. (in progress)" },
    { name: "Summon & Stoneface", desc: "Calls minions and turns to stone, invulnerable until the adds fall. (in progress)" },
  ];

  protected preferredRange = 250;
  protected abilities(): BossAbility[] {
    return [volley({ id: "orb-barrage", ammoId: "magic-orb", count: 5, spreadDeg: 44, windUpMs: 700, recoverMs: 550, cooldownMs: 2400, range: 480 })];
  }
}
