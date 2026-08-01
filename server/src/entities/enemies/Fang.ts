import { EnemyType, EnemyFacingMode } from "shared";
import { Spell, dashAttack } from "../../spells";
import { ApproachCastEnemy } from "./ApproachCastEnemy";

// The snake: winds up (coils) then LUNGES at the player, a fast contact dash — its
// only damage (no passive touch). PLACEHOLDER: the lunge reuses the existing move
// frames (the body just darts forward); dedicated fang-lash art is still needed
// (see docs + roadmap). Uses the shared dashAttack builder and the default straight
// approach; directional art, so it faces all four ways.
export class Fang extends ApproachCastEnemy {
  static readonly type: EnemyType = "fang";
  protected get facingMode(): EnemyFacingMode { return "directional"; }

  protected get commitRange(): number { return 90; }
  protected get restMs(): number { return 650; }

  private _lunge?: Spell;
  protected get spell(): Spell {
    if (!this._lunge) {
      this._lunge = dashAttack({
        id: "fang-lunge",
        windUpMs: 300, // the coil tell
        recoverMs: 240,
        cooldownMs: 0, // restMs paces re-lunges
        range: this.commitRange,
        aimLockMs: 120,
        speed: 340,
        maxBounces: 0, // a single straight dart, no ricochet
        durationMs: 220,
        hitRadius: 16,
        damage: 10,
        hitCooldownMs: 500,
      });
    }
    return this._lunge;
  }
}
