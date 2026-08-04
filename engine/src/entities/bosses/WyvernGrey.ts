import { EnemyType, FLYING_CRUISE_HEIGHT } from "shared";
import { Boss } from "../Boss";
import { Spell, volley, swoop } from "../../spells";

// Grey Wyvern — fast & precise: a single quick shot on a short tell, and a fast,
// short-tell diving swoop that punishes slow reactions.
// TODO: replace with the marked lightning-strike AOE (needs bolt art + AOE support).
export class WyvernGrey extends Boss {
  static readonly type: EnemyType = "wyvern-grey";
  static readonly lore = "The swiftest of the wyverns, a storm-grey hunter whose strikes come almost before you see them.";
  static readonly abilities = [
    { name: "Quick Strike", desc: "Fires single fast shots on a short tell — punishes standing still." },
    { name: "Diving Swoop", desc: "Snaps into a fast claws-first dive on a short tell — react early." },
    { name: "Precision", desc: "Reads your position tightly; slow reactions get clipped." },
  ];

  protected preferredRange = 240;
  protected get cruiseHeight() { return FLYING_CRUISE_HEIGHT; }
  protected abilities(): Spell[] {
    return [
      swoop({
        id: "swoop",
        windUpMs: 500,
        recoverMs: 650,
        cooldownMs: 6000,
        range: 320,
        aimLockMs: 150,
        cruiseHeight: FLYING_CRUISE_HEIGHT,
        diveMs: 340,
        riseMs: 320,
        hitRadius: 28,
        damage: 14,
        knockback: 5,
        hitCooldownMs: 500,
      }),
      volley({
        id: "spark",
        ammoId: "fireball",
        count: 1,
        spreadDeg: 0,
        windUpMs: 450,
        recoverMs: 350,
        cooldownMs: 1500,
        range: 460,
      }),
    ];
  }
}
