import { Rng, pick } from "shared";
import { EnemyClass, EnemyRole } from "../entities/Enemy";
import { REGULAR_ENEMIES } from "../entities/enemies";

// The ONE role→class resolver. Encounter profiles request enemies by role; this
// bucket is DERIVED from REGULAR_ENEMIES (never a hand-kept table), so declaring a
// new enemy's `static readonly role` slots it into every recipe automatically.
// Bosses/summons are absent from REGULAR_ENEMIES, so they can never leak in here.
export const enemiesByRole: Record<EnemyRole, EnemyClass[]> = {
  melee: [],
  ranged: [],
  swarm: [],
  brute: [],
};
for (const cls of REGULAR_ENEMIES) enemiesByRole[cls.role].push(cls);

/** A random enemy class of the given role, or null if no rank-and-file enemy fills
 *  that role yet. Profiles MUST tolerate null and fall back (e.g. an ambush with no
 *  ranged unit available downgrades those slots to melee). */
export function pickRole(rng: Rng, role: EnemyRole): EnemyClass | null {
  const bucket = enemiesByRole[role];
  return bucket.length > 0 ? pick(rng, bucket) : null;
}
