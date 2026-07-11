import Matter from "matter-js";
import { TILE_PROPS, TILE_SIZE, TileId, SERVER_TICK_MS, FOOT_OFFSET, ENTITY_RADIUS, Layer, CORPSE_SOLID_MASK } from "shared";

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

export function syncStateFromBody(
  state: { x: number; y: number },
  body: Matter.Body,
): void {
  state.x = body.position.x;
  state.y = body.position.y - FOOT_OFFSET;
}

function buildWallBodies(
  mapData: TileId[][],
  mapCols: number,
  mapRows: number,
): Matter.Body[] {
  type Rect = { col: number; row: number; cols: number; rows: number };
  const runs: Rect[] = [];
  for (let row = 0; row < mapRows; row++) {
    let col = 0;
    while (col < mapCols) {
      const tile = mapData[row][col] as TileId;
      if (!TILE_PROPS[tile].walkable) {
        const start = col;
        while (col < mapCols && !TILE_PROPS[mapData[row][col] as TileId].walkable) col++;
        runs.push({ col: start, row, cols: col - start, rows: 1 });
      } else {
        col++;
      }
    }
  }

  const merged: Rect[] = [];
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

  const bodies = merged.map(r =>
    Matter.Bodies.rectangle(
      r.col * TILE_SIZE + (r.cols * TILE_SIZE) / 2,
      r.row * TILE_SIZE + (r.rows * TILE_SIZE) / 2,
      r.cols * TILE_SIZE,
      r.rows * TILE_SIZE,
      {
        isStatic: true,
        label: "wall",
        collisionFilter: { category: Layer.WALL, mask: WALL_SOLID_MASK },
      },
    ),
  );

  const w = mapCols * TILE_SIZE;
  const h = mapRows * TILE_SIZE;
  // Explicit filter — don't rely on Matter's default category happening to equal CAT.WALL.
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

  removeBarrier(id: string): void {
    const body = this.barriers.get(id);
    if (!body) return;
    Matter.Composite.remove(this.engine.world, body);
    this.barriers.delete(id);
  }

  // `layer` is the body's matter category (what it IS); `solidMask` is what it
  // physically blocks against. Both come from the entity's InteractionProfile.
  createEntityBody(spriteX: number, spriteY: number, layer: number, solidMask: number): Matter.Body {
    const body = Matter.Bodies.circle(
      spriteX,
      spriteY + FOOT_OFFSET,
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

  setVelocityPxPerSec(body: Matter.Body, vx: number, vy: number): void {
    Matter.Body.setVelocity(body, {
      x: pxPerSecToVelocity(vx),
      y: pxPerSecToVelocity(vy),
    });
  }

  setEntityPosition(body: Matter.Body, spriteX: number, spriteY: number): void {
    Matter.Body.setPosition(body, { x: spriteX, y: spriteY + FOOT_OFFSET });
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
