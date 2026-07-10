import { KNOCKBACK_SCALE, KNOCKBACK_STUN_MS_PER_UNIT, KNOCKBACK_STUN_MAX_MS, AiState, SERVER_TICK_MS, EnemyConfig } from "shared";
import { EnemyState } from "../schema/EnemyState";
import { PlayerState } from "../schema/PlayerState";
import { Entity, KNOCKBACK_DECAY } from "./Entity";
import { PhysicsWorld, CAT } from "../physics/PhysicsWorld";

const PATROL_RANGE = 64;

export abstract class Enemy extends Entity {
  state: EnemyState;
  protected cfg: EnemyConfig;
  // Set to true the first tick after isDying becomes true so GameRoom only
  // calls FloorManager.onEnemyMaybeCleared once per enemy death.
  clearCheckDone = false;
  private patrolOriginX: number;
  private patrolOriginY: number;
  private patrolAngle: number = Math.random() * Math.PI * 2;
  private attackCooldown: number = 0;
  // Remaining hitstun (ms). While > 0 the enemy suspends its AI (no chase, no
  // attack) so the knockback push isn't immediately cancelled by chasing.
  private stunMs: number = 0;

  constructor(physics: PhysicsWorld, startX: number, startY: number, cfg: EnemyConfig) {
    super();
    this.cfg = cfg;
    this.state = new EnemyState();
    this.state.x = startX;
    this.state.y = startY;
    this.state.health = cfg.maxHp;
    this.patrolOriginX = startX;
    this.patrolOriginY = startY;
    this.attachBody(physics, startX, startY, CAT.ENEMY);
  }

  get isDying(): boolean {
    return this.state.isDying;
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

  // Push + stun the enemy away from (fromX, fromY). `overage = force − resistance`
  // is how much the hit cleared the enemy's resistance: overage ≤ 0 → the hit is
  // fully shrugged off (no push, no stun — heavy enemies ignore weak hits). Above
  // the threshold, push distance = overage * KNOCKBACK_SCALE px (delivered as a
  // decaying impulse the physics step sweeps against walls) and the enemy is
  // stunned for a scaled duration so its chase can't immediately eat the push.
  applyKnockback(fromX: number, fromY: number, force: number): void {
    if (this.state.isDying) return;
    const overage = force - this.cfg.knockbackResistance;
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

  tick(
    players: Map<string, PlayerState>,
    dtMs: number,
    dealDamageToPlayer: (sessionId: string, amount: number) => void,
  ): void {
    if (this.state.isDying) return;

    // Hitstun: skip all AI (no chase, no attack) so the knockback impulse lands
    // cleanly. The impulse itself still carries via commitVelocity() each tick.
    if (this.stunMs > 0) {
      this.stunMs -= dtMs;
      if (this.stunMs <= 0) {
        this.stunMs = 0;
        this.state.stunned = false;
      }
      return;
    }

    // Tile effects run in GameRoom after the physics step (post-step positions).
    if (this.attackCooldown > 0) this.attackCooldown -= dtMs;

    const closest = this.closestPlayer(players);

    if (!closest) {
      this.patrol(dtMs);
      return;
    }

    const { id, dist, dx, dy } = closest;

    if (dist <= this.cfg.attackRadius) {
      this.transition("attack");
      this.state.targetId = id;
      if (this.attackCooldown <= 0) {
        dealDamageToPlayer(id, this.cfg.attackDamage);
        this.attackCooldown = this.cfg.attackCooldownMs;
      }
    } else if (dist <= this.cfg.aggroRadius) {
      this.transition("chase");
      this.state.targetId = id;
      this.move(dx, dy, this.cfg.speed);
      this.updateFacing(dx, dy);
    } else {
      this.transition("patrol");
      this.state.targetId = "";
      this.patrol(dtMs);
    }
  }

  private patrol(dtMs: number): void {
    this.patrolAngle += 0.4 * (dtMs / 1000);
    const tx = this.patrolOriginX + Math.cos(this.patrolAngle) * PATROL_RANGE;
    const ty = this.patrolOriginY + Math.sin(this.patrolAngle) * PATROL_RANGE;
    const dx = tx - this.state.x;
    const dy = ty - this.state.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) return;
    // Clamp so one tick's step never overshoots the orbit target — the old
    // position-based move clamped implicitly; raw velocity would oscillate.
    const speed = Math.min(this.cfg.speed * 0.5, dist / (SERVER_TICK_MS / 1000));
    this.move(dx, dy, speed);
    this.updateFacing(dx, dy);
  }

  private closestPlayer(
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

  private transition(next: AiState): void {
    this.state.aiState = next;
  }

  // Subclasses can override to restrict which directions are tracked.
  // Base behavior: full 4-directional facing.
  protected updateFacing(dx: number, dy: number): void {
    if (Math.abs(dx) > Math.abs(dy)) {
      this.state.facing = dx > 0 ? "right" : "left";
    } else if (dy !== 0) {
      this.state.facing = dy > 0 ? "down" : "up";
    }
  }
}
