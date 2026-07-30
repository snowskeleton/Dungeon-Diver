import { EnemyFacingMode, WeaponId, WEAPON_REGISTRY, WeaponInstance } from "shared";
import { PlayerState } from "../../schema/PlayerState";
import { Enemy } from "../Enemy";
import { HitSource } from "../../combat/HitSource";
import { Spell, SpellCaster, weaponSpell, AimPoint } from "../../spells";

// A rank-and-file enemy that WIELDS A REAL WEAPON and swings it with a wind-up,
// instead of dealing passive touch damage. The swing IS the attack: it runs the
// same weaponSpell a player's swing runs, so the blade's hurtbox and timing come
// from the weapon art (fxHurtboxes) and the wind-up hold is the weapon's own
// attackCooldownMs — nothing here is a hand-tuned reach number. The sword/axe/mace
// beasts and the armor-lancer are ArmedEnemies.
//
// This is the first non-boss enemy to carry a SpellCaster. It reuses the boss's
// telegraph/channeling schema fields (they live on EnemyState) so the client's
// existing wind-up tint reads the swing with no new client code.
export abstract class ArmedEnemy extends Enemy {
  /** The wire weapon id this enemy swings (a key of WEAPON_REGISTRY). */
  protected abstract get weaponId(): WeaponId;

  private readonly caster = new SpellCaster();
  private _weapon?: WeaponInstance;
  private _spell?: Spell;
  // Rest between swings so it doesn't chain arcs with no gap (the melee weaponSpell
  // has no cooldown of its own — the active arc is a player's re-fire gate). This is
  // the enemy's post-swing pause, an AI feel dial like attackCooldownMs.
  private restMs = 0;

  protected get facingMode(): EnemyFacingMode { return "directional"; }

  /** Center-to-center distance at which the enemy commits to a swing. An AI trigger
   *  distance — like aggroRadius/attackRadius — NOT the damage geometry (the hitbox
   *  is derived from the weapon FX art). Override to match a weapon's reach. */
  protected get attackRange(): number { return 34; }

  /** Pause after a swing finishes before the next may begin (ms). */
  protected get attackRestMs(): number { return 700; }

  protected get weapon(): WeaponInstance {
    if (!this._weapon) {
      this._weapon = new WeaponInstance(WEAPON_REGISTRY[this.weaponId], `${this.typeId}-weapon`);
    }
    return this._weapon;
  }

  private get spell(): Spell {
    if (!this._spell) this._spell = weaponSpell(this.weapon);
    return this._spell;
  }

  // The swing carries all the damage — no passive contact hazard.
  override contactHitSource(): HitSource | null {
    return null;
  }

  // Mirror the cast lifecycle onto the schema the same way Boss does, so the
  // client's telegraph tint (wind-up) and channel state (mid-swing) light up.
  private syncCastState(): void {
    this.state.telegraph = this.caster.windingUp;
    this.state.channeling = this.caster.phase === "active";
    this.state.abilityId = this.caster.activeSpellId;
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
    if (this.restMs > 0) this.restMs -= dtMs;

    // A stun mid-swing staggers it: interrupt the cast and skip the AI this tick.
    if (this.updateStun(dtMs)) {
      this.caster.interrupt();
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
      if (this.caster.phase === "idle") this.restMs = this.attackRestMs;
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

    if (target.dist <= this.attackRange && this.restMs <= 0) {
      this.transition("attack");
      this.state.targetId = target.id;
      this.updateFacing(target.dx, target.dy);
      const aim = this.aimAt(target);
      this.caster.begin(this.spell, aim);
      this.caster.update(this, dtMs, aim);
      if (this.caster.phase === "idle") this.restMs = this.attackRestMs;
    } else {
      this.transition(target.dist <= this.attackRange ? "attack" : "chase");
      this.state.targetId = target.id;
      if (target.dist > this.attackRange) this.pathToward(target);
      else this.updateFacing(target.dx, target.dy);
    }
    this.syncCastState();
  }

  private aimAt(target: { dx: number; dy: number } | null): AimPoint {
    if (!target) return { x: this.state.x, y: this.state.y };
    return { x: this.state.x + target.dx, y: this.state.y + target.dy };
  }
}
