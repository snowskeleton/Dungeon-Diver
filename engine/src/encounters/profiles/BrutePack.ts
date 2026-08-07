import { EncounterContext, EncounterProfile, EnemyPick, PlacedSpawn } from "../EncounterProfile";
import { fillBudget } from "../compose";
import { pickRole } from "../roles";
import { cluster, placementPool } from "../placement";

/** An anchor brute with a melee escort — a slower, heavier fight than a skirmish.
 *  Guarantees at least one brute (falling back to melee only if the floor has no
 *  brute yet), then spends the rest of the budget on melee support, all clustered
 *  so they advance as a knot. */
export class BrutePack extends EncounterProfile {
  readonly id = "brute-pack";
  readonly name = "Brute Pack";

  weight(ctx: EncounterContext): number {
    switch (ctx.roomType) {
      case "combat":
      case "maze":
        return 2;
      default:
        return 0;
    }
  }

  compose(ctx: EncounterContext, budget: number): EnemyPick[] {
    // The anchor: a brute if one exists, else a melee stand-in so the pack still
    // fields something. Its threat comes off the top before the escort fills in.
    const anchor = pickRole(ctx.rng, "brute") ?? pickRole(ctx.rng, "melee");
    if (!anchor) return [];
    const rest = fillBudget(ctx.rng, budget - anchor.threat, [
      { role: "melee", weight: 1 },
    ]);
    return [{ cls: anchor, role: anchor.role }, ...rest];
  }

  place(ctx: EncounterContext, picks: EnemyPick[]): PlacedSpawn[] {
    const pool = placementPool(ctx.geometry);
    const spots = cluster(pool, picks.length, ctx.rng, ctx.geometry.center);
    return picks.slice(0, spots.length).map((p, i) => ({ cls: p.cls, ...spots[i] }));
  }
}
