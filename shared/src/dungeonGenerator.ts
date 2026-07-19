import { TILE, TileId, TILE_SIZE } from "./types";
import type { RoomType } from "./types";

// Default room grid dimensions (overridable per-call via DungeonOptions)
const DEFAULT_GRID_COLS = 5;
const DEFAULT_GRID_ROWS = 4;
// Tile dimensions per room (includes 1-tile border wall on all sides)
export const ROOM_W = 21;
export const ROOM_H = 16;
// Percentage chance to consider each valid neighbor during room growth (sparseness)
const DEFAULT_NEIGHBOR_CHANCE = 60;
const DEFAULT_MIN_ROOMS = 4;
// Room types that place objects on their floor tiles — never put the stairs there.
const STAIRS_AVOID_TYPES: RoomType[] = ["shop", "shrine", "chest"];
// Percent chance that each eligible room hides a trap tile. Deliberately low: a
// trap should be a rare gut-punch, not a tax on exploring.
const TRAP_ROOM_CHANCE = 1;
// Room types that never get a trap. The reward rooms are meant to be safe places
// to walk into, and the boss room has enough going on already.
const TRAP_AVOID_TYPES: RoomType[] = [
  "boss",
  "shop",
  "shrine",
  "chest",
];
// Keep traps this far inside a room's border (so they're never on a doorway) and
// this far from its center (so one never lands on the stairs or a pedestal).
const TRAP_BORDER_MARGIN = 2;
const TRAP_CENTER_CLEARANCE = 2;

export const DUNGEON_COLS = DEFAULT_GRID_COLS * ROOM_W;
export const DUNGEON_ROWS = DEFAULT_GRID_ROWS * ROOM_H;

/**
 * Knobs for a non-standard floor. Every field is optional and defaults to the
 * normal dungeon; pass `{}` (or nothing) for the real game. This object is
 * JSON-serialized into `GameState.dungeonOpts` so every client rebuilds the
 * same map the server generated.
 *
 * A single room containing exactly what you want:
 *   generateDungeon(seed, { gridCols: 1, gridRows: 1, minRooms: 1, forceRoomType: "maze" })
 */
export interface DungeonOptions {
  /** Rooms across / down in the room grid. Default 5 × 4. */
  gridCols?: number;
  gridRows?: number;
  /** Sparseness of the random walk, 0–100. Default 60. */
  neighborChance?: number;
  /** Force-grow the walk until this many rooms exist. Default 4 (clamped to grid area). */
  minRooms?: number;
  /** Give every room this type instead of rolling weighted types. Default null (roll). */
  forceRoomType?: RoomType | null;
  /**
   * Build a fixed 3-room line to show off one room type: a plain start room, then
   * this type, then the exit. Overrides grid size and the random walk. Lets the
   * debug menu test a shop/shrine/boss room with a real spawn point and stairs
   * instead of a degenerate single room that is both start and exit.
   */
  showcaseRoomType?: RoomType | null;
  /** Reserve one non-start room as the boss room. Defaults to true unless forceRoomType is set. */
  includeBoss?: boolean;
  /** Place the descend-stairs tile in the exit room. Default true. */
  includeStairs?: boolean;
}

// Room type spawn weights for non-boss rooms. Plain weights, summed at module
// load — editing one no longer means recomputing every row below it.
const ROOM_TYPE_WEIGHTS: { type: RoomType; weight: number }[] = [
  { type: "combat", weight: 37 },
  { type: "timed",  weight:  6 },
  { type: "dark",   weight:  4 },
  { type: "wave",   weight:  8 },
  { type: "maze",   weight: 16 },
  { type: "shop",   weight: 15 },
  { type: "shrine", weight:  7 },
  { type: "chest",  weight:  7 },
];
const ROOM_TYPE_WEIGHT_TOTAL = ROOM_TYPE_WEIGHTS.reduce((n, e) => n + e.weight, 0);

export type { RoomType };

// Mulberry32 seeded RNG — deterministic, same seed → same map on client and server
function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRoomType(rng: () => number): RoomType {
  // One rng draw, scaled to the weight total — the draw order (and so every
  // seed's map) is identical to the old cumulative-table lookup.
  const r = rng() * ROOM_TYPE_WEIGHT_TOTAL;
  let acc = 0;
  for (const entry of ROOM_TYPE_WEIGHTS) {
    acc += entry.weight;
    if (r < acc) return entry.type;
  }
  return "combat";
}

interface RC { gx: number; gy: number }
const roomKey = (c: RC) => `${c.gx},${c.gy}`;

export interface RoomData {
  id: string;           // "${gx},${gy}"
  gx: number; gy: number;
  tileCol: number;      // top-left tile column of this room's grid slot
  tileRow: number;      // top-left tile row
  centerCol: number;    // center tile column (used for doorways)
  centerRow: number;    // center tile row
  type: RoomType;
}

export interface BarrierRect {
  cx: number; cy: number;   // pixel center
  w: number; h: number;     // pixel dimensions
}

export interface ConnectionData {
  id: string;
  parentRoomId: string;   // room you come FROM (closer to start)
  childRoomId: string;    // room you go TO (farther from start)
  // Pixel bounds for passageway zone detection
  passXMin: number; passXMax: number;
  passYMin: number; passYMax: number;
  // Barrier that blocks entry to child room from passageway (removed on parent clear)
  barrierChild: BarrierRect;
  // Barrier that blocks return to parent room (added after players commit — reserved for future)
  barrierParent: BarrierRect;
}

export interface DungeonResult {
  mapData: TileId[][];
  cols: number;
  rows: number;
  playerSpawns: Array<{ x: number; y: number }>;
  roomCenters: Array<{ col: number; row: number }>;
  rooms: RoomData[];
  connections: ConnectionData[];
  startRoomId: string;
  exitRoomId: string;
  /** null when the floor has no boss room (single-room debug floors, forced room types). */
  bossRoomId: string | null;
  roomTypes: Map<string, RoomType>;
  stairsTile: { col: number; row: number };
}

// Carve tiles inward from (c,r) in direction (dc,dr) until hitting a floor tile.
function carveUntilFloor(
  mapData: TileId[][],
  carve: (col: number, row: number) => void,
  c: number, r: number, dc: number, dr: number, max: number,
  cols: number, rows: number,
) {
  for (let i = 0; i < max; i++) {
    if (c < 0 || c >= cols || r < 0 || r >= rows) return;
    if (mapData[r][c] === TILE.FLOOR) return;
    carve(c, r);
    c += dc;
    r += dr;
  }
}

// Nearest walkable, non-stairs tile to (col,row), breadth-first. Used for the
// player spawn when the start room's center is occupied by the stairs — which
// only happens on a single-room floor, where start === exit.
function nearestFreeTile(
  mapData: TileId[][], col: number, row: number, cols: number, rows: number,
): { col: number; row: number } {
  const seen = new Set<string>([`${col},${row}`]);
  const queue: Array<{ col: number; row: number }> = [{ col, row }];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (mapData[cur.row]?.[cur.col] === TILE.FLOOR) return cur;
    for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as [number, number][]) {
      const nc = cur.col + dc, nr = cur.row + dr;
      const key = `${nc},${nr}`;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows || seen.has(key)) continue;
      seen.add(key);
      queue.push({ col: nc, row: nr });
    }
  }
  return { col, row };
}

// Recursive backtracking maze carved into one room's interior.
function carveMazeInRoom(
  gx: number, gy: number,
  mapData: TileId[][],
  carve: (col: number, row: number) => void,
  rng: () => number,
) {
  const randInt = (n: number) => Math.floor(rng() * n);
  const c0 = gx * ROOM_W + 1;
  const r0 = gy * ROOM_H + 1;
  const W = ROOM_W - 2;
  const H = ROOM_H - 2;
  const cellCols = Math.floor(W / 2);
  const cellRows = Math.floor(H / 2);
  const cellCol = (ci: number) => c0 + 1 + ci * 2;
  const cellRow = (ri: number) => r0 + 1 + ri * 2;
  const visited = Array.from({ length: cellCols }, () => new Array(cellRows).fill(false));
  const ci0 = randInt(cellCols);
  const ri0 = randInt(cellRows);
  visited[ci0][ri0] = true;
  carve(cellCol(ci0), cellRow(ri0));
  const DIRS = [
    { dci: 0, dri: -1 }, { dci: 1, dri: 0 },
    { dci: 0, dri: 1 }, { dci: -1, dri: 0 },
  ];
  const stack = [{ ci: ci0, ri: ri0 }];
  while (stack.length > 0) {
    const { ci, ri } = stack[stack.length - 1];
    const options = DIRS.filter(({ dci, dri }) => {
      const nci = ci + dci, nri = ri + dri;
      return nci >= 0 && nci < cellCols && nri >= 0 && nri < cellRows && !visited[nci][nri];
    });
    if (options.length > 0) {
      const { dci, dri } = options[randInt(options.length)];
      const nci = ci + dci, nri = ri + dri;
      visited[nci][nri] = true;
      carve(cellCol(ci) + dci, cellRow(ri) + dri);
      carve(cellCol(nci), cellRow(nri));
      stack.push({ ci: nci, ri: nri });
    } else {
      stack.pop();
    }
  }
}

// Open room: fully carved interior with optional scattered cover blocks.
// Used for combat, boss, shop, shrine, and chest rooms.
function carveOpenRoom(
  gx: number, gy: number,
  mapData: TileId[][],
  carve: (col: number, row: number) => void,
  rng: () => number,
  withCover: boolean,
) {
  const c0 = gx * ROOM_W + 1;
  const r0 = gy * ROOM_H + 1;
  const W = ROOM_W - 2;
  const H = ROOM_H - 2;

  // Carve entire interior as floor
  for (let r = r0; r < r0 + H; r++)
    for (let c = c0; c < c0 + W; c++)
      carve(c, r);

  if (!withCover) return;

  // 25% chance of a fully open room; otherwise place 2–6 cover clusters
  if (rng() < 0.25) return;

  const blockCount = 2 + Math.floor(rng() * 5);

  // Tetris-ish shapes: [dc, dr] offsets from anchor
  const SHAPES: [number, number][][] = [
    [[0, 0]],                          // single pillar
    [[0, 0], [1, 0]],                  // 1×2 horizontal
    [[0, 0], [0, 1]],                  // 1×2 vertical
    [[0, 0], [1, 0], [0, 1], [1, 1]], // 2×2 block
    [[0, 0], [1, 0], [1, 1]],          // L
    [[0, 0], [1, 0], [0, 1]],          // reverse L
  ];

  // Keep blocks away from room edges (so doorway entrances stay clear)
  const margin = 3;
  const safeW = W - margin * 2 - 2; // -2 for max shape width
  const safeH = H - margin * 2 - 2;
  if (safeW <= 0 || safeH <= 0) return;

  for (let i = 0; i < blockCount; i++) {
    const shape = SHAPES[Math.floor(rng() * SHAPES.length)];
    const localC = margin + Math.floor(rng() * safeW);
    const localR = margin + Math.floor(rng() * safeH);
    const col = c0 + localC;
    const row = r0 + localR;

    // Skip blocks that would sit right in the center doorway corridor
    const centerC = Math.floor(W / 2);
    const centerR = Math.floor(H / 2);
    if (Math.abs(localC - centerC) <= 1 && localR <= 1) continue;
    if (Math.abs(localC - centerC) <= 1 && localR >= H - 2) continue;
    if (Math.abs(localR - centerR) <= 1 && localC <= 1) continue;
    if (Math.abs(localR - centerR) <= 1 && localC >= W - 2) continue;

    for (const [dc, dr] of shape) {
      const tc = col + dc;
      const tr = row + dr;
      if (tc >= c0 && tc < c0 + W && tr >= r0 && tr < r0 + H)
        mapData[tr][tc] = TILE.WALL;
    }
  }
}

/**
 * Convert one plain floor tile in `room` into a trap.
 *
 * Only TILE.FLOOR is eligible, so this can never eat the stairs, a boss
 * passageway, or a wall — and the margins keep it off doorways and out of the
 * center where props live. Returns false when the room has no legal spot (a maze
 * room can be almost entirely wall).
 */
function placeTrapInRoom(
  mapData: TileId[][],
  room: RoomData,
  rng: () => number,
): boolean {
  const candidates: { col: number; row: number }[] = [];
  const c0 = room.tileCol + TRAP_BORDER_MARGIN;
  const r0 = room.tileRow + TRAP_BORDER_MARGIN;
  const c1 = room.tileCol + ROOM_W - 1 - TRAP_BORDER_MARGIN;
  const r1 = room.tileRow + ROOM_H - 1 - TRAP_BORDER_MARGIN;

  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      if (mapData[row]?.[col] !== TILE.FLOOR) continue;
      const nearCenter =
        Math.abs(col - room.centerCol) <= TRAP_CENTER_CLEARANCE &&
        Math.abs(row - room.centerRow) <= TRAP_CENTER_CLEARANCE;
      if (nearCenter) continue;
      candidates.push({ col, row });
    }
  }

  if (candidates.length === 0) return false;
  const spot = candidates[Math.floor(rng() * candidates.length)];
  mapData[spot.row][spot.col] = TILE.TRAP;
  return true;
}

/** The room-grid graph: which grid cells hold a room, and which rooms adjoin.
 *  Pure topology — no tiles, no types. */
class RoomGraph {
  readonly placed: boolean[][];
  readonly adjacency = new Map<string, RC[]>();

  constructor(readonly gridCols: number, readonly gridRows: number) {
    this.placed = Array.from({ length: gridCols }, () =>
      new Array(gridRows).fill(false),
    );
  }

  inBounds(c: RC): boolean {
    return c.gx >= 0 && c.gx < this.gridCols && c.gy >= 0 && c.gy < this.gridRows;
  }

  has(c: RC): boolean {
    return this.placed[c.gx][c.gy];
  }

  place(c: RC): void {
    this.placed[c.gx][c.gy] = true;
  }

  /** Undirected: both rooms learn about each other. */
  connect(a: RC, b: RC): void {
    for (const [from, to] of [[a, b], [b, a]] as [RC, RC][]) {
      const k = roomKey(from);
      if (!this.adjacency.has(k)) this.adjacency.set(k, []);
      const list = this.adjacency.get(k)!;
      if (!list.some((r) => r.gx === to.gx && r.gy === to.gy)) list.push(to);
    }
  }

  neighbors(id: string): RC[] {
    return this.adjacency.get(id) ?? [];
  }

  /** Every placed room, column-major. Iteration order is part of the seed
   *  contract — room ids, carve order, and trap rolls all follow it. */
  rooms(): RC[] {
    const out: RC[] = [];
    for (let gx = 0; gx < this.gridCols; gx++)
      for (let gy = 0; gy < this.gridRows; gy++)
        if (this.placed[gx][gy]) out.push({ gx, gy });
    return out;
  }
}

const DIRS: RC[] = [
  { gx: 0, gy: -1 }, { gx: 1, gy: 0 }, { gx: 0, gy: 1 }, { gx: -1, gy: 0 },
];

/** Tile dimensions of the whole floor, alongside the room-grid dimensions. */
interface FloorDims {
  gridCols: number; gridRows: number;
  cols: number; rows: number;
}

// ── 1. Build the room graph via random walk ────────────────────────────────
function buildRoomGraph(
  graph: RoomGraph,
  rng: () => number,
  showcase: RoomType | null,
  neighborChance: number,
): RC {
  const randInt = (max: number) => Math.floor(rng() * max);
  const chance = (pct: number) => rng() * 100 < pct;

  if (showcase) {
    // Fixed line: start (0,0) — special (1,0) — exit (2,0), left to right.
    for (let gx = 0; gx < 3; gx++) graph.place({ gx, gy: 0 });
    graph.connect({ gx: 0, gy: 0 }, { gx: 1, gy: 0 });
    graph.connect({ gx: 1, gy: 0 }, { gx: 2, gy: 0 });
    return { gx: 0, gy: 0 };
  }

  const unvisitedNeighbors = (c: RC): RC[] =>
    DIRS
      .map((d) => ({ gx: c.gx + d.gx, gy: c.gy + d.gy }))
      .filter((n) => graph.inBounds(n) && !graph.has(n) && chance(neighborChance));

  const sx = Math.max(0, Math.min(graph.gridCols - 1, Math.floor(graph.gridCols / 2) + randInt(3) - 1));
  const sy = Math.max(0, Math.min(graph.gridRows - 1, Math.floor(graph.gridRows / 2) + randInt(3) - 1));
  const start: RC = { gx: sx, gy: sy };
  graph.place(start);

  const stack: RC[] = [start];
  while (stack.length > 0) {
    const cur = stack[stack.length - 1];
    const next = unvisitedNeighbors(cur);
    if (next.length > 0) {
      const chosen = next[randInt(next.length)];
      graph.place(chosen);
      graph.connect(cur, chosen);
      stack.push(chosen);
    } else {
      stack.pop();
    }
  }
  return start;
}

// ── 1b. Enforce a minimum room count ───────────────────────────────────────
// The walk can stall immediately (every neighborChance roll fails — e.g. seed
// 1361, floor 25 from MAP_SEED), leaving a single room where exit === start,
// the stairs get overwritten, and there is no boss candidate. Force-grow by
// attaching random unvisited neighbors until we have enough rooms.
function growToMinRooms(graph: RoomGraph, rng: () => number, minRooms: number): void {
  const randInt = (max: number) => Math.floor(rng() * max);
  const placedRooms = graph.rooms();

  while (placedRooms.length < minRooms) {
    const growth: { from: RC; to: RC }[] = [];
    for (const room of placedRooms) {
      for (const d of DIRS) {
        const n = { gx: room.gx + d.gx, gy: room.gy + d.gy };
        if (graph.inBounds(n) && !graph.has(n)) growth.push({ from: room, to: n });
      }
    }
    if (growth.length === 0) break;
    const { from, to } = growth[randInt(growth.length)];
    graph.place(to);
    graph.connect(from, to);
    placedRooms.push(to);
  }
}

// ── 2. Assign room types ───────────────────────────────────────────────────
function assignRoomTypes(
  roomIds: string[],
  startId: string,
  rng: () => number,
  showcase: RoomType | null,
  forceRoomType: RoomType | null,
  wantBoss: boolean,
): { roomTypes: Map<string, RoomType>; bossRoomId: string | null } {
  const roomTypes = new Map<string, RoomType>();

  if (showcase) {
    // start & exit are plain combat rooms; the middle is the room being shown off.
    const midId = roomKey({ gx: 1, gy: 0 });
    roomTypes.set(startId, "combat");
    roomTypes.set(midId, showcase);
    roomTypes.set(roomKey({ gx: 2, gy: 0 }), "combat");
    // Only a boss room if that's what's being shown off.
    return { roomTypes, bossRoomId: showcase === "boss" ? midId : null };
  }

  // Boss: random non-start room. Skipped when disabled or when the start room
  // is the only room, since the boss can never be the room you spawn in.
  const bossEligible = roomIds.filter((id) => id !== startId);
  const bossRoomId = wantBoss && bossEligible.length > 0
    ? bossEligible[Math.floor(rng() * bossEligible.length)]
    : null;
  if (bossRoomId) roomTypes.set(bossRoomId, "boss");

  // All other rooms: the forced type, or a weighted roll
  for (const id of roomIds) {
    if (id === bossRoomId) continue;
    roomTypes.set(id, forceRoomType ?? pickRoomType(rng));
  }
  return { roomTypes, bossRoomId };
}

// ── 3. Build the tile grid and carve each room by type ─────────────────────
function carveRooms(
  graph: RoomGraph,
  roomTypes: Map<string, RoomType>,
  dims: FloorDims,
  rng: () => number,
): {
  mapData: TileId[][];
  carve: (col: number, row: number) => void;
  roomDataMap: Map<string, RoomData>;
  roomCenters: Array<{ col: number; row: number }>;
} {
  const mapData: TileId[][] = Array.from({ length: dims.rows }, () =>
    new Array(dims.cols).fill(TILE.WALL) as TileId[],
  );
  const carve = (col: number, row: number) => {
    if (col >= 0 && col < dims.cols && row >= 0 && row < dims.rows)
      mapData[row][col] = TILE.FLOOR;
  };

  const roomDataMap = new Map<string, RoomData>();
  const roomCenters: Array<{ col: number; row: number }> = [];

  for (const { gx, gy } of graph.rooms()) {
    const id = roomKey({ gx, gy });
    const type = roomTypes.get(id)!;
    const centerCol = gx * ROOM_W + Math.floor(ROOM_W / 2);
    const centerRow = gy * ROOM_H + Math.floor(ROOM_H / 2);
    roomDataMap.set(id, {
      id, gx, gy,
      tileCol: gx * ROOM_W,
      tileRow: gy * ROOM_H,
      centerCol, centerRow,
      type,
    });
    roomCenters.push({ col: centerCol, row: centerRow });

    if (type === "maze") {
      carveMazeInRoom(gx, gy, mapData, carve, rng);
    } else {
      // Cover blocks are for rooms you fight in — a wave room is a combat room
      // that arrives in installments and a timed room is one on a clock, so both
      // get the same terrain to use. A dark room pointedly does NOT: you can't
      // see the cover, so it would only be something to get stuck on.
      const withCover = type === "combat" || type === "wave" || type === "timed";
      carveOpenRoom(gx, gy, mapData, carve, rng, withCover);
    }
  }

  return { mapData, carve, roomDataMap, roomCenters };
}

// ── 4. Carve doorways between connected rooms ──────────────────────────────
function carveDoorways(graph: RoomGraph, carve: (col: number, row: number) => void): void {
  graph.adjacency.forEach((neighbors, k) => {
    const [gx, gy] = k.split(",").map(Number);
    for (const n of neighbors) {
      // Each undirected pair is carved once, from the lower-ordered room.
      if (n.gx < gx || (n.gx === gx && n.gy < gy)) continue;
      const centerCol = gx * ROOM_W + Math.floor(ROOM_W / 2);
      const centerRow = gy * ROOM_H + Math.floor(ROOM_H / 2);
      if (n.gx === gx + 1) {
        const wallCol = (gx + 1) * ROOM_W - 1;
        const nextCol = n.gx * ROOM_W;
        for (let dr = -1; dr <= 1; dr++) {
          carve(wallCol, centerRow + dr);
          carve(nextCol, centerRow + dr);
        }
      } else if (n.gy === gy + 1) {
        const wallRow = (gy + 1) * ROOM_H - 1;
        const nextRow = n.gy * ROOM_H;
        for (let dc = -1; dc <= 1; dc++) {
          carve(centerCol + dc, wallRow);
          carve(centerCol + dc, nextRow);
        }
      }
    }
  });
}

// ── 5. Carve entry corridors from doorways into each room's interior ───────
// A maze room's doorway can open onto wall; this tunnels inward until it meets
// carved floor. Walks every directed adjacency entry (not just one per pair) —
// both rooms need their own approach carved.
function carveEntryCorridors(
  graph: RoomGraph,
  mapData: TileId[][],
  carve: (col: number, row: number) => void,
  dims: FloorDims,
): void {
  graph.adjacency.forEach((neighbors, k) => {
    const [gx, gy] = k.split(",").map(Number);
    const centerCol = gx * ROOM_W + Math.floor(ROOM_W / 2);
    const centerRow = gy * ROOM_H + Math.floor(ROOM_H / 2);
    for (const n of neighbors) {
      if (n.gx === gx + 1) {
        for (let dr = -1; dr <= 1; dr++)
          carveUntilFloor(mapData, carve, (gx + 1) * ROOM_W - 2, centerRow + dr, -1, 0, ROOM_W, dims.cols, dims.rows);
      } else if (n.gx === gx - 1) {
        for (let dr = -1; dr <= 1; dr++)
          carveUntilFloor(mapData, carve, gx * ROOM_W + 1, centerRow + dr, 1, 0, ROOM_W, dims.cols, dims.rows);
      } else if (n.gy === gy + 1) {
        for (let dc = -1; dc <= 1; dc++)
          carveUntilFloor(mapData, carve, centerCol + dc, (gy + 1) * ROOM_H - 2, 0, -1, ROOM_H, dims.cols, dims.rows);
      } else if (n.gy === gy - 1) {
        for (let dc = -1; dc <= 1; dc++)
          carveUntilFloor(mapData, carve, centerCol + dc, gy * ROOM_H + 1, 0, 1, ROOM_H, dims.cols, dims.rows);
      }
    }
  });
}

/**
 * One directed connection, derived from the direction alone.
 *
 * All four cases are the same shape: the passageway spans the parent's border
 * tile in direction `dir` and the child's border tile in direction `-dir`, and
 * is three tiles wide across the other axis, centred on the parent's centre
 * line. `barrierParent` sits on the parent's border tile, `barrierChild` on the
 * child's — which is the whole difference between them.
 */
function makeConnection(parent: RoomData, child: RoomData, dir: RC): ConnectionData {
  const id = `conn_${parent.id}_${child.id}`;
  const horizontal = dir.gx !== 0;

  // The two border tiles the passageway joins, as tile indices on the travel axis.
  const wall = horizontal
    ? (dir.gx > 0 ? parent.tileCol + ROOM_W - 1 : parent.tileCol)
    : (dir.gy > 0 ? parent.tileRow + ROOM_H - 1 : parent.tileRow);
  const next = horizontal
    ? (dir.gx > 0 ? child.tileCol : child.tileCol + ROOM_W - 1)
    : (dir.gy > 0 ? child.tileRow : child.tileRow + ROOM_H - 1);

  // Travel axis spans both border tiles; cross axis is the 3-tile doorway.
  const travelMin = Math.min(wall, next) * TILE_SIZE;
  const travelMax = (Math.max(wall, next) + 1) * TILE_SIZE;
  const cross = horizontal ? parent.centerRow : parent.centerCol;
  const crossMin = (cross - 1) * TILE_SIZE;
  const crossMax = (cross + 2) * TILE_SIZE;

  const barrierAt = (tile: number): BarrierRect => ({
    cx: (horizontal ? tile : cross) * TILE_SIZE + TILE_SIZE / 2,
    cy: (horizontal ? cross : tile) * TILE_SIZE + TILE_SIZE / 2,
    w: horizontal ? TILE_SIZE : 3 * TILE_SIZE,
    h: horizontal ? 3 * TILE_SIZE : TILE_SIZE,
  });

  return {
    id,
    parentRoomId: parent.id,
    childRoomId: child.id,
    passXMin: horizontal ? travelMin : crossMin,
    passXMax: horizontal ? travelMax : crossMax,
    passYMin: horizontal ? crossMin : travelMin,
    passYMax: horizontal ? crossMax : travelMax,
    barrierChild: barrierAt(next),
    barrierParent: barrierAt(wall),
  };
}

// ── 6. BFS from start to build directed connections + room depths ──────────
function buildConnections(
  graph: RoomGraph,
  roomDataMap: Map<string, RoomData>,
  startId: string,
): { connections: ConnectionData[]; roomDepth: Map<string, number> } {
  const visited = new Set<string>([startId]);
  const queue: string[] = [startId];
  const roomDepth = new Map<string, number>([[startId, 0]]);
  const connections: ConnectionData[] = [];

  while (queue.length > 0) {
    const curId = queue.shift()!;
    const parent = roomDataMap.get(curId)!;
    const curDepth = roomDepth.get(curId)!;

    for (const n of graph.neighbors(curId)) {
      const nId = roomKey(n);
      if (visited.has(nId)) continue;
      visited.add(nId);
      queue.push(nId);
      roomDepth.set(nId, curDepth + 1);

      const child = roomDataMap.get(nId)!;
      connections.push(makeConnection(parent, child, {
        gx: child.gx - parent.gx,
        gy: child.gy - parent.gy,
      }));
    }
  }

  return { connections, roomDepth };
}

// ── 7. Pick the exit room, stamp the stairs, and settle the spawn tile ─────
function pickExitAndSpawn(
  mapData: TileId[][],
  roomDataMap: Map<string, RoomData>,
  roomTypes: Map<string, RoomType>,
  roomDepth: Map<string, number>,
  startId: string,
  dims: FloorDims,
  wantStairs: boolean,
): { exitRoomId: string; exitRoom: RoomData; spawnTile: { col: number; row: number } } {
  // Exit room = farthest from start in BFS, but never a room that puts props on its
  // floor — the stairs go at the room's center, which is exactly where a shop lays
  // its middle pedestal. Fall back to the plain farthest room if every candidate is
  // a prop room (a forced-room-type debug floor).
  let exitRoomId = startId;
  let maxDepth = -1;
  let deepestId = startId;
  let deepestDepth = -1;
  roomDepth.forEach((depth, id) => {
    if (depth > deepestDepth) { deepestDepth = depth; deepestId = id; }
    if (STAIRS_AVOID_TYPES.includes(roomTypes.get(id)!)) return;
    if (depth > maxDepth) { maxDepth = depth; exitRoomId = id; }
  });
  if (maxDepth < 0) exitRoomId = deepestId;

  // Place STAIRS tile at the exit room's center
  const exitRoom = roomDataMap.get(exitRoomId)!;
  if (wantStairs) mapData[exitRoom.centerRow][exitRoom.centerCol] = TILE.STAIRS;

  // Ensure start room center is walkable — but never overwrite the stairs
  // (start === exit on a single-room floor, or if minimum-room growth was exhausted).
  const startRoom = roomDataMap.get(startId)!;
  if (startId !== exitRoomId) {
    mapData[startRoom.centerRow][startRoom.centerCol] = TILE.FLOOR;
  }

  // Spawning on the stairs would descend a floor the instant the room loads, so
  // when start === exit, step the spawn off to the nearest open tile.
  const spawnTile = mapData[startRoom.centerRow][startRoom.centerCol] === TILE.STAIRS
    ? nearestFreeTile(mapData, startRoom.centerCol, startRoom.centerRow, dims.cols, dims.rows)
    : { col: startRoom.centerCol, row: startRoom.centerRow };

  return { exitRoomId, exitRoom, spawnTile };
}

// ── 8. Colour boss passageway tiles gold ───────────────────────────────────
function stampBossPassage(
  mapData: TileId[][],
  connections: ConnectionData[],
  bossRoomId: string | null,
): void {
  if (bossRoomId === null) return;
  for (const conn of connections) {
    if (conn.childRoomId !== bossRoomId && conn.parentRoomId !== bossRoomId) continue;
    const colMin = Math.floor(conn.passXMin / TILE_SIZE);
    const colMax = Math.floor(conn.passXMax / TILE_SIZE);
    const rowMin = Math.floor(conn.passYMin / TILE_SIZE);
    const rowMax = Math.floor(conn.passYMax / TILE_SIZE);
    for (let r = rowMin; r <= rowMax; r++) {
      for (let c = colMin; c <= colMax; c++) {
        if (mapData[r]?.[c] === TILE.FLOOR) mapData[r][c] = TILE.BOSS_FLOOR;
      }
    }
  }
}

// ── 9. Scatter trap tiles ──────────────────────────────────────────────────
// Last, so only tiles that survived as plain FLOOR are eligible — the stairs and
// the gold boss passageway are already stamped and can't be overwritten. The
// start room is skipped so a floor can never open with the party on top of one.
function placeTraps(
  mapData: TileId[][],
  roomDataMap: Map<string, RoomData>,
  roomTypes: Map<string, RoomType>,
  startId: string,
  rng: () => number,
): void {
  for (const [id, room] of roomDataMap) {
    if (id === startId) continue;
    if (TRAP_AVOID_TYPES.includes(roomTypes.get(id)!)) continue;
    if (rng() * 100 >= TRAP_ROOM_CHANCE) continue;
    placeTrapInRoom(mapData, room, rng);
  }
}

/**
 * Generate one floor. A pipeline of the phases above, in an order the seed
 * contract depends on: every phase that draws from `rng` must keep both its
 * position here and its internal draw order, or existing seeds produce
 * different maps and client/server desync.
 */
export function generateDungeon(seed: number, opts: DungeonOptions = {}): DungeonResult {
  const rng = makeRng(seed);

  // A showcase floor is a fixed 3-room horizontal line, so it dictates the grid.
  const showcase = opts.showcaseRoomType ?? null;
  const gridCols = showcase ? 3 : Math.max(1, opts.gridCols ?? DEFAULT_GRID_COLS);
  const gridRows = showcase ? 1 : Math.max(1, opts.gridRows ?? DEFAULT_GRID_ROWS);
  const dims: FloorDims = {
    gridCols, gridRows,
    cols: gridCols * ROOM_W,
    rows: gridRows * ROOM_H,
  };
  const neighborChance = opts.neighborChance ?? DEFAULT_NEIGHBOR_CHANCE;
  const minRooms = Math.min(opts.minRooms ?? DEFAULT_MIN_ROOMS, gridCols * gridRows);
  const forceRoomType = opts.forceRoomType ?? null;
  // A forced room type means "give me exactly this room" — don't steal one for the boss.
  const wantBoss = opts.includeBoss ?? forceRoomType === null;
  const wantStairs = opts.includeStairs ?? true;

  const graph = new RoomGraph(gridCols, gridRows);
  const start = buildRoomGraph(graph, rng, showcase, neighborChance);
  const startId = roomKey(start);
  growToMinRooms(graph, rng, minRooms);

  const roomIds = graph.rooms().map(roomKey);
  const { roomTypes, bossRoomId } = assignRoomTypes(
    roomIds,
    startId,
    rng,
    showcase,
    forceRoomType,
    wantBoss,
  );

  const { mapData, carve, roomDataMap, roomCenters } = carveRooms(graph, roomTypes, dims, rng);
  carveDoorways(graph, carve);
  carveEntryCorridors(graph, mapData, carve, dims);

  const { connections, roomDepth } = buildConnections(graph, roomDataMap, startId);
  const { exitRoomId, exitRoom, spawnTile } = pickExitAndSpawn(
    mapData,
    roomDataMap,
    roomTypes,
    roomDepth,
    startId,
    dims,
    wantStairs,
  );

  stampBossPassage(mapData, connections, bossRoomId);
  placeTraps(mapData, roomDataMap, roomTypes, startId, rng);

  const playerSpawns = [0, 1, 2, 3].map(() => ({
    x: spawnTile.col * TILE_SIZE + TILE_SIZE / 2,
    y: spawnTile.row * TILE_SIZE + TILE_SIZE / 2,
  }));

  return {
    mapData,
    cols: dims.cols,
    rows: dims.rows,
    playerSpawns,
    roomCenters,
    rooms: [...roomDataMap.values()],
    connections,
    startRoomId: startId,
    exitRoomId,
    bossRoomId,
    roomTypes,
    stairsTile: { col: exitRoom.centerCol, row: exitRoom.centerRow },
  };
}
