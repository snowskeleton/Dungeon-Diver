import { EnemyType } from "shared";
import { Spell, leap } from "../../spells";
import { ApproachCastEnemy } from "./ApproachCastEnemy";
import { hopApproach } from "./movement";

// The frog-flower: hops toward the player in discrete jumps, and when close enough
// crouches (wind-up) then LEAPS, slamming down for damage on landing. No passive
// contact — the slam is the only hazard. Reuses the existing frog art (its airHeight
// drives the client's hop arc). Grounded body: the leap's height is purely visual.
export class FrogFlower extends ApproachCastEnemy {
  static readonly type: EnemyType = "frog-flower";

  protected get commitRange(): number { return 90; }
  protected get restMs(): number { return 500; }

  // Discrete-hop locomotion: move for HOP_MS, then pause for HOP_PAUSE_MS, so it
  // bounds toward the player instead of gliding.
  private static readonly HOP_MS = 220;
  private static readonly HOP_PAUSE_MS = 260;
  private static readonly HOP_HEIGHT = 14; // visual arc peak (px) of each locomotion hop
  private hopClock = 0;

  private _leap?: Spell;
  protected get spell(): Spell {
    if (!this._leap) {
      this._leap = leap({
        id: "frog-leap",
        windUpMs: 360, // the crouch tell
        recoverMs: 220,
        cooldownMs: 0, // restMs paces re-leaps
        range: this.commitRange,
        aimLockMs: 140,
        peakHeight: 40,
        riseMs: 260,
        fallMs: 240,
        hitRadius: 20,
        damage: 12,
        knockback: 6,
        hitCooldownMs: 500,
      });
    }
    return this._leap;
  }

  // Bound toward the target: move during the hop window, hold still during the pause,
  // driving a visible jump arc via airHeight (see hopApproach).
  protected override approach(target: { dx: number; dy: number }, dtMs: number): void {
    this.updateFacing(target.dx, target.dy);
    const r = hopApproach({
      hopClock: this.hopClock,
      dtMs,
      hopMs: FrogFlower.HOP_MS,
      pauseMs: FrogFlower.HOP_PAUSE_MS,
      hopHeight: FrogFlower.HOP_HEIGHT,
    });
    this.hopClock = r.hopClock;
    if (r.moving) {
      // A hop covers ground faster than a glide would — brief and bounding.
      this.move(target.dx, target.dy, this.speed * 1.6);
      this.setAirHeight(r.airHeight);
    }
  }
}
