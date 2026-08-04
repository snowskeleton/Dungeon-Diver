import { EnemyType } from "shared";
import { Boss } from "../Boss";
import { Spell, volley } from "../../spells";

// Big Beast — lobs a boulder; a slow, heavy single shot.
// TODO: rolling charge (dash) + ground-slam shockwave (AOE ring).
export class BigBeast extends Boss {
  static readonly type: EnemyType = "big-beast";
  static readonly lore = "A mountain of muscle and fur that throws the very ground at you and bowls over anything in its path.";
  static readonly abilities = [
    { name: "Boulder Hurl", desc: "Rips up a rock and lobs it at your position — leave the marked spot." },
    { name: "Rolling Charge", desc: "Curls into a ball and rolls after you, turning slowly; juke it, then punish. (in progress)" },
    { name: "Ground Slam", desc: "A radial shockwave up close — back out of its reach. (in progress)" },
  ];

  protected preferredRange = 150;
  protected abilities(): Spell[] {
    return [volley({ id: "boulder", ammoId: "fireball", count: 1, spreadDeg: 0, windUpMs: 900, recoverMs: 650, cooldownMs: 2600, range: 380 })];
  }
}
