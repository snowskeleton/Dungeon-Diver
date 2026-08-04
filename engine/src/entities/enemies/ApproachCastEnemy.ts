import { PlayerState } from "../../schema/PlayerState";
import { Spell } from "../../spells";
import { CastingEnemy } from "./CastingEnemy";

// A casting enemy that CLOSES IN, then commits a single telegraphed ability at
// range (the eye-bat's dive, the frog-flower's leap, the fang's lunge). They differ
// only in HOW they close the gap (spiral, hop, straight chase), the commit range,
// the spell, and the post-cast pause — so all of that is a hook and the tick loop
// itself lives here once. A shove/stun mid-wind-up cancels the cast (interruptOnHit),
// and once committed the caster owns movement + height until it returns to idle.
//
// Subclasses provide: commitRange, spell, optionally restMs / approach() / onCastResolved().
export abstract class ApproachCastEnemy extends CastingEnemy {
  // Post-cast pause, counted down each tick; the enemy won't re-commit until it
  // reaches 0. Set from restMs when a cast resolves to idle.
  private restRemaining = 0;

  /** Center-to-center distance at which it commits to its ability. */
  protected abstract get commitRange(): number;

  /** The ability it commits (lazily built + cached by the subclass). */
  protected abstract get spell(): Spell;

  /** Pause after an ability resolves before the next may begin (ms). */
  protected get restMs(): number { return 0; }

  /** True while cooling down after a cast — subclasses that widen their standoff
   *  while regrouping (the eye-bat) read this. */
  protected get resting(): boolean { return this.restRemaining > 0; }

  /** How it closes distance while out of commit range. Default: a straight,
   *  obstacle-aware chase. A weaver (eye-bat) or hopper (frog-flower) overrides
   *  this to drive its own locomotion (see enemies/movement.ts). */
  protected approach(target: { id: string; dx: number; dy: number }, _dtMs: number): void {
    this.pathToward(target);
  }

  /** Fired the tick a cast returns to idle (after restRemaining is armed). Default
   *  no-op; the eye-bat flips its orbit direction here so it doesn't circle forever. */
  protected onCastResolved(): void {}

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

    // A stun OR any shove mid-cast cancels it; when stunned, skip the AI this tick
    // so the knockback impulse rides out (see CastingEnemy.interruptOnHit).
    if (this.interruptOnHit(dtMs)) {
      this.syncCastState();
      return;
    }

    const target = this.pickTarget(players);

    // Mid-cast: let the spell drive height + movement toward the locked aim, keep
    // facing the target during the wind-up, and pause + notify when it resolves.
    if (this.caster.busy) {
      const aim = this.aimAt(target);
      if (target) this.updateFacing(target.dx, target.dy);
      this.caster.update(this, dtMs, aim);
      if (this.caster.phase === "idle") {
        this.restRemaining = this.restMs;
        this.onCastResolved();
      }
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
    if (target.dist <= this.commitRange && this.restRemaining <= 0) {
      this.transition("attack");
      this.updateFacing(target.dx, target.dy);
      const aim = this.aimAt(target);
      this.caster.begin(this.spell, aim);
      this.caster.update(this, dtMs, aim);
    } else {
      this.transition("chase");
      this.approach(target, dtMs);
    }
    this.syncCastState();
  }
}
