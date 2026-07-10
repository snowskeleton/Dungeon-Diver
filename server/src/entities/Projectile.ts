import { AmmoConfig, TILE_PROPS, TileId } from "shared";
import { ProjectileState } from "../schema/ProjectileState";
import { PhysicsWorld } from "../physics/PhysicsWorld";

// A kinematic projectile (arrow). Not a matter-js body: it integrates its own
// position each tick, despawns on a wall tile or after its lifetime, and does a
// simple point-vs-enemy-center overlap test for hits. Pierce lets one shot pass
// through several enemies.
export class Projectile {
  state: ProjectileState;
  readonly cfg: AmmoConfig;
  readonly ownerSessionId: string;
  dead = false;
  // Position at the start of the current tick — used as the knockback source so
  // enemies get pushed along the arrow's travel direction.
  prevX: number;
  prevY: number;

  private physics: PhysicsWorld;
  private vx: number;
  private vy: number;
  private ageMs = 0;
  private pierceLeft: number;
  private hitEnemies = new Set<string>();
  private reversed = false;

  constructor(
    physics: PhysicsWorld,
    ammo: AmmoConfig,
    x: number,
    y: number,
    angleRad: number,
    ownerSessionId: string,
  ) {
    this.physics = physics;
    this.cfg = ammo;
    this.ownerSessionId = ownerSessionId;
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
    if (this.ageMs >= this.cfg.lifetimeMs) {
      this.dead = true;
      return;
    }

    // Boomerang: reverse straight back once, clearing the hit list so it can
    // strike enemies again on the return leg.
    if (this.cfg.returnsAtMs !== undefined && !this.reversed && this.ageMs >= this.cfg.returnsAtMs) {
      this.reversed = true;
      this.vx = -this.vx;
      this.vy = -this.vy;
      this.hitEnemies.clear();
    }

    if (!this.cfg.ignoresWalls) {
      const tile = this.physics.tileAt(this.state.x, this.state.y);
      if (tile === null || !TILE_PROPS[tile as TileId].walkable) {
        this.dead = true;
      }
    }
  }

  // Returns true the first time this projectile overlaps a given enemy. Consumes
  // one point of pierce; the projectile dies once pierce is exhausted.
  tryHit(enemyId: string, ex: number, ey: number): boolean {
    if (this.dead || this.hitEnemies.has(enemyId)) return false;

    // Elliptical overlap aligned to travel direction: `along` runs down the
    // flight line (forward = the hitbox "length"), `perp` across it (side = the
    // "width"). A wide side radius lets a shot miss left/right without reaching
    // farther ahead.
    //
    // Crucially this is a SWEPT test against the whole segment travelled this
    // tick (prevX/prevY → state.x/y), not just the endpoint: a fast arrow moves
    // ~25px/tick but has only a ~10px forward radius, so a point-at-endpoint test
    // tunnels straight through enemies sitting in the gap between samples.
    const fwd = this.cfg.hitRadiusForward;
    const side = this.cfg.hitRadiusSide;
    const speed = Math.hypot(this.vx, this.vy) || 1;
    const ux = this.vx / speed;
    const uy = this.vy / speed;
    // Distance travelled this tick along the flight line (segment [0, segLen]).
    const segLen = (this.state.x - this.prevX) * ux + (this.state.y - this.prevY) * uy;

    const dx = ex - this.prevX;
    const dy = ey - this.prevY;
    const along = dx * ux + dy * uy; // enemy position along the segment (from prev)
    const perp = dx * -uy + dy * ux; // enemy perpendicular offset from the line

    const k = (perp * perp) / (side * side);
    if (k > 1) return false; // beyond the side radius — no ellipse can reach it
    // Nearest point of the swept centre-line to the enemy, then compare against
    // the ellipse's forward half-width there (the elliptical end caps).
    const gap = along < 0 ? -along : along > segLen ? along - segLen : 0;
    if (gap > fwd * Math.sqrt(1 - k)) return false;
    this.hitEnemies.add(enemyId);
    this.pierceLeft -= 1;
    if (this.pierceLeft <= 0) this.dead = true;
    return true;
  }
}
