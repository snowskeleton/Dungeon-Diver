import Matter from "matter-js";
import {
  TILE_PROPS,
  TILE_SIZE,
  TileId,
  SERVER_TICK_MS,
  FOOT_OFFSET,
  ENTITY_RADIUS,
  Layer,
  CORPSE_SOLID_MASK,
  PLAYER_BODY_PROFILE,
  PLAYER_COMMITTED_SOLID_MASK,
  wallKind,
} from "shared";

// ---- Coordinate mapping (defined here and nowhere else) ----
// Schema state.x/y is the sprite CENTER — that's the client contract and it
// doesn't change. The physics body is a small circle at the sprite's FEET,
// matching the old foot-box collision:
//   body.position = (state.x, state.y + FOOT_OFFSET)
// FOOT_OFFSET/ENTITY_RADIUS live in shared (the client debug overlay draws the
// exact collision circle); re-exported here so physics code keeps local names.
// NOTE: ENTITY_RADIUS must stay ≤ ~14 or entities can't fit through 32px gaps.
export { FOOT_OFFSET, ENTITY_RADIUS };

// Physical collision is governed by the shared `Layer` vocabulary: a body's
// `layer` is its matter `category`, its `solidMask` is its matter `mask`. Walls
// block players and enemies (projectiles are not matter bodies). See
// docs/layers.md for the full model.
const WALL_SOLID_MASK = Layer.PLAYER | Layer.ENEMY;

export function pxPerSecToVelocity(pxPerSec: number): number {
  return pxPerSec / 60;
}

// The two reference frames, converted in ONE place. "Sprite" space is the schema
// state.x/y (the wire/render/hurt frame); "body" space is the collision frame, a
// point FOOT_OFFSET below the sprite centre. Every FOOT_OFFSET conversion goes
// through these two functions so no call site open-codes the arithmetic — see the
// coordinate-mapping note above. Entity's footX/footY getters are the read-only
// half of the same contract for code that only needs to ask "where are my feet?".
export function spriteToBody(pt: { x: number; y: number }): { x: number; y: number } {
  return { x: pt.x, y: pt.y + FOOT_OFFSET };
}

export function bodyToSprite(pt: { x: number; y: number }): { x: number; y: number } {
  return { x: pt.x, y: pt.y - FOOT_OFFSET };
}

export function syncStateFromBody(
  state: { x: number; y: number },
  body: Matter.Body,
): void {
  const s = bodyToSprite(body.position);
  state.x = s.x;
  state.y = s.y;
}

type WallRect = { col: number; row: number; cols: number; rows: number };

// Greedy rectangle decomposition of every tile matching `accept`: scan each row
// into horizontal runs, then merge vertically-aligned equal-width runs into taller
// rectangles. Extracted from buildWallBodies so it can run once per wall CLASS —
// a run breaks whenever the class changes, so a single body never spans structural
// and cover tiles (an airborne enemy must be stopped by the perimeter but not by
// the cover block beside it, and that requires them to be distinct bodies).
function mergeWallRects(
  mapCols: number,
  mapRows: number,
  accept: (col: number, row: number) => boolean,
): WallRect[] {
  const runs: WallRect[] = [];
  for (let row = 0; row < mapRows; row++) {
    let col = 0;
    while (col < mapCols) {
      if (accept(col, row)) {
        const start = col;
        while (col < mapCols && accept(col, row)) col++;
        runs.push({ col: start, row, cols: col - start, rows: 1 });
      } else {
        col++;
      }
    }
  }

  const merged: WallRect[] = [];
  const consumed = new Set<number>();
  for (let i = 0; i < runs.length; i++) {
    if (consumed.has(i)) continue;
    const rect = { ...runs[i] };
    let extended = true;
    while (extended) {
      extended = false;
      for (let j = i + 1; j < runs.length; j++) {
        if (consumed.has(j)) continue;
        const below = runs[j];
        if (below.row === rect.row + rect.rows && below.col === rect.col && below.cols === rect.cols) {
          rect.rows++;
          consumed.add(j);
          extended = true;
          break;
        }
      }
    }
    merged.push(rect);
  }
  return merged;
}

// Collision-only corner rounding for cover blocks. The flow field is tile-granular
// but bodies are round (ENTITY_RADIUS): a body steered diagonally past a block's 90°
// corner clips it and matter shoves it straight back, so the enemy re-picks the same
// heading next tick and deadlocks on the corner. Chamfering the COLLISION corner a
// touch wider than the body radius lets it slide off instead of catching. The chamfer
// is invisible — the rendered tile stays a hard square; only the physics corner is
// clipped. Kept small so a body can't cut THROUGH a block, only skim its corner.
const COVER_CHAMFER = ENTITY_RADIUS + 3;

function rectToBody(r: WallRect, label: string, category: number, chamferRadius = 0): Matter.Body {
  return Matter.Bodies.rectangle(
    r.col * TILE_SIZE + (r.cols * TILE_SIZE) / 2,
    r.row * TILE_SIZE + (r.rows * TILE_SIZE) / 2,
    r.cols * TILE_SIZE,
    r.rows * TILE_SIZE,
    {
      isStatic: true,
      label,
      collisionFilter: { category, mask: WALL_SOLID_MASK },
      ...(chamferRadius > 0 ? { chamfer: { radius: chamferRadius } } : {}),
    },
  );
}

/** A small static blocker sealing a diagonal corner pinch (see buildWallBodies).
 *  Categorised as WALL so it blocks whatever a wall does, for players and enemies
 *  alike. */
function cornerPlug(vx: number, vy: number, radius: number): Matter.Body {
  return Matter.Bodies.circle(vx, vy, radius, {
    isStatic: true,
    label: "corner-plug",
    collisionFilter: { category: Layer.WALL, mask: WALL_SOLID_MASK },
  });
}

function buildWallBodies(
  mapData: TileId[][],
  mapCols: number,
  mapRows: number,
): Matter.Body[] {
  const kindAt = (col: number, row: number) => wallKind(col, row, mapData[row][col] as TileId);

  // Two separate passes, one per class, so cover and structure become distinct
  // bodies with distinct collision categories — the walker's mask carries both,
  // the airborne enemy's mask drops COVER (see AIRBORNE_ENEMY_BODY_PROFILE).
  const bodies = [
    ...mergeWallRects(mapCols, mapRows, (c, r) => kindAt(c, r) === "structural")
      .map(r => rectToBody(r, "wall", Layer.WALL)),
    ...mergeWallRects(mapCols, mapRows, (c, r) => kindAt(c, r) === "cover")
      .map(r => rectToBody(r, "cover", Layer.COVER, COVER_CHAMFER)),
  ];

  // Corner plugs. Two obstacles that touch only at a diagonal corner leave a
  // pinch a round body can squeeze through — worsened by the cover chamfer above,
  // which rounds those very corners away. Wherever two diagonally-adjacent cells
  // are solid but the two cells sharing their corner are BOTH open, drop a small
  // static blocker on the shared vertex so the diagonal gap can't be walked (or
  // knocked) through. The condition is exact for a pinch, so this never touches an
  // ordinary wall corner.
  const solid = (c: number, r: number) =>
    c >= 0 && r >= 0 && c < mapCols && r < mapRows && kindAt(c, r) !== null;
  const PLUG_R = ENTITY_RADIUS + 1;
  for (let r = 0; r < mapRows; r++) {
    for (let c = 0; c < mapCols; c++) {
      if (!solid(c, r)) continue;
      // Down-right diagonal: vertex at the bottom-right corner of (c,r).
      if (solid(c + 1, r + 1) && !solid(c + 1, r) && !solid(c, r + 1)) {
        bodies.push(cornerPlug((c + 1) * TILE_SIZE, (r + 1) * TILE_SIZE, PLUG_R));
      }
      // Down-left diagonal: vertex at the bottom-left corner of (c,r).
      if (solid(c - 1, r + 1) && !solid(c - 1, r) && !solid(c, r + 1)) {
        bodies.push(cornerPlug(c * TILE_SIZE, (r + 1) * TILE_SIZE, PLUG_R));
      }
    }
  }

  const w = mapCols * TILE_SIZE;
  const h = mapRows * TILE_SIZE;
  // The world edges are structural — nothing flies past the map bounds.
  const edge = {
    isStatic: true,
    label: "world-edge",
    collisionFilter: { category: Layer.WALL, mask: WALL_SOLID_MASK },
  };
  bodies.push(
    Matter.Bodies.rectangle(w / 2, -16, w + 64, 32, edge),
    Matter.Bodies.rectangle(w / 2, h + 16, w + 64, 32, edge),
    Matter.Bodies.rectangle(-16, h / 2, 32, h + 64, edge),
    Matter.Bodies.rectangle(w + 16, h / 2, 32, h + 64, edge),
  );
  return bodies;
}

export class PhysicsWorld {
  private engine: Matter.Engine;
  private mapData: TileId[][];
  private mapCols: number;
  private mapRows: number;
  private wallBodies: Matter.Body[] = [];
  private barriers = new Map<string, Matter.Body>();

  constructor(mapData: TileId[][], mapCols: number, mapRows: number) {
    this.mapData = mapData;
    this.mapCols = mapCols;
    this.mapRows = mapRows;
    this.engine = Matter.Engine.create();
    this.engine.gravity.x = 0;
    this.engine.gravity.y = 0;
    this.wallBodies = buildWallBodies(mapData, mapCols, mapRows);
    Matter.Composite.add(this.engine.world, this.wallBodies);
  }

  tileAt(x: number, y: number): TileId | null {
    const col = Math.floor(x / TILE_SIZE);
    const row = Math.floor(y / TILE_SIZE);
    if (col < 0 || col >= this.mapCols || row < 0 || row >= this.mapRows) return null;
    return this.mapData[row][col] as TileId;
  }

  rebuildWalls(mapData: TileId[][], mapCols: number, mapRows: number): void {
    for (const body of this.wallBodies) Matter.Composite.remove(this.engine.world, body);
    for (const body of this.barriers.values()) Matter.Composite.remove(this.engine.world, body);
    this.barriers.clear();
    this.mapData = mapData;
    this.mapCols = mapCols;
    this.mapRows = mapRows;
    this.wallBodies = buildWallBodies(mapData, mapCols, mapRows);
    Matter.Composite.add(this.engine.world, this.wallBodies);
  }

  addBarrier(id: string, cx: number, cy: number, w: number, h: number): void {
    if (this.barriers.has(id)) return;
    const body = Matter.Bodies.rectangle(cx, cy, w, h, {
      isStatic: true,
      label: `barrier_${id}`,
      collisionFilter: { category: Layer.WALL, mask: WALL_SOLID_MASK },
    });
    this.barriers.set(id, body);
    Matter.Composite.add(this.engine.world, body);
  }

  /** A locked room's exit barrier. Unlike addBarrier this is NOT a wall: it sits
   *  on Layer.BARRIER_EXIT, which only a committed player's mask includes, so it
   *  blocks the way out without blocking the way in. See shared/src/layers.ts. */
  addExitBarrier(id: string, cx: number, cy: number, w: number, h: number): void {
    if (this.barriers.has(id)) return;
    const body = Matter.Bodies.rectangle(cx, cy, w, h, {
      isStatic: true,
      label: `barrier_${id}`,
      collisionFilter: { category: Layer.BARRIER_EXIT, mask: Layer.PLAYER },
    });
    this.barriers.set(id, body);
    Matter.Composite.add(this.engine.world, body);
  }

  /** Set this player body's solid mask from its commitment plus any movement-ability
   *  phase-through. `committed` adds the one-way exit-barrier bit; `dropMask` removes
   *  bits for the current tick (a Dash phases through ENEMY, a Vault through
   *  ENEMY|COVER). Recomputed every tick, so the drop is inherently transient. */
  setPlayerCommitted(body: Matter.Body, committed: boolean, dropMask = 0): void {
    const base = committed ? PLAYER_COMMITTED_SOLID_MASK : PLAYER_BODY_PROFILE.solidMask;
    body.collisionFilter.mask = base & ~dropMask;
  }

  /** Is this point inside a standing barrier? Projectiles are not matter bodies,
   *  so they'd otherwise sail straight through a shut door (playtest B5). Both
   *  sides block: a one-way barrier is one-way for *walking*, not for arrows. */
  barrierAt(x: number, y: number): boolean {
    for (const body of this.barriers.values()) {
      const b = body.bounds;
      if (x >= b.min.x && x <= b.max.x && y >= b.min.y && y <= b.max.y) return true;
    }
    return false;
  }

  removeBarrier(id: string): void {
    const body = this.barriers.get(id);
    if (!body) return;
    Matter.Composite.remove(this.engine.world, body);
    this.barriers.delete(id);
  }

  // `layer` is the body's matter category (what it IS); `solidMask` is what it
  // physically blocks against. Both come from the entity's InteractionProfile.
  createEntityBody(spriteX: number, spriteY: number, layer: number, solidMask: number): Matter.Body {
    const bodyPos = spriteToBody({ x: spriteX, y: spriteY });
    const body = Matter.Bodies.circle(
      bodyPos.x,
      bodyPos.y,
      ENTITY_RADIUS,
      {
        friction: 0,
        frictionStatic: 0,
        frictionAir: 0,
        restitution: 0,
        inertia: Infinity,
        collisionFilter: { category: layer, mask: solidMask },
      },
    );
    Matter.Composite.add(this.engine.world, body);
    return body;
  }

  removeBody(body: Matter.Body): void {
    Matter.Composite.remove(this.engine.world, body);
  }

  // Makes a body static (or dynamic again). A static body is NEVER displaced by
  // the solver — a player who walks into it is shoved out instead of pushing it.
  // High mass is not enough: matter's Verlet integrator drifts even a 1e12-mass
  // body under sustained contact. Bosses use this so they can't be nudged; they
  // move themselves by setEntityPosition (which still sweeps players aside).
  setBodyStatic(body: Matter.Body, isStatic: boolean): void {
    Matter.Body.setStatic(body, isStatic);
  }

  setVelocityPxPerSec(body: Matter.Body, vx: number, vy: number): void {
    Matter.Body.setVelocity(body, {
      x: pxPerSecToVelocity(vx),
      y: pxPerSecToVelocity(vy),
    });
  }

  setEntityPosition(body: Matter.Body, spriteX: number, spriteY: number): void {
    Matter.Body.setPosition(body, spriteToBody({ x: spriteX, y: spriteY }));
    Matter.Body.setVelocity(body, { x: 0, y: 0 });
  }

  setEntityDead(body: Matter.Body): void {
    body.collisionFilter.mask = CORPSE_SOLID_MASK;
    Matter.Body.setVelocity(body, { x: 0, y: 0 });
  }

  step(): void {
    const SUB = 3;
    for (let i = 0; i < SUB; i++)
      Matter.Engine.update(this.engine, SERVER_TICK_MS / SUB);
  }
}
