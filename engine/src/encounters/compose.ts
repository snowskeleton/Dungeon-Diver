import { Rng } from "shared";
import { EnemyRole } from "../entities/Enemy";
import { EnemyPick } from "./EncounterProfile";
import { pickRole } from "./roles";

/** A role and its draw weight. fillBudget picks among these each iteration. */
export type RoleWeight = { role: EnemyRole; weight: number };

/** Weighted choice of a role from a non-empty list (weights need not sum to 1). */
function chooseRole(rng: Rng, weights: RoleWeight[]): EnemyRole {
  const total = weights.reduce((s, w) => s + w.weight, 0);
  let r = rng() * total;
  for (const w of weights) {
    r -= w.weight;
    if (r < 0) return w.role;
  }
  return weights[weights.length - 1].role;
}

/** Spend `budget` threat points buying enemies, drawing a role each step by
 *  `weights` and resolving it to a concrete class. Falls back to melee when a role
 *  has no enemy (pickRole → null) or when the drawn class is too costly for the
 *  remaining budget, so the pool always fills up to the budget with cheap units.
 *  Never overspends: a pick is only taken if its threat fits what's left. */
export function fillBudget(
  rng: Rng, budget: number, weights: RoleWeight[],
): EnemyPick[] {
  const picks: EnemyPick[] = [];
  let remaining = budget;
  // Bound the loop independently of what gets bought: even all-threat-1 units
  // can't exceed `budget` iterations, and misses (null role, too costly) are
  // capped by the same slack so a role with no members can't spin forever.
  let guard = budget * 2 + 8;
  while (remaining >= 1 && guard-- > 0) {
    const role = chooseRole(rng, weights);
    // Requested role, else a melee filler — the one role guaranteed populated.
    const cls = pickRole(rng, role) ?? pickRole(rng, "melee");
    if (!cls) break; // no enemies at all (only possible in a stripped test pool)
    if (cls.threat > remaining) {
      // Too expensive for the change left. Try to top off with a cheap melee unit
      // before giving up, so a budget of 1 left still fills instead of stranding.
      const filler = pickRole(rng, "melee");
      if (filler && filler.threat <= remaining) {
        picks.push({ cls: filler, role: filler.role });
        remaining -= filler.threat;
      } else {
        break;
      }
      continue;
    }
    picks.push({ cls, role: cls.role });
    remaining -= cls.threat;
  }
  return picks;
}
