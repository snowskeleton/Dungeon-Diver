import { EnemyType } from "shared";
import { Boss, BossAbility, volley } from "../Boss";

// Fire Wyvern — aerial zoner: a 3-shot fire-breath cone, held at range.
export class Wyvern extends Boss {
  static readonly type: EnemyType = "wyvern";
  static readonly lore = "A fire-blooded wyrm that rules the air, raining flame on anything that dares approach its roost.";
  static readonly abilities = [
    { name: "Fire Breath", desc: "Fans a spread of fireballs across a wide arc — weave between them." },
    { name: "Aerial Zoning", desc: "Hovers at range and keeps its distance, forcing you to close the gap under fire." },
  ];

  protected preferredRange = 220;
  protected abilities(): BossAbility[] {
    return [volley({ id: "fire-breath", ammoId: "fireball", count: 3, spreadDeg: 26, windUpMs: 800, recoverMs: 550, cooldownMs: 2600, range: 420 })];
  }
}
