import { EnemyType } from "shared";
import { Boss, BossAbility, volley } from "../Boss";

// Centaur Knight — throws a lance at range; closes to preferredRange to duel.
// TODO: gallop charge (dash) + club sweep (melee arc) + phase 2 (docs/bosses.md).
export class CentaurKnight extends Boss {
  static readonly type: EnemyType = "centaur-knight";
  static readonly lore = "A proud warhorse-knight that duels with lance and club, honoring a good fight above all.";
  static readonly abilities = [
    { name: "Lance Throw", desc: "Hurls a lance in a straight line — step off the lane to dodge." },
    { name: "Gallop Charge", desc: "Telegraphs, then charges across the room; bait it into a wall to stun it. (in progress)" },
    { name: "Club Sweep", desc: "A wide melee arc up close — slip behind it and punish the recovery. (in progress)" },
  ];

  protected preferredRange = 170;
  protected abilities(): BossAbility[] {
    return [volley({ id: "lance-throw", ammoId: "fireball", count: 1, spreadDeg: 0, windUpMs: 600, recoverMs: 500, cooldownMs: 2000, range: 470 })];
  }
}
