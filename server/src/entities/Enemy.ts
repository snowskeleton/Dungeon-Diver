import { AiState, SERVER_TICK_MS, EnemyType, EnemyFacingMode, ENEMY_BODY_PROFILE, ENEMY_ATTACK_AFFECTS } from "shared";
import { EnemyState } from "../schema/EnemyState";
import { PlayerState } from "../schema/PlayerState";
import { Entity } from "./Entity";
import { HitSource } from "../combat/HitSource";
import { PhysicsWorld } from "../physics/PhysicsWorld";

const PATROL_RANGE = 64;

/** Per-spawn overrides for a projectile a boss emits. `lifetimeMs` lets a timed
 *  ground hazard (tremor shards) clear a whole staggered batch on one tick.
 *  `inert` makes the projectile a pure visual/telegraph marker — it renders and
 *  expires but never hit-tests, because the ability's channel owns a single
 *  consolidated hitbox instead of one per marker (the Turtle Dragon's tremor). */
export interface SpawnOpts {
  lifetimeMs?: number;
  inert?: boolean;
}

/** Lets an enemy emit a projectile during its tick (bosses' ranged attacks).
 *  The owner id is the enemy's own map key; `affects` is stamped by GameRoom. */
export type SpawnProjectile = (
  ammoId: string,
  x: number,
  y: number,
  angleRad: number,
  opts?: SpawnOpts,
) => void;

/** A concrete enemy class: `new`-able and carrying its `EnemyType` id statically,
 *  so the spawn lists in entities/enemies can be plain arrays of classes that the
 *  compiler still checks — no id→class lookup table. */
export type EnemyClass = { new (physics: PhysicsWorld, x: number, y: number): Enemy; readonly type: EnemyType };

// Base class for every enemy. Behaviour lives here and in subclasses — never in a
// data blob steered by a lookup table (see the engineering-approach note in
// CLAUDE.md). The default tick is the standard chase-and-melee AI; a subclass
// that wants something else (a boss's telegraphed moveset) overrides tick().
//
// Stats are plain getters with functional placeholder defaults: a brand-new
// enemy is a working chaser out of the box, and tuning it — or giving it a
// distinct stat — is a one-line getter override, all compiler-checked. Bosses
// and specific enemies override what they need.
export abstract class Enemy extends Entity {
  state: EnemyState;
  // Set true the first tick after isDying so GameRoom runs the room-clear check
  // once per death.
  clearCheckDone = false;
  protected patrolOriginX: number;
  protected patrolOriginY: number;
  private patrolAngle: number = Math.random() * Math.PI * 2;
  private attackCooldown: number = 0;

  // ── Stats (override per enemy) ──────────────────────────────────────────────
  protected get maxHp(): number { return 60; }
  protected get speed(): number { return 70; }
  protected get aggroRadius(): number { return 160; }
  // Center-to-center; must exceed 2×ENTITY_RADIUS (10px) or attacks never land.
  protected get attackRadius(): number { return 14; }
  protected get attackDamage(): number { return 10; }
  protected get attackCooldownMs(): number { return 1200; }
  /** 0 = full knockback; higher absorbs more force. */
  protected get knockbackResistance(): number { return 3; }
  /** "horizontal" art has one side view (flipX for left); "directional" has a
   *  row per facing. Must match the client visual def for this enemy. */
  protected get facingMode(): EnemyFacingMode { return "horizontal"; }

  /** This enemy's id, read from the concrete subclass's `static readonly type`. */
  protected get typeId(): EnemyType {
    return (this.constructor as unknown as { type: EnemyType }).type;
  }

  constructor(physics: PhysicsWorld, startX: number, startY: number) {
    super();
    this.state = new EnemyState();
    this.state.x = startX;
    this.state.y = startY;
    this.state.health = this.maxHp;
    this.state.maxHealth = this.maxHp;
    this.state.enemyType = this.typeId;
    // Mirrored into state so the client's debug overlay can draw the true ranges
    // without a second copy of the numbers.
    this.state.aggroRadius = this.aggroRadius;
    this.state.attackRadius = this.attackRadius;
    this.patrolOriginX = startX;
    this.patrolOriginY = startY;
    this.attachBody(physics, startX, startY, ENEMY_BODY_PROFILE);
  }

  get isDying(): boolean {
    return this.state.isDying;
  }

  /** A dying enemy plays its death animation but takes no further hits. */
  override get damageable(): boolean {
    return !this.state.isDying;
  }

  // A contact/touch attack: while alive, un-stunned, and off cooldown, the enemy's
  // body is a hazard out to attackRadius. Emitted each tick to the combat resolver
  // (see GameRoom.tick); the claim consumes the shared attack cooldown so one
  // eruption lands on one player per cooldown, matching the old melee behaviour.
  // Bosses deal no passive contact damage and override this to null.
  contactHitSource(id: string): HitSource | null {
    if (this.state.isDying || this.state.stunned || this.attackCooldown > 0 || this.attackDamage <= 0) {
      return null;
    }
    let claimed = false;
    return {
      shape: { kind: "circle", cx: this.state.x, cy: this.state.y, r: this.attackRadius },
      affects: ENEMY_ATTACK_AFFECTS,
      ownerId: id,
      // Contact deals no knockback to players (matches the old dealDamageToPlayer path).
      attack: { damage: this.attackDamage, knockback: 0, sourceX: this.state.x, sourceY: this.state.y },
      claim: () => {
        if (claimed) return false;
        claimed = true;
        this.attackCooldown = this.attackCooldownMs;
        return true;
      },
    };
  }

  takeDamage(amount: number): void {
    if (this.state.isDying) return;
    super.takeDamage(amount);
    if (this.state.health <= 0) {
      this.state.isDying = true;
      // Corpse must not block (or be shoved by) other entities while it
      // plays its 5s death animation; it still respects walls.
      this.physics.setEntityDead(this.body);
    }
  }

  // Standard enemy AI: patrol until a player is in aggro range, chase, and melee
  // in attack range. Bosses override this entirely. Contact damage itself is no
  // longer dealt here — it's emitted as a HitSource (contactHitSource) and applied
  // by the combat resolver; this only drives movement and the attack animation.
  tick(players: Map<string, PlayerState>, dtMs: number): void {
    if (this.state.isDying) return;
    if (this.updateStun(dtMs)) return;

    if (this.attackCooldown > 0) this.attackCooldown -= dtMs;

    const closest = this.closestPlayer(players);
    if (!closest) {
      this.patrol(dtMs);
      return;
    }

    const { id, dist, dx, dy } = closest;

    if (dist <= this.attackRadius) {
      this.transition("attack");
      this.state.targetId = id;
    } else if (dist <= this.aggroRadius) {
      this.transition("chase");
      this.state.targetId = id;
      this.chase(dx, dy);
    } else {
      this.transition("patrol");
      this.state.targetId = "";
      this.patrol(dtMs);
    }
  }

  // Reusable movement helpers subclasses (e.g. bosses) can call.
  protected chase(dx: number, dy: number): void {
    this.move(dx, dy, this.speed);
    this.updateFacing(dx, dy);
  }

  protected patrol(dtMs: number): void {
    this.patrolAngle += 0.4 * (dtMs / 1000);
    const tx = this.patrolOriginX + Math.cos(this.patrolAngle) * PATROL_RANGE;
    const ty = this.patrolOriginY + Math.sin(this.patrolAngle) * PATROL_RANGE;
    const dx = tx - this.state.x;
    const dy = ty - this.state.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) return;
    // Clamp so one tick's step never overshoots the orbit target — the old
    // position-based move clamped implicitly; raw velocity would oscillate.
    const speed = Math.min(this.speed * 0.5, dist / (SERVER_TICK_MS / 1000));
    this.move(dx, dy, speed);
    this.updateFacing(dx, dy);
  }

  protected closestPlayer(
    players: Map<string, PlayerState>,
  ): { id: string; dist: number; dx: number; dy: number } | null {
    let best: { id: string; dist: number; dx: number; dy: number } | null = null;
    players.forEach((p, id) => {
      const dx = p.x - this.state.x;
      const dy = p.y - this.state.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (!best || dist < best.dist) best = { id, dist, dx, dy };
    });
    return best;
  }

  protected transition(next: AiState): void {
    this.state.aiState = next;
  }

  // Directional art has a row per facing, so track all four. Horizontal art only
  // has a side view, so never face up/down (the client would have no frame).
  protected updateFacing(dx: number, dy: number): void {
    if (this.facingMode === "directional") {
      if (Math.abs(dx) > Math.abs(dy)) {
        this.state.facing = dx > 0 ? "right" : "left";
      } else if (dy !== 0) {
        this.state.facing = dy > 0 ? "down" : "up";
      }
    } else if (dx !== 0) {
      this.state.facing = dx > 0 ? "right" : "left";
    }
  }
}
