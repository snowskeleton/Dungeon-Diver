import type Matter from "matter-js";
import {
  TILE_PROPS, TileId, TILE_DAMAGE_INTERVAL_MS, InteractionProfile, Attack,
  KNOCKBACK_SCALE, KNOCKBACK_STUN_MS_PER_UNIT, KNOCKBACK_STUN_MAX_MS, SERVER_TICK_MS,
  HurtBounds, PLAYER_HURT_BOUNDS,
} from "shared";
import { EntityState } from "../schema/EntityState";
import { HitSource } from "../combat/HitSource";
import type { SpawnProjectile, SpawnOpts, EnemyClass } from "./Enemy";
import type { AttackStats } from "../spells/Spell";
import { PhysicsWorld, syncStateFromBody } from "../physics/PhysicsWorld";

// A damage effect an entity produced during its tick, drained by GameRoom into the
// combat resolver / projectile pool. A boss channel, a player's swing, and a
// ranged shot all queue these; GameRoom stamps team + owner at drain time.
export type PendingEffect =
  | { kind: "hit"; source: HitSource }
  | { kind: "projectile"; ammoId: string; x: number; y: number; angle: number; opts?: SpawnOpts }
  // A boss ability spawning a minion enemy (the Tengu's Mirror Split). GameRoom
  // drains it into a real enemy in the caster's room. Boss-only in practice.
  | { kind: "summon"; enemy: EnemyClass; x: number; y: number };

// Knockback velocity is multiplied by this each tick; applyKnockback solves the
// resulting geometric series backwards to hit an exact total push distance.
export const KNOCKBACK_DECAY = 0.5;
const KNOCKBACK_CUTOFF = 5; // px/sec — below this, snap to zero

export abstract class Entity {
  abstract state: EntityState;

  body!: Matter.Body;
  protected physics!: PhysicsWorld;
  protected timeSinceLastDamage: number = 0;

  // Per-tick movement intent in px/sec; consumed by commitVelocity().
  private moveVel = { x: 0, y: 0 };
  // Decaying knockback velocity in px/sec; persists across ticks.
  private knockbackVel = { x: 0, y: 0 };
  // Remaining hitstun (ms). While > 0 the entity suspends its own control
  // (enemy AI / player input) so the knockback push isn't immediately walked off.
  protected stunMs = 0;
  // Damage effects queued this tick (swing/channel hitboxes, projectile spawns),
  // drained by GameRoom. This is the `emitHitSource`/`spawnProjectile` half of the
  // spell Caster interface — shared so players and enemies emit effects the same way.
  private pendingEffects: PendingEffect[] = [];

  protected attachBody(
    physics: PhysicsWorld,
    x: number,
    y: number,
    profile: InteractionProfile,
  ): void {
    this.physics = physics;
    this.body = physics.createEntityBody(x, y, profile.layer, profile.solidMask);
  }

  // Records diagonal-normalized movement intent. Walls and entity separation
  // are resolved by the physics step, not here.
  move(dx: number, dy: number, speed: number): void {
    if (dx === 0 && dy === 0) return;
    const len = Math.hypot(dx, dy);
    const v = speed * this.state.speedMultiplier;
    this.moveVel.x = (dx / len) * v;
    this.moveVel.y = (dy / len) * v;
  }

  addKnockback(vx: number, vy: number): void {
    this.knockbackVel.x = vx;
    this.knockbackVel.y = vy;
  }

  // Called once per tick by GameRoom, just before the engine step.
  commitVelocity(): void {
    this.physics.setVelocityPxPerSec(
      this.body,
      this.moveVel.x + this.knockbackVel.x,
      this.moveVel.y + this.knockbackVel.y,
    );
    this.moveVel.x = 0;
    this.moveVel.y = 0;
    this.knockbackVel.x *= KNOCKBACK_DECAY;
    this.knockbackVel.y *= KNOCKBACK_DECAY;
    if (Math.hypot(this.knockbackVel.x, this.knockbackVel.y) < KNOCKBACK_CUTOFF) {
      this.knockbackVel.x = 0;
      this.knockbackVel.y = 0;
    }
  }

  // Called once per tick by GameRoom, just after the engine step.
  syncFromBody(): void {
    syncStateFromBody(this.state, this.body);
  }

  // ── Effect emission (the Caster half shared by players + enemies) ────────────
  /** Queue a transient hit region for this tick (a swing / channel hitbox). */
  emitHitSource(source: HitSource): void {
    this.pendingEffects.push({ kind: "hit", source });
  }

  /** Queue a projectile to spawn this tick. GameRoom stamps team + owner on drain. */
  spawnProjectile: SpawnProjectile = (ammoId, x, y, angle, opts) => {
    this.pendingEffects.push({ kind: "projectile", ammoId, x, y, angle, opts });
  };

  /** Queue a minion enemy to spawn this tick (a boss summon). GameRoom places it
   *  in the caster's room. Protected so only a Boss (via SummonCaster) exposes it. */
  protected emitSummon(enemy: EnemyClass, x: number, y: number): void {
    this.pendingEffects.push({ kind: "summon", enemy, x, y });
  }

  /** Hand this tick's queued effects to GameRoom and clear the buffer. */
  drainEffects(): PendingEffect[] {
    if (this.pendingEffects.length === 0) return this.pendingEffects;
    const out = this.pendingEffects;
    this.pendingEffects = [];
    return out;
  }

  teleport(x: number, y: number): void {
    this.physics.setEntityPosition(this.body, x, y);
    this.state.x = x;
    this.state.y = y;
    this.moveVel.x = 0;
    this.moveVel.y = 0;
    this.knockbackVel.x = 0;
    this.knockbackVel.y = 0;
  }

  applyTileEffects(dtMs: number): void {
    const tile = this.tileAt(this.state.x, this.state.y);
    if (tile === null) return;
    const props = TILE_PROPS[tile];

    if (props.effect === "slow") {
      this.state.speedMultiplier = props.speedMultiplier ?? 0.35;
    } else {
      this.state.speedMultiplier = 1;
    }

    if (props.effect === "damage") {
      this.timeSinceLastDamage += dtMs;
      if (this.timeSinceLastDamage >= TILE_DAMAGE_INTERVAL_MS) {
        this.timeSinceLastDamage = 0;
        // effectAmount is HP per second; deal one interval's worth per trigger.
        this.takeDamage((props.effectAmount ?? 0) * (TILE_DAMAGE_INTERVAL_MS / 1000));
      }
    } else {
      this.timeSinceLastDamage = 0;
    }
  }

  /** Applies `amount` and returns how much HP was ACTUALLY removed — less than
   *  asked for when the hit overkills, which is what a lifesteal or damage-dealt
   *  readout wants to hear. */
  takeDamage(amount: number): number {
    const before = this.state.health;
    this.state.health = Math.max(0, this.state.health - amount);
    return before - this.state.health;
  }

  // ── CombatTarget: how a hit lands on this body (see combat/CombatSystem) ──────
  // Receive a resolved hit: take the damage, then get shoved + stunned away from
  // the blow's origin. Symmetric — players and enemies both flinch (the Attack's
  // knockback may be 0, e.g. plain contact, in which case there's no push).
  //
  // Returns the damage actually dealt. This is stage 4 of the attack pipeline and
  // the seam where mitigation belongs: a Player subtracts armor here, and per-enemy
  // damage-type vulnerabilities will land here too. Because the applied number is
  // returned rather than assumed, anything downstream (lifesteal) stays honest when
  // a target mitigates or is overkilled.
  takeHit(attack: Attack): number {
    const dealt = this.takeDamage(attack.damage);
    this.applyKnockback(attack.sourceX, attack.sourceY, attack.knockback);
    return dealt;
  }

  // ── Attack pipeline, stage 3: the caster's own offensive scaling ─────────────
  // The identity lives here so EVERY caster satisfies the interface for free and
  // enemies/bosses keep emitting exactly the numbers their spells computed. Only
  // Player overrides scaleAttack (to fold its upgrades); buildAttack is shared and
  // never needs overriding, since positioning a blow is the same for everyone.
  scaleAttack(base: AttackStats): AttackStats {
    return base;
  }

  buildAttack(base: AttackStats, sourceX: number, sourceY: number): Attack {
    const scaled = this.scaleAttack(base);
    return {
      damage: scaled.damage,
      knockback: scaled.knockback,
      sourceX,
      sourceY,
    };
  }

  /** How much knockback force this body absorbs before it's shoved. 0 = takes the
   *  full hit (players default). Enemies override with a per-type resistance. */
  protected get knockbackResistance(): number {
    return 0;
  }

  get isStunned(): boolean {
    return this.stunMs > 0;
  }

  // Push + stun away from (fromX, fromY). `overage = force − resistance` is how
  // much the hit cleared this body's resistance: overage ≤ 0 → fully shrugged off
  // (no push, no stun). Above the threshold, push distance = overage ×
  // KNOCKBACK_SCALE px (delivered as a decaying impulse the physics step sweeps
  // against walls) and the body is stunned for a scaled duration. A corpse/dead
  // body is never shoved.
  applyKnockback(fromX: number, fromY: number, force: number): void {
    if (this.isDead) return;
    const overage = force - this.knockbackResistance;
    if (overage <= 0) return; // didn't clear resistance → ignored entirely

    const dx = this.state.x - fromX;
    const dy = this.state.y - fromY;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return;

    const push = overage * KNOCKBACK_SCALE;
    // Geometric series: total displacement = v0*dt / (1 − decay) = push.
    const v0 = (push * (1 - KNOCKBACK_DECAY)) / (SERVER_TICK_MS / 1000);
    this.addKnockback((dx / dist) * v0, (dy / dist) * v0);

    this.stunMs = Math.min(KNOCKBACK_STUN_MAX_MS, overage * KNOCKBACK_STUN_MS_PER_UNIT);
    this.state.stunned = true;
  }

  // Advances the hitstun timer. Returns true while still stunned — callers skip
  // the rest of their control tick so the knockback impulse (carried by
  // commitVelocity) lands cleanly. Shared by enemy AI and player input.
  updateStun(dtMs: number): boolean {
    if (this.stunMs > 0) {
      this.stunMs -= dtMs;
      if (this.stunMs <= 0) {
        this.stunMs = 0;
        this.state.stunned = false;
      }
      return true;
    }
    return false;
  }

  /** The region this body can be DAMAGED on — the drawn sprite's extent, not the
   *  physics body's. Walking bounds and hurt bounds are deliberately separate
   *  questions: ENTITY_RADIUS is a 5px circle at the feet that decides what you
   *  bump into, while this is the whole visible creature.
   *
   *  Both concrete subclasses override with numbers MEASURED FROM THEIR ART
   *  (Player → PLAYER_HURT_BOUNDS, Enemy → ENEMY_HURT_BOUNDS[type]); the humanoid
   *  box is the default so a future Entity subclass is never a bare point. */
  get hurtBounds(): HurtBounds {
    return PLAYER_HURT_BOUNDS;
  }

  /** False once dead so a corpse takes no further hits. Enemies override to gate
   *  on their death animation (isDying) rather than raw health. */
  get damageable(): boolean {
    return !this.isDead;
  }

  /** Sprite-centre world position (the schema x/y). Convenience for combat/spell
   *  code that shouldn't reach through `.state`. */
  get x(): number {
    return this.state.x;
  }
  get y(): number {
    return this.state.y;
  }

  get isDead(): boolean {
    return this.state.health <= 0;
  }

  private tileAt(x: number, y: number): TileId | null {
    return this.physics.tileAt(x, y);
  }
}
