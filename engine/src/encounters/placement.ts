import { Rng, shuffle } from "shared";

/** Everything a placement strategy needs to know about a room, built once per room
 *  by the SpawnDirector (see roomGeometry). All positions a strategy returns are
 *  drawn from `candidates`, so a placed enemy is always on a walkable interior tile
 *  — never in a wall, on a doorway, or outside the room. */
export interface RoomGeometry {
  /** Walkable interior tile centers (pixel coords), doorway ring excluded. */
  candidates: { x: number; y: number }[];
  /** Room center in pixel coords. */
  center: { x: number; y: number };
  /** Passageway midpoints for every doorway touching this room. Empty for a
   *  single-room floor with no connections. */
  doorwayAnchors: { x: number; y: number }[];
}

type Pos = { x: number; y: number };

const dist2 = (a: Pos, b: Pos) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Distance² from a point to the NEAREST doorway anchor (∞ if a room has none, so
 *  "back" and "front" collapse to an arbitrary-but-deterministic scatter). */
function nearestDoorDist2(p: Pos, geo: RoomGeometry): number {
  if (geo.doorwayAnchors.length === 0) return Infinity;
  let best = Infinity;
  for (const d of geo.doorwayAnchors) best = Math.min(best, dist2(p, d));
  return best;
}

/** Take up to `n` candidates, sorted by `score` (ascending), consuming them so a
 *  later strategy in the same room doesn't reuse a tile. Ties broken by a shuffled
 *  pass first, keeping placement varied yet rng-deterministic. */
function takeSorted(
  pool: Pos[], n: number, rng: Rng, score: (p: Pos) => number,
): Pos[] {
  shuffle(rng, pool);
  pool.sort((a, b) => score(a) - score(b));
  return pool.splice(0, Math.min(n, pool.length));
}

/** A fresh, mutable copy of the candidate pool — strategies splice from this so
 *  multiple strategies over one room never collide on a tile. */
export function placementPool(geo: RoomGeometry): Pos[] {
  return geo.candidates.slice();
}

/** Random scatter — the default, matching the pre-profiles behavior. */
export function scatter(pool: Pos[], n: number, rng: Rng): Pos[] {
  return takeSorted(pool, n, rng, () => 0);
}

/** The `n` tiles nearest a center point (jittered by picking among the closest),
 *  so a group reads as one clump rather than a line. */
export function cluster(
  pool: Pos[], n: number, rng: Rng, around: Pos,
): Pos[] {
  return takeSorted(pool, n, rng, (p) => dist2(p, around));
}

/** The `n` tiles FARTHEST from any doorway — ranged units hang back here. */
export function atBack(pool: Pos[], n: number, rng: Rng, geo: RoomGeometry): Pos[] {
  return takeSorted(pool, n, rng, (p) => -nearestDoorDist2(p, geo));
}

/** The `n` tiles CLOSEST to a doorway — melee blockers screen the entrance. */
export function nearDoorways(
  pool: Pos[], n: number, rng: Rng, geo: RoomGeometry,
): Pos[] {
  return takeSorted(pool, n, rng, (p) => nearestDoorDist2(p, geo));
}
