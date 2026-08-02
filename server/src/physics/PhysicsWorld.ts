import {
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
  CollisionWorld,
  CircleBody,
  StaticRect,
  StaticShape,
} from "shared";

// ---- Coordinate mapping (defined here and nowhere else) ----
// Schema state.x/y is the sprite CENTER — that's the client contract and it
// doesn't change. The physics body is a small circle at the sprite's FEET:
//   body position = (state.x, state.y + FOOT_OFFSET)
// FOOT_OFFSET/ENTITY_RADIUS live in shared (the client debug overlay draws the
// exact collision circle); re-exported here so physics code keeps local names.
// NOTE: ENTITY_RADIUS must stay ≤ ~14 or entities can't fit through 32px gaps.
export { FOOT_OFFSET, ENTITY_RADIUS };

/** The dynamic-body handle the rest of the sim holds (`Entity.body`). Opaque — it
 *  only ever flows back into PhysicsWorld methods. Was `Matter.Body`. */
export type PhysicsBody = CircleBody;

// Physical collision is governed by the shared `Layer` vocabulary: a body's
// `layer` is its category, its `solidMask` is what it blocks against. Walls block
// players and enemies (projectiles are not physics bodies). See docs/layers.md.
const WALL_SOLID_MASK = Layer.PLAYER | Layer.ENEMY;

// The two reference frames, converted in ONE place. "Sprite" space is the schema
// state.x/y (the wire/render/hurt frame); "body" space is the collision frame, a
// point FOOT_OFFSET below the sprite centre. Every FOOT_OFFSET conversion goes
// through these two functions so no call site open-codes the arithmetic. Entity's
// footX/footY getters are the read-only half of the same contract.
export function spriteToBody(pt: { x: number; y: number }): { x: number; y: number } {
  return { x: pt.x, y: pt.y + FOOT_OFFSET };
}

export function bodyToSprite(pt: { x: number; y: number }): { x: number; y: number } {
  return { x: pt.x, y: pt.y - FOOT_OFFSET };
}

export function syncStateFromBody(
  state: { x: number; y: number },
  body: PhysicsBody,
): void {
  const s = bodyToSprite({ x: body.x, y: body.y });
  state.x = s.x;
  state.y = s.y;
}

type WallRect = { col: number; row: number; cols: number; rows: number };

// Greedy rectangle decomposition of every tile matching `accept`: scan each row
// into horizontal runs, then merge vertically-aligned equal-width runs into taller
// rectangles. Run once per wall CLASS — a run breaks whenever the class changes, so
// a single rect never spans structural and cover tiles (an airborne enemy must be
// stopped by the perimeter but not by the cover block beside it, and that requires
// them to be distinct shapes with distinct categories).
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

// Collision-only corner rounding for cover blocks. Bodies are round (ENTITY_RADIUS):
// a body steered diagonally past a block's 90° corner clips it and is shoved straight
// back, so it re-picks the same heading next tick and deadlocks on the corner.
// Chamfering the COLLISION corner a touch wider than the body radius lets it slide
// off instead of catching. Invisible — the rendered tile stays a hard square; only
// the physics corner is clipped. Small, so a body can't cut THROUGH a block.
const COVER_CHAMFER = ENTITY_RADIUS + 3;

function wallRectToStatic(r: WallRect, category: number, chamfer: number): StaticRect {
  return {
    minX: r.col * TILE_SIZE,
    minY: r.row * TILE_SIZE,
    maxX: (r.col + r.cols) * TILE_SIZE,
    maxY: (r.row + r.rows) * TILE_SIZE,
    chamfer,
    category,
    mask: WALL_SOLID_MASK,
  };
}

function rectFromCenter(
  cx: number, cy: number, w: number, h: number,
  category: number, mask: number,
): StaticRect {
  return {
    minX: cx - w / 2,
    minY: cy - h / 2,
    maxX: cx + w / 2,
    maxY: cy + h / 2,
    chamfer: 0,
    category,
    mask,
  };
}

// Populate `world` with the floor's wall geometry: structural rects (Layer.WALL),
// chamfered cover rects (Layer.COVER), corner plugs, and the four world edges.
function addWallShapes(
  world: CollisionWorld,
  mapData: TileId[][],
  mapCols: number,
  mapRows: number,
): void {
  const kindAt = (col: number, row: number) => wallKind(col, row, mapData[row][col] as TileId);

  // Two passes, one per class, so cover and structure get distinct categories — the
  // walker's mask carries both, the airborne enemy's mask drops COVER.
  for (const r of mergeWallRects(mapCols, mapRows, (c, r) => kindAt(c, r) === "structural")) {
    world.addStaticRect(wallRectToStatic(r, Layer.WALL, 0));
  }
  for (const r of mergeWallRects(mapCols, mapRows, (c, r) => kindAt(c, r) === "cover")) {
    world.addStaticRect(wallRectToStatic(r, Layer.COVER, COVER_CHAMFER));
  }

  // Corner plugs. Two obstacles that touch only at a diagonal corner leave a pinch a
  // round body can squeeze through — worsened by the cover chamfer, which rounds
  // those very corners away. Wherever two diagonally-adjacent cells are solid but the
  // two cells sharing their corner are BOTH open, drop a small blocker on the shared
  // vertex. The condition is exact for a pinch, so it never touches an ordinary corner.
  const solid = (c: number, r: number) =>
    c >= 0 && r >= 0 && c < mapCols && r < mapRows && kindAt(c, r) !== null;
  const PLUG_R = ENTITY_RADIUS + 1;
  for (let r = 0; r < mapRows; r++) {
    for (let c = 0; c < mapCols; c++) {
      if (!solid(c, r)) continue;
      if (solid(c + 1, r + 1) && !solid(c + 1, r) && !solid(c, r + 1)) {
        world.addStaticCircle({ x: (c + 1) * TILE_SIZE, y: (r + 1) * TILE_SIZE, r: PLUG_R, category: Layer.WALL, mask: WALL_SOLID_MASK });
      }
      if (solid(c - 1, r + 1) && !solid(c - 1, r) && !solid(c, r + 1)) {
        world.addStaticCircle({ x: c * TILE_SIZE, y: (r + 1) * TILE_SIZE, r: PLUG_R, category: Layer.WALL, mask: WALL_SOLID_MASK });
      }
    }
  }

  const w = mapCols * TILE_SIZE;
  const h = mapRows * TILE_SIZE;
  // The world edges are structural — nothing flies past the map bounds.
  world.addStaticRect(rectFromCenter(w / 2, -16, w + 64, 32, Layer.WALL, WALL_SOLID_MASK));
  world.addStaticRect(rectFromCenter(w / 2, h + 16, w + 64, 32, Layer.WALL, WALL_SOLID_MASK));
  world.addStaticRect(rectFromCenter(-16, h / 2, 32, h + 64, Layer.WALL, WALL_SOLID_MASK));
  world.addStaticRect(rectFromCenter(w + 16, h / 2, 32, h + 64, Layer.WALL, WALL_SOLID_MASK));
}

/** The number of integrate-then-resolve substeps per tick — matches the old
 *  matter-js `Engine.update` granularity (three sub-updates per tick). */
const SUBSTEPS = 3;

type BarrierBounds = { minX: number; minY: number; maxX: number; maxY: number };

export class PhysicsWorld {
  private world: CollisionWorld;
  private mapData: TileId[][];
  private mapCols: number;
  private mapRows: number;
  // A barrier's static shape (to remove it) plus its bounds (for the point test that
  // projectiles — not physics bodies — use to die at a shut door).
  private barriers = new Map<string, StaticShape>();
  private barrierBounds = new Map<string, BarrierBounds>();

  constructor(mapData: TileId[][], mapCols: number, mapRows: number) {
    this.mapData = mapData;
    this.mapCols = mapCols;
    this.mapRows = mapRows;
    this.world = new CollisionWorld(TILE_SIZE);
    addWallShapes(this.world, mapData, mapCols, mapRows);
  }

  tileAt(x: number, y: number): TileId | null {
    const col = Math.floor(x / TILE_SIZE);
    const row = Math.floor(y / TILE_SIZE);
    if (col < 0 || col >= this.mapCols || row < 0 || row >= this.mapRows) return null;
    return this.mapData[row][col] as TileId;
  }

  rebuildWalls(mapData: TileId[][], mapCols: number, mapRows: number): void {
    this.world.clearStatic();
    this.barriers.clear();
    this.barrierBounds.clear();
    this.mapData = mapData;
    this.mapCols = mapCols;
    this.mapRows = mapRows;
    addWallShapes(this.world, mapData, mapCols, mapRows);
  }

  addBarrier(id: string, cx: number, cy: number, w: number, h: number): void {
    if (this.barriers.has(id)) return;
    const rect = rectFromCenter(cx, cy, w, h, Layer.WALL, WALL_SOLID_MASK);
    this.barriers.set(id, this.world.addStaticRect(rect));
    this.barrierBounds.set(id, { minX: rect.minX, minY: rect.minY, maxX: rect.maxX, maxY: rect.maxY });
  }

  /** A locked room's exit barrier. Unlike addBarrier this is NOT a wall: it sits on
   *  Layer.BARRIER_EXIT, which only a committed player's mask includes, so it blocks
   *  the way out without blocking the way in. See shared/src/layers.ts. */
  addExitBarrier(id: string, cx: number, cy: number, w: number, h: number): void {
    if (this.barriers.has(id)) return;
    const rect = rectFromCenter(cx, cy, w, h, Layer.BARRIER_EXIT, Layer.PLAYER);
    this.barriers.set(id, this.world.addStaticRect(rect));
    this.barrierBounds.set(id, { minX: rect.minX, minY: rect.minY, maxX: rect.maxX, maxY: rect.maxY });
  }

  /** Set this player body's solid mask from its commitment plus any movement-ability
   *  phase-through. `committed` adds the one-way exit-barrier bit; `dropMask` removes
   *  bits for the current tick (a Dash phases through ENEMY, a Vault through
   *  ENEMY|COVER). Recomputed every tick, so the drop is inherently transient. */
  setPlayerCommitted(body: PhysicsBody, committed: boolean, dropMask = 0): void {
    const base = committed ? PLAYER_COMMITTED_SOLID_MASK : PLAYER_BODY_PROFILE.solidMask;
    body.mask = base & ~dropMask;
  }

  /** Is this point inside a standing barrier? Projectiles are not physics bodies, so
   *  they'd otherwise sail through a shut door (playtest B5). Both sides block: a
   *  one-way barrier is one-way for *walking*, not for arrows. */
  barrierAt(x: number, y: number): boolean {
    for (const b of this.barrierBounds.values()) {
      if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY) return true;
    }
    return false;
  }

  removeBarrier(id: string): void {
    const shape = this.barriers.get(id);
    if (!shape) return;
    this.world.removeStatic(shape);
    this.barriers.delete(id);
    this.barrierBounds.delete(id);
  }

  // `layer` is the body's category (what it IS); `solidMask` is what it physically
  // blocks against. Both come from the entity's InteractionProfile.
  createEntityBody(spriteX: number, spriteY: number, layer: number, solidMask: number): PhysicsBody {
    const p = spriteToBody({ x: spriteX, y: spriteY });
    const body = new CircleBody(p.x, p.y, ENTITY_RADIUS, layer, solidMask);
    this.world.add(body);
    return body;
  }

  removeBody(body: PhysicsBody): void {
    this.world.remove(body);
  }

  // Makes a body static (or dynamic again). A static body is NEVER displaced — a
  // player who walks into it is shoved out instead of pushing it. Bosses use this so
  // they can't be nudged; they move themselves by setEntityPosition (which still
  // sweeps players aside via the separation pass).
  setBodyStatic(body: PhysicsBody, isStatic: boolean): void {
    body.isStatic = isStatic;
  }

  setVelocityPxPerSec(body: PhysicsBody, vx: number, vy: number): void {
    body.vx = vx;
    body.vy = vy;
  }

  setEntityPosition(body: PhysicsBody, spriteX: number, spriteY: number): void {
    const p = spriteToBody({ x: spriteX, y: spriteY });
    body.x = p.x;
    body.y = p.y;
    body.vx = 0;
    body.vy = 0;
  }

  setEntityDead(body: PhysicsBody): void {
    body.mask = CORPSE_SOLID_MASK;
    body.vx = 0;
    body.vy = 0;
  }

  step(): void {
    this.world.step(SERVER_TICK_MS / 1000, SUBSTEPS);
  }
}
