import { EnemyFacingMode, Weapon, WeaponInstance } from "shared";
import { PlayerState } from "../../schema/PlayerState";
import { Spell, weaponSpell, retimedSpell } from "../../spells";
import { CastingEnemy } from "./CastingEnemy";

// A rank-and-file enemy that WIELDS A REAL WEAPON and swings it with a wind-up,
// instead of dealing passive touch damage. The swing IS the attack: it runs the
// same weaponSpell a player's swing runs, so the blade's hurtbox and timing come
// from the weapon art (fxHurtboxes) and the wind-up hold is the weapon's own
// attackCooldownMs — nothing here is a hand-tuned reach number. The sword/axe/mace
// beasts and the armor-lancer are ArmedEnemies.
//
// It keeps its own tick (rather than ApproachCastEnemy's) because its in-range-but-
// resting branch HOLDS AND FACES rather than continuing to approach — a swinger
// planted at sword's length, not a diver circling for another pass.
export abstract class ArmedEnemy extends CastingEnemy {
  /** The weapon this enemy swings, as a direct template object. Server-only — an
   *  enemy's armament never crosses the wire (the client draws it from the enemy's
   *  own visual def), so it is a real object reference, not an id lookup. */
  protected abstract get weaponTemplate(): Weapon;

  private _weapon?: WeaponInstance;
  private _spell?: Spell;

  protected get facingMode(): EnemyFacingMode { return "directional"; }

  /** Center-to-center distance at which the enemy commits to a swing. An AI trigger
   *  distance — like aggroRadius/attackRadius — NOT the damage geometry (the hitbox
   *  is derived from the weapon FX art). Override to match a weapon's reach. */
  protected get attackRange(): number { return 34; }

  /** Telegraph before the blow lands (ms) — the readable rear-back the player reacts
   *  to. This is the ENEMY's dial, deliberately decoupled from the weapon's own
   *  wind-up (a player weapon telegraphs in ~120ms, which is invisible on an enemy).
   *  Heavier weapons should wind up longer. */
  protected get windUpMs(): number { return 450; }

  /** Minimum time between attacks (ms), measured from the end of one swing to the
   *  start of the next — the enemy's rate of fire. Same meaning as the base
   *  Enemy.attackCooldownMs (which paces contact damage), so overriding it on a
   *  subclass Just Works. Defaults slower than the base touch cadence because a
   *  telegraphed weapon swing is a bigger commitment than a passive touch. */
  protected get attackCooldownMs(): number { return 1400; }

  protected get weapon(): WeaponInstance {
    if (!this._weapon) {
      this._weapon = new WeaponInstance(this.weaponTemplate, `${this.typeId}-weapon`);
    }
    return this._weapon;
  }

  // The weapon's swing/shot, RETIMED to the enemy's telegraph and cadence: the
  // weapon supplies the hitbox and projectile, the enemy supplies the wind-up and
  // the recast cooldown. The spell owns that cooldown, so `spell.isReady` is the
  // between-swings gate — no separate rest counter to keep in sync.
  private get spell(): Spell {
    if (!this._spell) {
      this._spell = retimedSpell(weaponSpell(this.weapon), {
        windUpMs: this.windUpMs,
        cooldownMs: this.attackCooldownMs,
        recoverMs: 0,
      });
    }
    return this._spell;
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

    // A stun OR any shove mid-swing cancels it (see CastingEnemy.interruptOnHit);
    // when stunned, skip the AI this tick so the knockback impulse rides out.
    if (this.interruptOnHit(dtMs)) {
      this.syncCastState();
      return;
    }

    const target = this.pickTarget(players);

    // Already mid-swing: hold position, keep facing the target during the wind-up
    // (the aim tracks until the spell's aimLock), and advance the cast.
    if (this.caster.busy) {
      if (target) this.updateFacing(target.dx, target.dy);
      const aim = this.aimAt(target);
      this.caster.update(this, dtMs, aim);
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
    const inRange = target.dist <= this.attackRange;

    if (inRange && this.spell.isReady(this.caster.now)) {
      this.transition("attack");
      this.updateFacing(target.dx, target.dy);
      const aim = this.aimAt(target);
      this.caster.begin(this.spell, aim);
      this.caster.update(this, dtMs, aim);
    } else if (inRange) {
      // In range but still on cooldown: hold at weapon's length and face the target,
      // waiting out the recast rather than crowding in for a touch it can't deal.
      this.transition("attack");
      this.updateFacing(target.dx, target.dy);
    } else {
      this.transition("chase");
      this.pathToward(target);
    }
    this.syncCastState();
  }
}
