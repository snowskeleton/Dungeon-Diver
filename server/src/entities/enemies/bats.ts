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
  protected get speed() { return 110; }
  protected get aggroRadius() { return 240; }
  protected get knockbackResistance() { return 0; }
  protected get cruiseHeight() { return BAT_HOVER; }

  /** Center-to-center distance at which it commits to a dive. */
  private get diveRange(): number { return 170; }
  /** Pause after a dive before it may spiral in for another. */
  private get restMs(): number { return 700; }
  private restRemaining = 0;
  // Which way it orbits while closing (flips per dive so it doesn't circle forever).
  private spinDir: 1 | -1 = 1;

  private _dive?: Spell;
  private get dive(): Spell {
    if (!this._dive) {
      this._dive = swoop({
        id: "eye-bat-dive",
        windUpMs: 340, // the coil-up tell
        recoverMs: 220,
        cooldownMs: 0, // the AI's restMs paces re-dives
        range: this.diveRange,
        aimLockMs: 120,
        cruiseHeight: BAT_HOVER,
        diveMs: 260,
        riseMs: 300,
        hitRadius: 18,
        damage: 8,
        knockback: 4,
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
      this.spiralToward(target);
    }
    this.syncCastState();
  }

  // Orbit-and-approach: a tangential component (perpendicular to the bat→player
  // line) plus a gentle inward pull, so it spirals in rather than beelining.
  private spiralToward(target: { dx: number; dy: number }): void {
    const tx = -target.dy * this.spinDir;
    const ty = target.dx * this.spinDir;
    // Blend: mostly tangent, a bit inward. Not normalized — move() handles that.
    const dx = tx + target.dx * 0.6;
    const dy = ty + target.dy * 0.6;
    this.move(dx, dy, this.speed);
    this.updateFacing(target.dx, target.dy);
  }

  private aimAt(target: { dx: number; dy: number } | null): AimPoint {
    if (!target) return { x: this.state.x, y: this.state.y };
    return { x: this.state.x + target.dx, y: this.state.y + target.dy };
  }
}
