/**
 * Mulberry32 seeded RNG — deterministic and portable: the same seed yields the
 * same stream on every platform and JS engine (integer ops + a single divide, no
 * transcendentals), so client and server — and, later, a P2P host and its guests —
 * always agree.
 *
 * This is the ONE seeded generator the codebase draws from. The dungeon generator
 * uses it so client and server build the same map from a seed; the simulation uses
 * it (via a floor-seeded stream) so a floor's loot / spawn / scatter rolls are
 * reproducible rather than pulled from ambient `Math.random`. That reproducibility
 * is the groundwork for rollback netcode, where the RNG stream must be
 * re-derivable from state, not read from the environment. Keep sim-side randomness
 * flowing through here — no `Math.random` in the tick path.
 */
export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [0, n). */
export function randInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

/** A uniformly random element of a non-empty array. */
export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** True with probability p (0..1). */
export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

/** In-place Fisher–Yates shuffle. Returns the same array for convenience. */
export function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}
