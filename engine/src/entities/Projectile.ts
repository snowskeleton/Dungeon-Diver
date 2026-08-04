import { AmmoConfig, TILE_PROPS, TileId, TILE_SIZE } from "shared";
import { ProjectileState } from "../schema/ProjectileState";
import { HitSource } from "../combat/HitSource";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import type { AttackStats } from "../spells/Spell";

// A kinematic projectile (arrow, fireball, thrown weapon). Not a matter-js body:
// it integrates its own position each tick, despawns on a wall tile or after its
// lifetime, and does a swept overlap test against candidate targets. Which
// targets it can damage is decided by `affects` (a Layer mask) — a player arrow
// carries ENEMY, a boss fireball carries PLAYER — so the same class serves both
// teams. See docs/layers.md. Pierce lets one shot pass through several targets.
export class Projectile {
  state: ProjectileState;
  readonly cfg: AmmoConfig;
  readonly ownerSessionId: string;
  /** Which Layer(s) this projectile's hits reach (directional). */
  readonly affects: number;
  dead = false;
  // Position at the start of the current tick — used as the knockback source so
  // enemies get pushed along the arrow's travel direction.
  prevX: number;
  prevY: number;

  private physics: PhysicsWorld;
  private vx: number;
  private vy: number;
  private ageMs = 0;
  private readonly lifetimeMs: number;
  /** The damage/knockback this shot delivers — resolved at the muzzle, not read
   *  from the shared AmmoConfig, so two players' arrows can differ. */
  private readonly attackStats: AttackStats;
  /** Set by GameRoom when a player fired this, so lifesteal can find its owner. */
  onDealt?: (targetId: string, damage: number) => void;
  private pierceLeft: number;
  private hitTargets = new Set<string>();
  private reversed = false;

  constructor(
    physics: PhysicsWorld,
    ammo: AmmoConfig,
    x: number,
    y: number,
    angleRad: number,
    ownerSessionId: string,
    affects: number,
    // Per-spawn lifetime override (ms). A boss planting a timed hazard (the Turtle
    // Dragon's tremor shards) sets this so a whole staggered batch expires on the
    // same tick regardless of when each was spawned — a synchronized clear. Falls
    // back to the ammo's own lifetimeMs.
    lifetimeMsOverride?: number,
    // Pre-resolved damage/knockback from the muzzle — a player's shot carries the
    // firing weapon's modifiers and the shooter's upgrades, both folded before the
    // projectile existed. Omitted (enemy/boss shots) = the ammo's own numbers.
    attackOverride?: AttackStats,
  ) {
    this.physics = physics;
    this.cfg = ammo;
    this.attackStats = attackOverride ?? { damage: ammo.damage, knockback: ammo.knockback };
    this.ownerSessionId = ownerSessionId;
    this.affects = affects;
    this.lifetimeMs = lifetimeMsOverride ?? ammo.lifetimeMs;
    this.pierceLeft = ammo.pierce;
    this.prevX = x;
    this.prevY = y;
    this.vx = Math.cos(angleRad) * ammo.speed;
    this.vy = Math.sin(angleRad) * ammo.speed;

    this.state = new ProjectileState();
    this.state.x = x;
    this.state.y = y;
    this.state.angle = angleRad;
    this.state.ammoId = ammo.id;
    this.state.ownerSessionId = ownerSessionId;
  }

  // Advance one tick. Sets `dead` on wall impact or lifetime expiry.
  tick(dtMs: number): void {
    if (this.dead) return;
    const dt = dtMs / 1000;
    this.prevX = this.state.x;
    this.prevY = this.state.y;
    this.state.x += this.vx * dt;
    this.state.y += this.vy * dt;

    this.ageMs += dtMs;
    if (this.ageMs >= this.lifetimeMs) {
      this.dead = true;
      return;
    }

    // Boomerang: reverse straight back once, clearing the hit list so it can
    // strike enemies again on the return leg.
    if (this.cfg.returnsAtMs !== undefined && !this.reversed && this.ageMs >= this.cfg.returnsAtMs) {
      this.reversed = true;
      this.vx = -this.vx;
      this.vy = -this.vy;
      this.hitTargets.clear();
    }

    if (!this.cfg.ignoresWalls) this.checkWalls();
  }

  /** Wall/door collision, SWEPT along this tick's travel rather than sampled only
   *  at the new centre. A fast shot fired flush against a wall used to tunnel
   *  through it: one tick could carry the sample point clear past a 1-tile wall
   *  into the room beyond. We walk the prev→current segment in sub-tile steps and
   *  die at the first blocked point (both walls and locked doors — the doorway
   *  tile is walkable, so barrierAt catches it where the tile test can't). */
  private checkWalls(): void {
    const dx = this.state.x - this.prevX;
    const dy = this.state.y - this.prevY;
    const dist = Math.hypot(dx, dy);
    // Step in ≤half-tile increments so no wall can fit between two samples.
    const steps = Math.max(1, Math.ceil(dist / (TILE_SIZE / 2)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = this.prevX + dx * t;
      const y = this.prevY + dy * t;
      const tile = this.physics.tileAt(x, y);
      if (tile === null || !TILE_PROPS[tile as TileId].walkable || this.physics.barrierAt(x, y)) {
        // Stop AT the wall (the last clear sample), not embedded in it.
        const back = (i - 1) / steps;
        this.state.x = this.prevX + dx * back;
        this.state.y = this.prevY + dy * back;
        this.dead = true;
        return;
      }
    }
  }

  // This projectile as a hit source for the combat resolver. The shape is the
  // swept ellipse from prevX/prevY → state.x/y (thick enough to not tunnel past a
  // target between ticks); `affects` decides which team its hits reach; `claim`
  // holds the pierce/dedupe policy. Gather only while `!dead`.
  hitSource(): HitSource {
    const speed = Math.hypot(this.vx, this.vy) || 1;
    return {
      shape: {
        kind: "sweptEllipse",
        x0: this.prevX,
        y0: this.prevY,
        x1: this.state.x,
        y1: this.state.y,
        ux: this.vx / speed,
        uy: this.vy / speed,
        forward: this.cfg.hitRadiusForward,
        side: this.cfg.hitRadiusSide,
      },
      affects: this.affects,
      ownerId: this.ownerSessionId,
      attack: {
        damage: this.attackStats.damage,
        knockback: this.attackStats.knockback,
        // Push targets along the arrow's travel direction (its previous position).
        sourceX: this.prevX,
        sourceY: this.prevY,
      },
      claim: (targetId) => this.claimHit(targetId),
      onDealt: this.onDealt,
    };
  }

  // Dedupe + pierce: the first overlap with a given target lands and consumes one
  // point of pierce; the projectile dies once pierce is exhausted. Geometry is the
  // resolver's job (the swept-ellipse shape); this is pure bookkeeping.
  private claimHit(targetId: string): boolean {
    if (this.dead || this.hitTargets.has(targetId)) return false;
    this.hitTargets.add(targetId);
    this.pierceLeft -= 1;
    if (this.pierceLeft <= 0) this.dead = true;
    return true;
  }
}
