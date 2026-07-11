import type Matter from "matter-js";
import { TILE_PROPS, TileId, TILE_DAMAGE_INTERVAL_MS, InteractionProfile } from "shared";
import { EntityState } from "../schema/EntityState";
import { PhysicsWorld, syncStateFromBody } from "../physics/PhysicsWorld";

// Knockback velocity is multiplied by this each tick; combined with the v0
// math in Enemy.applyKnockback it reproduces the old total push distance.
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

  takeDamage(amount: number): void {
    this.state.health = Math.max(0, this.state.health - amount);
  }

  get isDead(): boolean {
    return this.state.health <= 0;
  }

  private tileAt(x: number, y: number): TileId | null {
    return this.physics.tileAt(x, y);
  }
}
