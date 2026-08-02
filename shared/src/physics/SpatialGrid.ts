/**
 * Uniform-grid spatial hash for broadphase — "what is near this box?".
 *
 * Items are bucketed into fixed-size cells by their AABB; a query returns the
 * candidate items whose cells overlap a query box, so the O(n·m) all-pairs scan
 * collapses to near-neighbours only. Used by the collision resolver (circle vs
 * static geometry) and, from Phase 2, by the sensor/overlap system — one broadphase,
 * two consumers, so render/hit-test and movement can't diverge on "what's adjacent".
 *
 * Pure data + integer math (no transcendentals), so it is deterministic and portable.
 */
export class SpatialGrid<T> {
  private readonly cells = new Map<number, T[]>();
  private readonly inv: number;

  constructor(private readonly cellSize: number) {
    this.inv = 1 / cellSize;
  }

  /** Injective cell key for the bounded coordinate ranges we use (map + a small
   *  margin). 0x8000 offset keeps the negative world-edge cells non-negative; the
   *  0x10000 stride is comfortably wider than any map. */
  private key(cx: number, cy: number): number {
    return (cx + 0x8000) * 0x10000 + (cy + 0x8000);
  }

  clear(): void {
    this.cells.clear();
  }

  /** Bucket `item` into every cell its AABB touches. */
  insert(item: T, minX: number, minY: number, maxX: number, maxY: number): void {
    const c0 = Math.floor(minX * this.inv);
    const c1 = Math.floor(maxX * this.inv);
    const r0 = Math.floor(minY * this.inv);
    const r1 = Math.floor(maxY * this.inv);
    for (let cx = c0; cx <= c1; cx++) {
      for (let cy = r0; cy <= r1; cy++) {
        const k = this.key(cx, cy);
        const bucket = this.cells.get(k);
        if (bucket) bucket.push(item);
        else this.cells.set(k, [item]);
      }
    }
  }

  /** Call `visit` once for each distinct item whose cells overlap the query box.
   *  De-duplicated via `seen`, since an item spanning several cells appears in each. */
  query(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    visit: (item: T) => void,
  ): void {
    const c0 = Math.floor(minX * this.inv);
    const c1 = Math.floor(maxX * this.inv);
    const r0 = Math.floor(minY * this.inv);
    const r1 = Math.floor(maxY * this.inv);
    const seen = new Set<T>();
    for (let cx = c0; cx <= c1; cx++) {
      for (let cy = r0; cy <= r1; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const item of bucket) {
          if (seen.has(item)) continue;
          seen.add(item);
          visit(item);
        }
      }
    }
  }
}
