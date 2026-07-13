// Per-TARGET re-hit dedupe for a single persistent hit region (a spin, a beam, a
// ground-crack) — NOT an ability's recast cooldown (that lives on the Spell). A
// lingering hitbox overlaps a target every tick (20×/s); this gate says "hit this
// specific target once, then not again for `cooldownMs`", tracked independently
// per target. One gate belongs to one active effect and is owned by that effect
// (a spell's effect closure), so there is no central registry — each effect keeps
// its own gate and resets it when it re-activates.
//
// Pass `cooldownMs: Infinity` for "hit each target at most once for the whole
// activation" (a single spin that must not double-dip). It is exactly the dedupe
// policy a HitSource plugs into its `claim`.
export class RehitGate {
  private until = new Map<string, number>(); // targetId → ms remaining before re-hit

  constructor(private readonly cooldownMs: number) {}

  /** Advance all per-target cooldowns by dtMs; call once per active tick. */
  tick(dtMs: number): void {
    for (const [id, ms] of this.until) {
      const next = ms - dtMs;
      if (next <= 0) this.until.delete(id);
      else this.until.set(id, next);
    }
  }

  /** True if this target may be hit now (and starts its per-target cooldown);
   *  false if still cooling down. Wire it straight into a HitSource's `claim`. */
  claim(targetId: string): boolean {
    if ((this.until.get(targetId) ?? 0) > 0) return false;
    this.until.set(targetId, this.cooldownMs);
    return true;
  }

  /** Forget every target's cooldown — call from an effect's activate() so each
   *  cast starts fresh. */
  reset(): void {
    this.until.clear();
  }
}
