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

// Room type spawn weights for non-boss rooms
const ROOM_TYPE_WEIGHTS: { type: RoomType; cumulative: number }[] = [
  { type: "combat", cumulative: 55 },
  { type: "maze",   cumulative: 71 },
  { type: "shop",   cumulative: 86 },
  { type: "shrine", cumulative: 93 },
  { type: "chest",  cumulative: 100 },
];

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
  const r = rng() * 100;
  for (const entry of ROOM_TYPE_WEIGHTS) {
    if (r < entry.cumulative) return entry.type;
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

export function generateDungeon(seed: number, opts: DungeonOptions = {}): DungeonResult {
  const rng = makeRng(seed);
  const randInt = (max: number) => Math.floor(rng() * max);

  // A showcase floor is a fixed 3-room horizontal line, so it dictates the grid.
  const showcase = opts.showcaseRoomType ?? null;
  const GRID_COLS = showcase ? 3 : Math.max(1, opts.gridCols ?? DEFAULT_GRID_COLS);
  const GRID_ROWS = showcase ? 1 : Math.max(1, opts.gridRows ?? DEFAULT_GRID_ROWS);
  const NEIGHBOR_CHANCE = opts.neighborChance ?? DEFAULT_NEIGHBOR_CHANCE;
  const MIN_ROOMS = Math.min(opts.minRooms ?? DEFAULT_MIN_ROOMS, GRID_COLS * GRID_ROWS);
  const forceRoomType = opts.forceRoomType ?? null;
  // A forced room type means "give me exactly this room" — don't steal one for the boss.
  const wantBoss = opts.includeBoss ?? forceRoomType === null;
  const wantStairs = opts.includeStairs ?? true;

  const cols = GRID_COLS * ROOM_W;
  const rows = GRID_ROWS * ROOM_H;
  const chance = (pct: number) => rng() * 100 < pct;

  // ── 1. Build room graph via random walk ──────────────────────────────────
  const roomGrid: boolean[][] = Array.from({ length: GRID_COLS }, () =>
    new Array(GRID_ROWS).fill(false),
  );
  const adjacency = new Map<string, RC[]>();
  const addConnection = (a: RC, b: RC) => {
    for (const [from, to] of [[a, b], [b, a]] as [RC, RC][]) {
      const k = roomKey(from);
      if (!adjacency.has(k)) adjacency.set(k, []);
      const list = adjacency.get(k)!;
      if (!list.some(r => r.gx === to.gx && r.gy === to.gy)) list.push(to);
    }
  };

  const DIRS: RC[] = [
    { gx: 0, gy: -1 }, { gx: 1, gy: 0 }, { gx: 0, gy: 1 }, { gx: -1, gy: 0 },
  ];

  let start: RC;
  if (showcase) {
    // Fixed line: start (0,0) — special (1,0) — exit (2,0), left to right.
    for (let gx = 0; gx < 3; gx++) roomGrid[gx][0] = true;
    addConnection({ gx: 0, gy: 0 }, { gx: 1, gy: 0 });
    addConnection({ gx: 1, gy: 0 }, { gx: 2, gy: 0 });
    start = { gx: 0, gy: 0 };
  } else {
    const unvisitedNeighbors = (c: RC): RC[] =>
      DIRS
        .map(d => ({ gx: c.gx + d.gx, gy: c.gy + d.gy }))
        .filter(n =>
          n.gx >= 0 && n.gx < GRID_COLS && n.gy >= 0 && n.gy < GRID_ROWS &&
          !roomGrid[n.gx][n.gy] && chance(NEIGHBOR_CHANCE),
        );

    const sx = Math.max(0, Math.min(GRID_COLS - 1, Math.floor(GRID_COLS / 2) + randInt(3) - 1));
    const sy = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(GRID_ROWS / 2) + randInt(3) - 1));
    start = { gx: sx, gy: sy };
    roomGrid[start.gx][start.gy] = true;

    const stack: RC[] = [start];
    while (stack.length > 0) {
      const cur = stack[stack.length - 1];
      const next = unvisitedNeighbors(cur);
      if (next.length > 0) {
        const chosen = next[randInt(next.length)];
        roomGrid[chosen.gx][chosen.gy] = true;
        addConnection(cur, chosen);
        stack.push(chosen);
      } else {
        stack.pop();
      }
    }
  }

  const startId = roomKey(start);

  // ── 1b. Enforce a minimum room count ─────────────────────────────────────
  // The walk can stall immediately (every NEIGHBOR_CHANCE roll fails — e.g. seed
  // 1361, floor 25 from MAP_SEED), leaving a single room where exit === start,
  // the stairs get overwritten, and there is no boss candidate. Force-grow by
  // attaching random unvisited neighbors until we have enough rooms.
  const placedRooms: RC[] = [];
  for (let gx = 0; gx < GRID_COLS; gx++)
    for (let gy = 0; gy < GRID_ROWS; gy++)
      if (roomGrid[gx][gy]) placedRooms.push({ gx, gy });

  while (placedRooms.length < MIN_ROOMS) {
    const growth: { from: RC; to: RC }[] = [];
    for (const room of placedRooms) {
      for (const d of DIRS) {
        const n = { gx: room.gx + d.gx, gy: room.gy + d.gy };
        if (n.gx >= 0 && n.gx < GRID_COLS && n.gy >= 0 && n.gy < GRID_ROWS && !roomGrid[n.gx][n.gy]) {
          growth.push({ from: room, to: n });
        }
      }
    }
    if (growth.length === 0) break;
    const { from, to } = growth[randInt(growth.length)];
    roomGrid[to.gx][to.gy] = true;
    addConnection(from, to);
    placedRooms.push(to);
  }

  // Collect all room IDs
  const allRoomIds: string[] = [];
  for (let gx = 0; gx < GRID_COLS; gx++)
    for (let gy = 0; gy < GRID_ROWS; gy++)
      if (roomGrid[gx][gy]) allRoomIds.push(roomKey({ gx, gy }));

  // ── 2. Assign room types ────────────────────────────────────────────────
  const roomTypes = new Map<string, RoomType>();
  let bossRoomId: string | null;

  if (showcase) {
    // start & exit are plain combat rooms; the middle is the room being shown off.
    const midId = roomKey({ gx: 1, gy: 0 });
    roomTypes.set(startId, "combat");
    roomTypes.set(midId, showcase);
    roomTypes.set(roomKey({ gx: 2, gy: 0 }), "combat");
    // Only a boss room if that's what's being shown off.
    bossRoomId = showcase === "boss" ? midId : null;
  } else {
    // Boss: random non-start room. Skipped when disabled or when the start room
    // is the only room, since the boss can never be the room you spawn in.
    const bossEligible = allRoomIds.filter(id => id !== startId);
    bossRoomId = wantBoss && bossEligible.length > 0
      ? bossEligible[randInt(bossEligible.length)]
      : null;
    if (bossRoomId) roomTypes.set(bossRoomId, "boss");

    // All other rooms: the forced type, or a weighted roll
    for (const id of allRoomIds) {
      if (id === bossRoomId) continue;
      roomTypes.set(id, forceRoomType ?? pickRoomType(rng));
    }
  }

  // ── 3. Build tile grid and carve rooms ──────────────────────────────────
  const mapData: TileId[][] = Array.from({ length: rows }, () =>
    new Array(cols).fill(TILE.WALL) as TileId[],
  );
  const carve = (col: number, row: number) => {
    if (col >= 0 && col < cols && row >= 0 && row < rows)
      mapData[row][col] = TILE.FLOOR;
  };

  // Build RoomData and carve each room based on its type
  const roomDataMap = new Map<string, RoomData>();
  const roomCenters: Array<{ col: number; row: number }> = [];

  for (let gx = 0; gx < GRID_COLS; gx++) {
    for (let gy = 0; gy < GRID_ROWS; gy++) {
      if (!roomGrid[gx][gy]) continue;
      const id = roomKey({ gx, gy });
      const type = roomTypes.get(id)!;
      const centerCol = gx * ROOM_W + Math.floor(ROOM_W / 2);
      const centerRow = gy * ROOM_H + Math.floor(ROOM_H / 2);
      const rd: RoomData = {
        id, gx, gy,
        tileCol: gx * ROOM_W,
        tileRow: gy * ROOM_H,
        centerCol, centerRow,
        type,
      };
      roomDataMap.set(id, rd);
      roomCenters.push({ col: centerCol, row: centerRow });

      if (type === "maze") {
        carveMazeInRoom(gx, gy, mapData, carve, rng);
      } else {
        carveOpenRoom(gx, gy, mapData, carve, rng, type === "combat");
      }
    }
  }

  // ── 4. Carve doorways between connected rooms ────────────────────────────
  adjacency.forEach((neighbors, k) => {
    const [gx, gy] = k.split(",").map(Number);
    for (const n of neighbors) {
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

  // ── 5. Carve entry corridors from doorways into each room's maze ─────────
  adjacency.forEach((neighbors, k) => {
    const [gx, gy] = k.split(",").map(Number);
    const centerCol = gx * ROOM_W + Math.floor(ROOM_W / 2);
    const centerRow = gy * ROOM_H + Math.floor(ROOM_H / 2);
    for (const n of neighbors) {
      if (n.gx === gx + 1) {
        for (let dr = -1; dr <= 1; dr++)
          carveUntilFloor(mapData, carve, (gx + 1) * ROOM_W - 2, centerRow + dr, -1, 0, ROOM_W, cols, rows);
      } else if (n.gx === gx - 1) {
        for (let dr = -1; dr <= 1; dr++)
          carveUntilFloor(mapData, carve, gx * ROOM_W + 1, centerRow + dr, 1, 0, ROOM_W, cols, rows);
      } else if (n.gy === gy + 1) {
        for (let dc = -1; dc <= 1; dc++)
          carveUntilFloor(mapData, carve, centerCol + dc, (gy + 1) * ROOM_H - 2, 0, -1, ROOM_H, cols, rows);
      } else if (n.gy === gy - 1) {
        for (let dc = -1; dc <= 1; dc++)
          carveUntilFloor(mapData, carve, centerCol + dc, gy * ROOM_H + 1, 0, 1, ROOM_H, cols, rows);
      }
    }
  });

  // ── 6. BFS from start to build directed connections + find exit ──────────
  const bfsVisited = new Set<string>([startId]);
  const bfsQueue: string[] = [startId];
  const roomDepth = new Map<string, number>([[startId, 0]]);
  const connections: ConnectionData[] = [];

  while (bfsQueue.length > 0) {
    const curId = bfsQueue.shift()!;
    const [cgx, cgy] = curId.split(",").map(Number);
    const parent = roomDataMap.get(curId)!;
    const curDepth = roomDepth.get(curId)!;

    for (const n of (adjacency.get(curId) ?? [])) {
      const nId = roomKey(n);
      if (bfsVisited.has(nId)) continue;
      bfsVisited.add(nId);
      bfsQueue.push(nId);
      roomDepth.set(nId, curDepth + 1);

      const child = roomDataMap.get(nId)!;
      const connId = `conn_${curId}_${nId}`;
      let conn: ConnectionData;

      if (n.gx === cgx + 1) {
        const wallCol = (cgx + 1) * ROOM_W - 1;
        const nextCol = n.gx * ROOM_W;
        const cr = parent.centerRow;
        conn = {
          id: connId, parentRoomId: curId, childRoomId: nId,
          passXMin: wallCol * TILE_SIZE,
          passXMax: (nextCol + 1) * TILE_SIZE,
          passYMin: (cr - 1) * TILE_SIZE,
          passYMax: (cr + 2) * TILE_SIZE,
          barrierChild: { cx: nextCol * TILE_SIZE + TILE_SIZE / 2, cy: cr * TILE_SIZE + TILE_SIZE / 2, w: TILE_SIZE, h: 3 * TILE_SIZE },
          barrierParent: { cx: wallCol * TILE_SIZE + TILE_SIZE / 2, cy: cr * TILE_SIZE + TILE_SIZE / 2, w: TILE_SIZE, h: 3 * TILE_SIZE },
        };
      } else if (n.gx === cgx - 1) {
        const wallCol = cgx * ROOM_W;
        const nextCol = n.gx * ROOM_W + ROOM_W - 1;
        const cr = parent.centerRow;
        conn = {
          id: connId, parentRoomId: curId, childRoomId: nId,
          passXMin: nextCol * TILE_SIZE,
          passXMax: (wallCol + 1) * TILE_SIZE,
          passYMin: (cr - 1) * TILE_SIZE,
          passYMax: (cr + 2) * TILE_SIZE,
          barrierChild: { cx: nextCol * TILE_SIZE + TILE_SIZE / 2, cy: cr * TILE_SIZE + TILE_SIZE / 2, w: TILE_SIZE, h: 3 * TILE_SIZE },
          barrierParent: { cx: wallCol * TILE_SIZE + TILE_SIZE / 2, cy: cr * TILE_SIZE + TILE_SIZE / 2, w: TILE_SIZE, h: 3 * TILE_SIZE },
        };
      } else if (n.gy === cgy + 1) {
        const wallRow = (cgy + 1) * ROOM_H - 1;
        const nextRow = n.gy * ROOM_H;
        const cc = parent.centerCol;
        conn = {
          id: connId, parentRoomId: curId, childRoomId: nId,
          passXMin: (cc - 1) * TILE_SIZE,
          passXMax: (cc + 2) * TILE_SIZE,
          passYMin: wallRow * TILE_SIZE,
          passYMax: (nextRow + 1) * TILE_SIZE,
          barrierChild: { cx: cc * TILE_SIZE + TILE_SIZE / 2, cy: nextRow * TILE_SIZE + TILE_SIZE / 2, w: 3 * TILE_SIZE, h: TILE_SIZE },
          barrierParent: { cx: cc * TILE_SIZE + TILE_SIZE / 2, cy: wallRow * TILE_SIZE + TILE_SIZE / 2, w: 3 * TILE_SIZE, h: TILE_SIZE },
        };
      } else {
        const wallRow = cgy * ROOM_H;
        const nextRow = n.gy * ROOM_H + ROOM_H - 1;
        const cc = parent.centerCol;
        conn = {
          id: connId, parentRoomId: curId, childRoomId: nId,
          passXMin: (cc - 1) * TILE_SIZE,
          passXMax: (cc + 2) * TILE_SIZE,
          passYMin: nextRow * TILE_SIZE,
          passYMax: (wallRow + 1) * TILE_SIZE,
          barrierChild: { cx: cc * TILE_SIZE + TILE_SIZE / 2, cy: nextRow * TILE_SIZE + TILE_SIZE / 2, w: 3 * TILE_SIZE, h: TILE_SIZE },
          barrierParent: { cx: cc * TILE_SIZE + TILE_SIZE / 2, cy: wallRow * TILE_SIZE + TILE_SIZE / 2, w: 3 * TILE_SIZE, h: TILE_SIZE },
        };
      }

      connections.push(conn);
    }
  }

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
    ? nearestFreeTile(mapData, startRoom.centerCol, startRoom.centerRow, cols, rows)
    : { col: startRoom.centerCol, row: startRoom.centerRow };

  // ── 7. Color boss passageway tiles gold ──────────────────────────────────
  for (const conn of connections) {
    if (bossRoomId === null) break;
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

  // ── 8. Scatter trap tiles ────────────────────────────────────────────────
  // Last, so only tiles that survived as plain FLOOR are eligible — the stairs and
  // the gold boss passageway are already stamped and can't be overwritten. The
  // start room is skipped so a floor can never open with the party on top of one.
  for (const [id, room] of roomDataMap) {
    if (id === startId) continue;
    if (TRAP_AVOID_TYPES.includes(roomTypes.get(id)!)) continue;
    if (rng() * 100 >= TRAP_ROOM_CHANCE) continue;
    placeTrapInRoom(mapData, room, rng);
  }

  const playerSpawns = [0, 1, 2, 3].map(() => ({
    x: spawnTile.col * TILE_SIZE + TILE_SIZE / 2,
    y: spawnTile.row * TILE_SIZE + TILE_SIZE / 2,
  }));

  return {
    mapData,
    cols,
    rows,
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
