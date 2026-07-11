import { EnemyType } from "shared";
import { Boss, BossAbility, volley } from "../Boss";

// Grey Wyvern — fast & precise: a single quick shot on a short tell.
// TODO: replace with the marked lightning-strike AOE (needs bolt art + AOE support).
export class WyvernGrey extends Boss {
  static readonly type: EnemyType = "wyvern-grey";
  static readonly lore = "The swiftest of the wyverns, a storm-grey hunter whose strikes come almost before you see them.";
  static readonly abilities = [
    { name: "Quick Strike", desc: "Fires single fast shots on a short tell — punishes standing still." },
    { name: "Precision", desc: "Reads your position tightly; slow reactions get clipped." },
  ];

  protected preferredRange = 240;
  protected abilities(): BossAbility[] {
    return [volley({ id: "spark", ammoId: "fireball", count: 1, spreadDeg: 0, windUpMs: 450, recoverMs: 350, cooldownMs: 1500, range: 460 })];
  }
}
