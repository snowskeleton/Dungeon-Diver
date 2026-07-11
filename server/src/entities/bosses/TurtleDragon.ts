import { EnemyType } from "shared";
import { Boss, BossAbility, volley } from "../Boss";

// Armored area-denial tank. Holds ground and belches a slow spread of rock.
// TODO: shell-spin ricochet dash + tremor cracks — its real signature (docs/bosses.md).
export class TurtleDragon extends Boss {
  static readonly type: EnemyType = "turtle-dragon";
  static readonly lore = "An ancient armored dragon-turtle that controls space and punishes the impatient.";
  static readonly abilities = [
    { name: "Boulder Belch", desc: "Spits a slow spread of rock while it holds ground — sidestep the arc." },
    { name: "Shell Spin", desc: "Withdraws and ricochets across the room, then bursts out dizzy — the punish window. (in progress)" },
    { name: "Tremor Slam", desc: "Slams down and sends cracks racing along the cardinals; stand on the diagonals. (in progress)" },
  ];

  protected preferredRange = 130;
  protected abilities(): BossAbility[] {
    // aimLockMs: tracks you for the first ~500ms, then locks the aim for the
    // final 400ms — keep moving and its spread lands where you *were*.
    return [volley({
      id: "boulder-belch",
      ammoId: "fireball",
      count: 3,
      spreadDeg: 30,
       windUpMs: 900,
       recoverMs: 600,
       cooldownMs: 2800,
       range: 340,
       aimLockMs: 200
    })];
  }
}
