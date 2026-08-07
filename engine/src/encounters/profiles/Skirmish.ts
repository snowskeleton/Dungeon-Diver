import { EncounterContext, EncounterProfile, EnemyPick, PlacedSpawn } from "../EncounterProfile";
import { fillBudget } from "../compose";
import { atBack, placementPool, scatter } from "../placement";

/** The bread-and-butter fight: a line of melee with the odd ranged unit hanging
 *  back. The everyday combat room, so it's the baseline-weight profile everywhere
 *  rank-and-file spawn. */
export class Skirmish extends EncounterProfile {
  readonly id = "skirmish";
  readonly name = "Skirmish";

  weight(ctx: EncounterContext): number {
    switch (ctx.roomType) {
      case "combat":
      case "dark":
      case "maze":
        return 3;
      default:
        return 0;
    }
  }

  compose(ctx: EncounterContext, budget: number): EnemyPick[] {
    return fillBudget(ctx.rng, budget, [
      { role: "melee", weight: 4 },
      { role: "ranged", weight: 1 },
    ]);
  }

  place(ctx: EncounterContext, picks: EnemyPick[]): PlacedSpawn[] {
    const pool = placementPool(ctx.geometry);
    const ranged = picks.filter((p) => p.role === "ranged");
    const rest = picks.filter((p) => p.role !== "ranged");
    // Ranged units hang at the back; everyone else scatters across the room.
    const rangedSpots = atBack(pool, ranged.length, ctx.rng, ctx.geometry);
    const restSpots = scatter(pool, rest.length, ctx.rng);
    return [
      ...ranged.slice(0, rangedSpots.length).map((p, i) => ({ cls: p.cls, ...rangedSpots[i] })),
      ...rest.slice(0, restSpots.length).map((p, i) => ({ cls: p.cls, ...restSpots[i] })),
    ];
  }
}
