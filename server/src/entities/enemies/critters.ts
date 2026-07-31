import { EnemyType } from "shared";
import { PlayerState } from "../../schema/PlayerState";
import { HitSource } from "../../combat/HitSource";
import { Enemy } from "../Enemy";
import { Spell, leap, AimPoint } from "../../spells";
import { CastingEnemy } from "./casting";

// The spider is a standard chaser. The frog-flower HOPS to move and leaps onto the
// player, dealing damage only on the slam (see FrogFlower).
export class Spider extends Enemy { static readonly type: EnemyType = "spider"; }

// The frog-flower: hops toward the player in discrete jumps, and when close enough
// crouches (wind-up) then LEAPS, slamming down for damage on landing. No passive
// contact — the slam is the only hazard. Reuses the existing frog art (its airHeight
// drives the client's hop arc). Grounded body: the leap's height is purely visual.
export class FrogFlower extends CastingEnemy {
  static readonly type: EnemyType = "frog-flower";
  protected get maxHp() { return 45; }
  protected get speed() { return 70; }
  protected get aggroRadius() { return 260; }
  protected get knockbackResistance() { return 1; }

  /** Center-to-center distance at which it commits to a leap. */
  private get leapRange(): number { return 90; }
  private get restMs(): number { return 500; }
  private restRemaining = 0;

  // Discrete-hop locomotion: move for HOP_MS, then pause for HOP_PAUSE_MS, so it
  // bounds toward the player instead of gliding.
  private static readonly HOP_MS = 220;
  private static readonly HOP_PAUSE_MS = 260;
  private static readonly HOP_HEIGHT = 14; // visual arc peak (px) of each locomotion hop
  private hopClock = 0;

  private _leap?: Spell;
  private get leapSpell(): Spell {
    if (!this._leap) {
      this._leap = leap({
        id: "frog-leap",
        windUpMs: 360, // the crouch tell
        recoverMs: 220,
        cooldownMs: 0, // restMs paces re-leaps
        range: this.leapRange,
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

  // Damage lives entirely in the leap's slam — no passive touch hazard.
  override contactHitSource(): HitSource | null {
    return null;
  }

  override tick(players: Map<string, PlayerState>, dtMs: number): void {
    this.applyFlightBaseline();
    this.containToHome();
    if (this.state.isDying) {
      this.caster.interrupt();
      this.syncCastState();
      return;
    }
    this.caster.tickClock(dtMs);
    if (this.restRemaining > 0) this.restRemaining -= dtMs;

    // A shove out of the crouch cancels the leap (knockback-immune once airborne).
    if (this.interruptOnHit(dtMs)) {
      this.syncCastState();
      return;
    }

    const target = this.pickTarget(players);

    if (this.caster.busy) {
      const aim = this.aimAt(target);
      if (target) this.updateFacing(target.dx, target.dy);
      this.caster.update(this, dtMs, aim);
      if (this.caster.phase === "idle") this.restRemaining = this.restMs;
      this.syncCastState();
      return;
    }

    if (!target) {
      this.transition("patrol");
      this.state.targetId = "";
      this.patrol(dtMs);
      this.syncCastState();
      return;
    }

    this.state.targetId = target.id;
    if (target.dist <= this.leapRange && this.restRemaining <= 0) {
      this.transition("attack");
      this.updateFacing(target.dx, target.dy);
      const aim = this.aimAt(target);
      this.caster.begin(this.leapSpell, aim);
      this.caster.update(this, dtMs, aim);
    } else {
      this.transition("chase");
      this.hopToward(target, dtMs);
    }
    this.syncCastState();
  }

  // Bound toward the target: move during the hop window, hold still during the pause.
  private hopToward(target: { dx: number; dy: number }, dtMs: number): void {
    this.hopClock += dtMs;
    const cycle = FrogFlower.HOP_MS + FrogFlower.HOP_PAUSE_MS;
    if (this.hopClock >= cycle) this.hopClock -= cycle;
    this.updateFacing(target.dx, target.dy);
    if (this.hopClock < FrogFlower.HOP_MS) {
      // A hop covers ground faster than a glide would — brief and bounding.
      this.move(target.dx, target.dy, this.speed * 1.6);
      // Drive a visible jump arc: rise and fall over the hop window (0 at the
      // ends, peak at mid-hop) so the client lifts the sprite + casts a shadow
      // instead of just bobbing. applyFlightBaseline reset it to 0 this tick.
      const t = this.hopClock / FrogFlower.HOP_MS;
      this.setAirHeight(Math.sin(Math.PI * t) * FrogFlower.HOP_HEIGHT);
    }
  }

  private aimAt(target: { dx: number; dy: number } | null): AimPoint {
    if (!target) return { x: this.state.x, y: this.state.y };
    return { x: this.state.x + target.dx, y: this.state.y + target.dy };
  }
}
