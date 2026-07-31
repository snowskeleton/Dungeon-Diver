import { EnemyType } from "shared";
import { PlayerState } from "../../schema/PlayerState";
import { HitSource } from "../../combat/HitSource";
import { Spell, swoop, AimPoint } from "../../spells";
import { CastingEnemy } from "./casting";

// How high above the floor the eye-bat hovers (px) — the client lifts the sprite
// and drops a shadow. See Enemy.cruiseHeight.
const BAT_HOVER = 16;

// The Eye Bat: a fast, fragile flyer that spirals in and DIVES at the player. All
// its damage is the dive (swoop) — no passive contact — so it's dodged by not being
// where it skims. Reuses the same swoop builder the flying bosses use, now that a
// rank-and-file Enemy is a FlightCaster (dashStep + setAirHeight).
export class EyeBat extends CastingEnemy {
  static readonly type: EnemyType = "eye-bat";
  protected get maxHp() { return 30; }
  protected get speed() { return 70; }
  protected get aggroRadius() { return 240; }
  protected get knockbackResistance() { return 0; }
  protected get cruiseHeight() { return BAT_HOVER; }

  /** Center-to-center distance at which it commits to a dive. */
  private get diveRange(): number { return 75; }
  /** Pause after a dive before it may spiral in for another. */
  private get restMs(): number { return 2000; }
  private restRemaining = 0;
  // Which way it orbits while closing (flips per dive so it doesn't circle forever).
  private spinDir: 1 | -1 = 1;
  // Accumulates while orbiting; drives the side-to-side weave of the spiral.
  private orbitClock = 0;

  /** Distance it tries to hold while orbiting. Wide while resting after a dive, so
   *  it peels OUT and regroups instead of spinning around your head; tight while
   *  hunting, so it presses into dive range. */
  private standoffRadius(): number {
    return this.restRemaining > 0 ? 150 : 55;
  }

  private _dive?: Spell;
  private get dive(): Spell {
    if (!this._dive) {
      this._dive = swoop({
        id: "eye-bat-dive",
        windUpMs: 400, // the coil-up tell
        recoverMs: 50,
        cooldownMs: 0, // the AI's restMs paces re-dives
        range: this.diveRange,
        aimLockMs: 240,
        cruiseHeight: BAT_HOVER,
        diveMs: 260,
        riseMs: 10,
        hitRadius: 12,
        damage: 2,
        knockback: 1,
        hitCooldownMs: 500,
      });
    }
    return this._dive;
  }

  // Damage lives entirely in the dive — no passive touch hazard.
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

    // A shove out of the coil cancels the dive (knockback-immune once diving).
    if (this.interruptOnHit(dtMs)) {
      this.syncCastState();
      return;
    }

    const target = this.pickTarget(players);

    // Mid-dive: let the swoop drive height + movement toward the locked aim.
    if (this.caster.busy) {
      const aim = this.aimAt(target);
      if (target) this.updateFacing(target.dx, target.dy);
      this.caster.update(this, dtMs, aim);
      if (this.caster.phase === "idle") {
        this.restRemaining = this.restMs;
        this.spinDir = this.spinDir === 1 ? -1 : 1;
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
    if (target.dist <= this.diveRange && this.restRemaining <= 0) {
      this.transition("attack");
      this.updateFacing(target.dx, target.dy);
      const aim = this.aimAt(target);
      this.caster.begin(this.dive, aim);
      this.caster.update(this, dtMs, aim);
    } else {
      this.transition("chase");
      this.spiralToward(target, dtMs);
    }
    this.syncCastState();
  }

  // Orbit around a standoff ring: a tangential component (perpendicular to the
  // bat→player line) that WEAVES side to side, plus a radial pull toward the
  // standoff distance (inward when too far, outward when too close). So far away
  // it swings back and forth as it closes, and after a dive it peels out and
  // circles at range instead of crowding — rather than gluing itself to one orbit.
  private spiralToward(target: { dx: number; dy: number }, dtMs: number): void {
    this.orbitClock += dtMs;
    const dist = Math.hypot(target.dx, target.dy) || 1;
    const ux = target.dx / dist;
    const uy = target.dy / dist;

    // Radial: +1 = inward, -1 = outward. Steer toward the standoff ring, easing
    // off as it nears so it settles onto the ring instead of oscillating hard.
    const radial = Math.max(-1, Math.min(1, (dist - this.standoffRadius()) / 60));

    // Tangential weave: sin sweeps the orbit direction through zero and back, so
    // the bat visibly sways left-right rather than tracing a clean circle.
    const weave = Math.sin(this.orbitClock / 300) * this.spinDir;
    const tx = -uy * weave;
    const ty = ux * weave;

    const dx = tx + ux * radial;
    const dy = ty + uy * radial;
    this.move(dx, dy, this.speed);
    this.updateFacing(target.dx, target.dy);
  }

  private aimAt(target: { dx: number; dy: number } | null): AimPoint {
    if (!target) return { x: this.state.x, y: this.state.y };
    return { x: this.state.x + target.dx, y: this.state.y + target.dy };
  }
}
