import { EnemyType } from "shared";
import { Boss } from "../Boss";
import { Spell, volley, tremorLine, dashAttack, whirl } from "../../spells";
import { MovementBehavior, holdRange } from "./movement";

// 🐢 Turtle Dragon — the Bulwark. A slow, armored area-denial tank: it holds
// space rather than chasing, lobbing boulders and cracking the ground, whirling
// its shell at anything that hugs it, and closing distance only with its
// signature spin dash — which over-commits into a dizzy punish window. Enrages
// at 50% HP (docs/bosses.md).
export class TurtleDragon extends Boss {
  static readonly type: EnemyType = "turtle-dragon";
  static readonly lore = "An ancient armored dragon-turtle that controls space and punishes the impatient.";
  static readonly abilities = [
    { name: "Boulder Belch", desc: "Spits a slow spread of rock while it holds ground — sidestep the arc." },
    { name: "Tremor Slam", desc: "Slams down and sends cracks racing along the cardinals — stand on a diagonal. Enraged, it fires eight." },
    { name: "Shell Whirl", desc: "Spins in place to batter anything in melee reach — don't crowd it." },
    { name: "Shell Spin", desc: "Withdraws and ricochets across the room as a battering hazard, then bursts out dizzy — the prime punish window." },
  ];

  // A bulwark: it barely repositions (a slow shuffle to keep you mid-range), and
  // leans on the spin dash to actually close distance. It never kites for range.
  protected preferredRange = 160;
  protected movement(): MovementBehavior {
    return holdRange(this.preferredRange, { speedScale: 0.5, slack: 60 });
  }

  // A deliberate lull between attacks so the fight breathes and greedy players
  // get openings (see Boss.globalCooldownMs). Shorter when enraged — more relentless.
  protected get globalCooldownMs(): number {
    return this.phaseKey() === "enrage" ? 700 : 1200;
  }

  // Enrage below 50% HP: the moveset is rebuilt with a wider tremor and a
  // longer, tighter-recovering spin.
  protected phaseKey(): string {
    return this.hpFraction < 0.5 ? "enrage" : "base";
  }

  protected abilities(): Spell[] {
    const enraged = this.phaseKey() === "enrage";

    // Signature. aimLock 300 on an 800ms wind-up: it tracks you for the first
    // ~500ms, then locks its heading so you can step off the line before it
    // launches. Enraged, it bounces more and recovers faster (tighter punish).
    const spin = dashAttack({
      id: "shell-spin",
      windUpMs: 800,
      recoverMs: enraged ? 900 : 1500,
      cooldownMs: 15000,
      range: 360,
      aimLockMs: 300,
      speed: 300,
      maxBounces: enraged ? 5 : 3,
      durationMs: 2500,
      hitRadius: 28,
      damage: 16,
      hitCooldownMs: 700,
    });

    // Basic melee: a stationary shell whirl that batters anything within reach.
    // Short range, so it only fires when a player crowds the boss — the anti-hug
    // punish. Listed first so hugging it gets answered before a ranged move.
    const whirlStrike = whirl({
      id: "shell-whirl",
      windUpMs: 350,
      recoverMs: 500,
      cooldownMs: 5000,
      durationMs: 450,
      reach: 52,
      damage: 14,
    });

    // Ground-slam eruption: stationary shards rise ring-by-ring outward along
    // fixed spokes — 4 cardinals (diagonals safe) at base, 8 cardinals+diagonals
    // enraged (you must move through the ring). The line races out, holds, then
    // clears together. Enraged tightens the recover (less punish time).
    const tremor = tremorLine({
      id: "tremor-slam",
      ammoId: "rock-shard",
      count: enraged ? 8 : 4,
      offsetDeg: 0,
      rings: 13,
      ringSpacing: 16,
      growthMs: 420,
      holdMs: 500,
      damage: 12,
      hitCooldownMs: 500,
      hazardHalfWidth: 12,
      windUpMs: 700,
      recoverMs: enraged ? 450 : 550,
      cooldownMs: 5000,
      range: 210,
    });

    // Lobbed rock spread. aimLock 200 on a 900ms wind-up leaves a late dodge
    // window; the 30° fan means standing still eats the centre shot.
    const belch = volley({
      id: "boulder-belch",
      ammoId: "boulder",
      count: 3,
      spreadDeg: 30,
      windUpMs: 900,
      recoverMs: 600,
      cooldownMs: 2800,
      range: 340,
      aimLockMs: 200,
    });

    // Priority order (first ready-and-in-range fires): whirl answers players who
    // hug it, then the signature spin, then tremor when crowded, belch as filler.
    return [whirlStrike, spin, tremor, belch];
  }
}
