/**
 * Hand-rolled swept-circle collision — the matter-js replacement.
 *
 * The game never used rigid-body physics; matter-js was only ever a separator for
 * radius-`ENTITY_RADIUS` circles (at the entity's feet) against static wall geometry,
 * driven by a velocity we set every tick. This reproduces exactly that model and
 * nothing more: zero friction, zero restitution, no rotation, no momentum transfer —
 * a body moves at the velocity we give it and is pushed back out of anything solid.
 *
 * Collision eligibility uses the shared `Layer` vocabulary exactly as matter did:
 * two shapes interact iff `(A.mask & B.category) && (B.mask & A.category)`. So the
 * one-way exit barrier (only a committed player's mask carries BARRIER_EXIT), the
 * airborne enemy that ignores COVER, and the corpse that keeps to walls but shoves
 * no one all fall out of the same bit test, no special cases.
 *
 * Pure math + integer grid; deterministic and portable (runs identically in the
 * server sim and, later, the in-process client authority and guest prediction).
 */
import { SpatialGrid } from "./SpatialGrid";

/** Two collision filters interact iff each side's mask includes the other's
 *  category — matter-js's symmetric rule, reproduced. */
export function filtersCollide(
  aCategory: number,
  aMask: number,
  bCategory: number,
  bMask: number,
): boolean {
  return (aMask & bCategory) !== 0 && (bMask & aCategory) !== 0;
}

/** A solid, immovable rectangle (wall / cover / barrier / world edge). AABB — the
 *  game's walls are all axis-aligned. `chamfer` rounds the collision corners inward
 *  (cover blocks) so a circle skims the corner instead of catching on it. */
export interface StaticRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  chamfer: number;
  category: number;
  mask: number;
}

/** A solid, immovable circle (corner plug sealing a diagonal pinch). */
export interface StaticCircle {
  x: number;
  y: number;
  r: number;
  category: number;
  mask: number;
}

export type StaticShape =
  | ({ kind: "rect" } & StaticRect)
  | ({ kind: "circle" } & StaticCircle);

/**
 * A dynamic body: a circle at (x, y) in BODY space (the feet point), moving at
 * (vx, vy) px/sec. `isStatic` bodies (bosses) are never integrated or displaced but
 * still block others. The handle is opaque to the rest of the sim — it only ever
 * flows back into CollisionWorld / PhysicsWorld methods.
 */
export class CircleBody {
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  radius: number;
  category: number;
  mask: number;
  isStatic = false;

  constructor(x: number, y: number, radius: number, category: number, mask: number) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.category = category;
    this.mask = mask;
  }
}

// Resolution passes per substep — a couple of iterations settle a body wedged
// against two surfaces (a corner) without the cost of a full constraint solver.
const RESOLVE_ITERATIONS = 2;

export class CollisionWorld {
  private shapes: StaticShape[] = [];
  private readonly staticGrid: SpatialGrid<StaticShape>;
  private gridDirty = true;
  private readonly bodies = new Set<CircleBody>();

  /** cellSize should be ~ a tile; the static grid is rebuilt lazily when geometry
   *  changes (floor rebuild, or a barrier locking/unlocking mid-floor). */
  constructor(cellSize: number) {
    this.staticGrid = new SpatialGrid<StaticShape>(cellSize);
  }

  // ---- static geometry ----------------------------------------------------
  // add* return the shape as an opaque handle so a caller (a barrier) can remove it.

  addStaticRect(r: StaticRect): StaticShape {
    const shape: StaticShape = { kind: "rect", ...r };
    this.shapes.push(shape);
    this.gridDirty = true;
    return shape;
  }

  addStaticCircle(c: StaticCircle): StaticShape {
    const shape: StaticShape = { kind: "circle", ...c };
    this.shapes.push(shape);
    this.gridDirty = true;
    return shape;
  }

  removeStatic(shape: StaticShape): void {
    const i = this.shapes.indexOf(shape);
    if (i >= 0) {
      this.shapes.splice(i, 1);
      this.gridDirty = true;
    }
  }

  /** Drop all static geometry (a floor change rebuilds it). Dynamic bodies persist. */
  clearStatic(): void {
    this.shapes = [];
    this.gridDirty = true;
  }

  /** Rebuild the broadphase grid from the current shapes, if they changed. */
  private ensureGrid(): void {
    if (!this.gridDirty) return;
    this.staticGrid.clear();
    for (const shape of this.shapes) {
      if (shape.kind === "rect") {
        this.staticGrid.insert(shape, shape.minX, shape.minY, shape.maxX, shape.maxY);
      } else {
        this.staticGrid.insert(shape, shape.x - shape.r, shape.y - shape.r, shape.x + shape.r, shape.y + shape.r);
      }
    }
    this.gridDirty = false;
  }

  // ---- dynamic bodies -----------------------------------------------------

  add(body: CircleBody): void {
    this.bodies.add(body);
  }

  remove(body: CircleBody): void {
    this.bodies.delete(body);
  }

  // ---- the tick -----------------------------------------------------------

  /** Advance every dynamic body by `dtSec` seconds, split into `substeps`
   *  integrate-then-resolve passes (matches matter's 3-substep granularity). */
  step(dtSec: number, substeps: number): void {
    this.ensureGrid();
    const h = dtSec / substeps;
    for (let s = 0; s < substeps; s++) {
      for (const body of this.bodies) {
        if (body.isStatic) continue;
        this.advance(body, h);
      }
      for (let iter = 0; iter < RESOLVE_ITERATIONS; iter++) {
        for (const body of this.bodies) {
          if (body.isStatic) continue;
          this.resolveStatic(body);
        }
        this.resolveDynamicPairs();
      }
    }
  }

  /** Integrate one body over `h` seconds, sweeping in radius-bounded increments so a
   *  fast body (knockback) can't tunnel through a thin wall between resolves. */
  private advance(body: CircleBody, h: number): void {
    const dx = body.vx * h;
    const dy = body.vy * h;
    const dist = Math.hypot(dx, dy);
    // Cap each micro-step to half a radius so we never skip over a wall.
    const maxStep = body.radius * 0.5;
    const steps = dist > maxStep ? Math.ceil(dist / maxStep) : 1;
    const sx = dx / steps;
    const sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      body.x += sx;
      body.y += sy;
      this.resolveStatic(body);
    }
  }

  // ---- resolution ---------------------------------------------------------

  /** Push `body` out of every static shape it overlaps and is filtered to collide
   *  with. */
  private resolveStatic(body: CircleBody): void {
    const r = body.radius;
    this.staticGrid.query(
      body.x - r,
      body.y - r,
      body.x + r,
      body.y + r,
      (shape) => {
        if (!filtersCollide(body.category, body.mask, shape.category, shape.mask)) return;
        if (shape.kind === "rect") this.pushOutOfRect(body, shape);
        else this.pushOutOfCircle(body, shape.x, shape.y, shape.r);
      },
    );
  }

  private pushOutOfRect(body: CircleBody, rect: StaticRect): void {
    const r = body.radius;
    // Effective bounds: chamfer shrinks the rect so the corner is rounded — the
    // circle's push-out near a chamfered corner starts from the inset corner point.
    const ch = rect.chamfer;
    const minX = rect.minX + ch;
    const maxX = rect.maxX - ch;
    const minY = rect.minY + ch;
    const maxY = rect.maxY - ch;
    // Closest point on the (chamfer-inset) rect to the body centre.
    const px = clamp(body.x, minX, maxX);
    const py = clamp(body.y, minY, maxY);
    const dx = body.x - px;
    const dy = body.y - py;
    const d2 = dx * dx + dy * dy;
    // Effective radius includes the chamfer we shaved off the corner (so flat edges
    // resolve to exactly `r` clearance and only the corners round).
    const reach = r + ch;
    if (d2 > 1e-12) {
      if (d2 >= reach * reach) return; // outside reach — not touching
      // Body centre is outside the inset rect: push straight out along the normal.
      const d = Math.sqrt(d2);
      const push = reach - d;
      body.x += (dx / d) * push;
      body.y += (dy / d) * push;
      return;
    }
    // Centre is inside the rect: eject along the axis of least penetration.
    const left = body.x - rect.minX;
    const right = rect.maxX - body.x;
    const top = body.y - rect.minY;
    const bottom = rect.maxY - body.y;
    const minPen = Math.min(left, right, top, bottom);
    if (minPen === left) body.x = rect.minX - r;
    else if (minPen === right) body.x = rect.maxX + r;
    else if (minPen === top) body.y = rect.minY - r;
    else body.y = rect.maxY + r;
  }

  private pushOutOfCircle(body: CircleBody, cx: number, cy: number, cr: number): void {
    const dx = body.x - cx;
    const dy = body.y - cy;
    const sum = body.radius + cr;
    const d2 = dx * dx + dy * dy;
    if (d2 >= sum * sum) return;
    if (d2 > 1e-12) {
      const d = Math.sqrt(d2);
      const push = sum - d;
      body.x += (dx / d) * push;
      body.y += (dy / d) * push;
    } else {
      // Concentric: shove straight up, deterministically.
      body.y -= sum;
    }
  }

  /** Separate overlapping dynamic bodies. O(n²) over the (few, room-confined) bodies;
   *  the static grid is where the scale is. A static body (boss) never moves — the
   *  other body takes the whole correction. */
  private resolveDynamicPairs(): void {
    const list = [...this.bodies];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (a.isStatic && b.isStatic) continue;
        if (!filtersCollide(a.category, a.mask, b.category, b.mask)) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const sum = a.radius + b.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= sum * sum) continue;
        const d = d2 > 1e-12 ? Math.sqrt(d2) : 0;
        // Deterministic separation direction when exactly coincident.
        const nx = d > 0 ? dx / d : 1;
        const ny = d > 0 ? dy / d : 0;
        const overlap = sum - (d > 0 ? d : 0);
        if (a.isStatic) {
          b.x += nx * overlap;
          b.y += ny * overlap;
        } else if (b.isStatic) {
          a.x -= nx * overlap;
          a.y -= ny * overlap;
        } else {
          const half = overlap * 0.5;
          a.x -= nx * half;
          a.y -= ny * half;
          b.x += nx * half;
          b.y += ny * half;
        }
      }
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
