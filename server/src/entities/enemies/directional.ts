import { EnemyType, EnemyFacingMode, WeaponId } from "shared";
import { PlayerState } from "../../schema/PlayerState";
import { HitSource } from "../../combat/HitSource";
import { Spell, dashAttack, AimPoint } from "../../spells";
import { Enemy } from "../Enemy";
import { ArmedEnemy } from "./armed";
import { CastingEnemy } from "./casting";

// Enemies drawn with a row per facing (up/right/down/left), so they track all
// four directions and are never mirrored. Shared here as a base so each one only
// declares its id. Bones is the plain chaser; the beasts and the armor-lancer WIELD
// WEAPONS and swing them with a wind-up (see ArmedEnemy); Fang lunges (see below).
abstract class DirectionalEnemy extends Enemy {
  protected get facingMode(): EnemyFacingMode { return "directional"; }
}

export class Bones extends DirectionalEnemy { static readonly type: EnemyType = "bones"; }

// The snake: winds up (coils) then LUNGES at the player, a fast contact dash — its
// only damage (no passive touch). PLACEHOLDER: the lunge reuses the existing move
// frames (the body just darts forward); dedicated fang-lash art is still needed
// (see docs + roadmap). Uses the shared dashAttack builder.
export class Fang extends CastingEnemy {
  static readonly type: EnemyType = "fang";
  protected get facingMode(): EnemyFacingMode { return "directional"; }
  protected get maxHp() { return 40; }
  protected get speed() { return 85; }
  protected get aggroRadius() { return 240; }

  private get lungeRange(): number { return 90; }
  private get restMs(): number { return 650; }
  private restRemaining = 0;

  private _lunge?: Spell;
  private get lunge(): Spell {
    if (!this._lunge) {
      this._lunge = dashAttack({
        id: "fang-lunge",
        windUpMs: 300, // the coil tell
        recoverMs: 240,
        cooldownMs: 0, // restMs paces re-lunges
        range: this.lungeRange,
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
    if (target.dist <= this.lungeRange && this.restRemaining <= 0) {
      this.transition("attack");
      this.updateFacing(target.dx, target.dy);
      const aim = this.aimAt(target);
      this.caster.begin(this.lunge, aim);
      this.caster.update(this, dtMs, aim);
    } else {
      this.transition("chase");
      this.pathToward(target);
    }
    this.syncCastState();
  }

  private aimAt(target: { dx: number; dy: number } | null): AimPoint {
    if (!target) return { x: this.state.x, y: this.state.y };
    return { x: this.state.x + target.dx, y: this.state.y + target.dy };
  }
}

export class SwordBeast extends ArmedEnemy {
  static readonly type: EnemyType = "sword-beast";
  protected get weaponId(): WeaponId { return "beast-sword"; }
}
export class AxeBeast extends ArmedEnemy {
  static readonly type: EnemyType = "axe-beast";
  protected get weaponId(): WeaponId { return "beast-axe"; }
}
export class MaceBeast extends ArmedEnemy {
  static readonly type: EnemyType = "mace-beast";
  protected get weaponId(): WeaponId { return "beast-mace"; }
}
export class ArmorLancer extends ArmedEnemy {
  static readonly type: EnemyType = "armor-lancer";
  protected get weaponId(): WeaponId { return "lance"; }
  // The lance out-reaches a sword, so commit to the thrust from further out.
  protected get attackRange(): number { return 58; }
}
