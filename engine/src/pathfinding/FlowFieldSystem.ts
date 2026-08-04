import {
  TileId,
  TILE_SIZE,
  RoomData,
  ROOM_W,
  ROOM_H,
  wallKind,
} from "shared";

// ── Flow-field pathfinding ────────────────────────────────────────────────────
// Enemies are confined to one room (Enemy.homeBounds), so navigation never needs
// to reason about the whole floor — only "get across THIS room to a player." That
// collapses the textbook A*-per-enemy into a shared FLOW FIELD: once per tick we
// BFS-flood a distance field from each in-room player over the room's walkable
// tiles, and every enemy targeting that player reads the gradient at its own tile
// in O(1). Many enemies chasing one player cost one flood between them.
//
// We flood PER PLAYER, not from a single "nearest player" source. That is what
// lets aggro live entirely in target SELECTION (Enemy.pickTarget) without the
// pathfinding knowing aggro exists: an enemy picks whose field to follow.
//
// Two traversability grids per room, so a flyer and a walker share the system:
//   - "ground": interior cover blocks are solid (walkers route AROUND them).
//   - "air":    cover is passable (flyers cut straight over; see wallKind).
// The single wallKind() classifier backs both these grids and the physics
// wall-body split, so what an enemy paths through and what its body collides with
// can never disagree.

export type FieldKind = "ground" | "air";

/** A flooded distance field over one room's interior, for one player, one kind.
 *  `dist[lr * width + lc]` is the BFS hop-count from the player's tile to interior
 *  local tile (lc, lr); -1 = blocked or unreached. */
interface DistanceField {
  dist: Int32Array;
}

/** Per-room static traversability: which interior tiles are blocked, per kind.
 *  Built once per floor (room geometry is fixed) and reused every tick's flood. */
interface RoomGrids {
  room: RoomData;
  /** Interior tile origin (top-left) in absolute tile coords. */
  originCol: number;
  originRow: number;
  width: number;   // interior columns (ROOM_W - 2)
  height: number;  // interior rows    (ROOM_H - 2)
  ground: Uint8Array; // 1 = blocked
  air: Uint8Array;
}

// 4-neighbour flood (uniform cost, no diagonal corner-cutting). The sampler then
// looks at 8 neighbours off this field for a smooth heading — see sample().
const N4: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const N8: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export class FlowFieldSystem {
  private grids = new Map<string, RoomGrids>();
  /** This tick's flooded fields, keyed `${roomId}:${sessionId}:${kind}`. Cleared
   *  and rebuilt every tick, so a field is never stale (the target moves each tick). */
  private fields = new Map<string, DistanceField>();

  constructor(
    private mapData: TileId[][],
    rooms: RoomData[],
  ) {
    for (const room of rooms) this.grids.set(room.id, this.buildGrids(room));
  }

  private buildGrids(room: RoomData): RoomGrids {
    // Interior excludes the 1-tile border ring — same box as roomInteriorRect.
    const originCol = room.tileCol + 1;
    const originRow = room.tileRow + 1;
    const width = ROOM_W - 2;
    const height = ROOM_H - 2;
    const ground = new Uint8Array(width * height);
    const air = new Uint8Array(width * height);
    for (let lr = 0; lr < height; lr++) {
      for (let lc = 0; lc < width; lc++) {
        const col = originCol + lc;
        const row = originRow + lr;
        const kind = wallKind(col, row, this.mapData[row][col] as TileId);
        const i = lr * width + lc;
        // Ground: any wall blocks. Air: only structural blocks (cover is flown over).
        ground[i] = kind !== null ? 1 : 0;
        air[i] = kind === "structural" ? 1 : 0;
      }
    }
    return { room, originCol, originRow, width, height, ground, air };
  }

  /** Rebuild every field for this tick: for each occupied room, flood from each
   *  player standing in that room, over both traversability grids. Called from
   *  GameRoom.tick before the enemy AI pass. */
  rebuild(
    occupiedRoomIds: Set<string>,
    players: Array<{ id: string; x: number; y: number }>,
  ): void {
    this.fields.clear();
    if (occupiedRoomIds.size === 0) return;
    for (const roomId of occupiedRoomIds) {
      const grids = this.grids.get(roomId);
      if (!grids) continue;
      for (const p of players) {
        const cell = this.toLocal(grids, p.x, p.y);
        if (!cell) continue; // this player isn't in this room's interior
        this.fields.set(`${roomId}:${p.id}:ground`, this.flood(grids, grids.ground, cell));
        this.fields.set(`${roomId}:${p.id}:air`, this.flood(grids, grids.air, cell));
      }
    }
  }

  /** The heading an enemy at (x, y) in `roomId` should walk to reach `sessionId`,
   *  as a raw tile-delta (caller normalizes via Entity.move). Returns null when
   *  there is no field (enemy outside a tracked/occupied room) or no downhill step
   *  exists (already adjacent to the target) — the caller then beelines. */
  sample(
    kind: FieldKind,
    roomId: string,
    sessionId: string,
    x: number,
    y: number,
  ): { dx: number; dy: number } | null {
    const grids = this.grids.get(roomId);
    if (!grids) return null;
    const field = this.fields.get(`${roomId}:${sessionId}:${kind}`);
    if (!field) return null;
    const cell = this.toLocal(grids, x, y);
    if (!cell) return null;

    const { width, height } = grids;
    const cur = field.dist[cell.lr * width + cell.lc];
    const blocked = kind === "ground" ? grids.ground : grids.air;

    // Steepest descent: among the 8 open neighbours, walk toward the one closest
    // to the player (lowest hop-count). 8-way lookaround off a 4-way field gives a
    // smooth diagonal heading without the field itself cutting corners.
    let bestDist = cur >= 0 ? cur : Infinity;
    let best: { dx: number; dy: number } | null = null;
    for (const [dc, dr] of N8) {
      const nc = cell.lc + dc;
      const nr = cell.lr + dr;
      if (nc < 0 || nc >= width || nr < 0 || nr >= height) continue;
      const ni = nr * width + nc;
      if (blocked[ni]) continue;
      // Don't cut a diagonal past a blocked orthogonal neighbour (clip a corner).
      if (dc !== 0 && dr !== 0) {
        if (blocked[cell.lr * width + nc] || blocked[nr * width + cell.lc]) continue;
      }
      const d = field.dist[ni];
      if (d < 0) continue;
      if (d < bestDist) {
        bestDist = d;
        best = { dx: dc, dy: dr };
      }
    }
    return best;
  }

  /** Is the straight segment (x0,y0)→(x1,y1) unobstructed for `kind` within
   *  `roomId`? Used so an enemy with a clear shot beelines (precise tracking of a
   *  moving target) and only falls back to the 8-way field gradient when a wall or
   *  cover block is actually in the way. A point outside the room interior counts
   *  as blocked — you can't see through the perimeter. Returns true (no occlusion
   *  assumed) if the room has no grid. */
  lineOfSight(
    kind: FieldKind,
    roomId: string,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): boolean {
    const grids = this.grids.get(roomId);
    if (!grids) return true;
    const blocked = kind === "ground" ? grids.ground : grids.air;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    // March at half-tile resolution; endpoints excluded (the enemy and target
    // tiles are floor by construction).
    const steps = Math.ceil(dist / (TILE_SIZE * 0.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const cell = this.toLocal(grids, x0 + dx * t, y0 + dy * t);
      if (!cell) return false;
      if (blocked[cell.lr * grids.width + cell.lc]) return false;
    }
    return true;
  }

  private flood(grids: RoomGrids, blocked: Uint8Array, start: { lc: number; lr: number }): DistanceField {
    const { width, height } = grids;
    const dist = new Int32Array(width * height).fill(-1);
    const startI = start.lr * width + start.lc;
    // If the player stands on a blocked cell (shouldn't happen — players are on
    // floor) the flood would seed nothing; seed it anyway so nearby enemies still
    // get a gradient toward the player's tile.
    dist[startI] = 0;
    // Ring-buffer BFS queue over local indices.
    const queue = new Int32Array(width * height);
    let head = 0;
    let tail = 0;
    queue[tail++] = startI;
    while (head < tail) {
      const i = queue[head++];
      const lc = i % width;
      const lr = (i - lc) / width;
      const d = dist[i];
      for (const [dc, dr] of N4) {
        const nc = lc + dc;
        const nr = lr + dr;
        if (nc < 0 || nc >= width || nr < 0 || nr >= height) continue;
        const ni = nr * width + nc;
        if (blocked[ni] || dist[ni] !== -1) continue;
        dist[ni] = d + 1;
        queue[tail++] = ni;
      }
    }
    return { dist };
  }

  /** World pixel → interior local tile, or null if outside this room's interior. */
  private toLocal(grids: RoomGrids, x: number, y: number): { lc: number; lr: number } | null {
    const lc = Math.floor(x / TILE_SIZE) - grids.originCol;
    const lr = Math.floor(y / TILE_SIZE) - grids.originRow;
    if (lc < 0 || lc >= grids.width || lr < 0 || lr >= grids.height) return null;
    return { lc, lr };
  }
}
