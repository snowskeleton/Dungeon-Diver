import { EnemyType } from "shared";
import { Spell, swoop } from "../../spells";
import { ApproachCastEnemy } from "./ApproachCastEnemy";
import { spiralApproach } from "./movement";

// How high above the floor the eye-bat hovers (px) — the client lifts the sprite
// and drops a shadow. See Enemy.cruiseHeight.
const BAT_HOVER = 16;

// The Eye Bat: a fast, fragile flyer that spirals in and DIVES at the player. All
// its damage is the dive (swoop) — no passive contact — so it's dodged by not being
// where it skims. Reuses the same swoop builder the flying bosses use, now that a
// rank-and-file Enemy is a FlightCaster (dashStep + setAirHeight).
export class EyeBat extends ApproachCastEnemy {
  static readonly type: EnemyType = "eye-bat";
  protected get knockbackResistance() { return 0; }
  protected get cruiseHeight() { return BAT_HOVER; }

  protected get commitRange(): number { return 75; }
  /** Pause after a dive before it may spiral in for another. */
  protected get restMs(): number { return 2000; }

  // Which way it orbits while closing (flips per dive so it doesn't circle forever).
  private spinDir: 1 | -1 = 1;
  // Accumulates while orbiting; drives the side-to-side weave of the spiral.
  private orbitClock = 0;

  private _dive?: Spell;
  protected get spell(): Spell {
    if (!this._dive) {
      this._dive = swoop({
        id: "eye-bat-dive",
        windUpMs: 400, // the coil-up tell
        recoverMs: 50,
        cooldownMs: 0, // the AI's restMs paces re-dives
        range: this.commitRange,
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

  // After each dive, flip the orbit direction so it peels the other way next time.
  protected override onCastResolved(): void {
    this.spinDir = this.spinDir === 1 ? -1 : 1;
  }

  // Orbit around a standoff ring while weaving side to side (see spiralApproach). The
  // ring is wide while resting after a dive, so it peels OUT and regroups instead of
  // spinning around your head; tight while hunting, so it presses into dive range.
  protected override approach(target: { dx: number; dy: number }, dtMs: number): void {
    const r = spiralApproach({
      orbitClock: this.orbitClock,
      spinDir: this.spinDir,
      targetDx: target.dx,
      targetDy: target.dy,
      standoff: this.resting ? 150 : 55,
      dtMs,
    });
    this.orbitClock = r.orbitClock;
    this.move(r.dx, r.dy, this.speed);
    this.updateFacing(target.dx, target.dy);
  }
}
