import { EncounterContext, EncounterProfile, EnemyPick, PlacedSpawn } from "../EncounterProfile";
import { fillBudget } from "../compose";
import { atBack, nearDoorways, placementPool, scatter } from "../placement";

/** A prepared position: ranged and brutes waiting at the back while melee screen
 *  the doorway, so the party walks into fire. Grows more likely deeper in the run,
 *  where the party can handle (and expects) a nastier setup. */
export class Ambush extends EncounterProfile {
  readonly id = "ambush";
  readonly name = "Ambush";

  weight(ctx: EncounterContext): number {
    if (ctx.roomType !== "combat" && ctx.roomType !== "dark") return 0;
    // Rare on floor 1, common by the double digits.
    return 1 + Math.min(3, Math.floor(ctx.floor / 3));
  }

  compose(ctx: EncounterContext, budget: number): EnemyPick[] {
    return fillBudget(ctx.rng, budget, [
      { role: "ranged", weight: 3 },
      { role: "brute", weight: 2 },
      { role: "melee", weight: 2 },
    ]);
  }

  place(ctx: EncounterContext, picks: EnemyPick[]): PlacedSpawn[] {
    const pool = placementPool(ctx.geometry);
    const back = picks.filter((p) => p.role === "ranged" || p.role === "brute");
    const front = picks.filter((p) => p.role === "melee");
    const backSpots = atBack(pool, back.length, ctx.rng, ctx.geometry);
    // Melee blockers screen the entrance; if there are no doorways (single-room
    // floor) nearDoorways degenerates to a scatter, which is fine.
    const frontSpots = ctx.geometry.doorwayAnchors.length > 0
      ? nearDoorways(pool, front.length, ctx.rng, ctx.geometry)
      : scatter(pool, front.length, ctx.rng);
    return [
      ...back.slice(0, backSpots.length).map((p, i) => ({ cls: p.cls, ...backSpots[i] })),
      ...front.slice(0, frontSpots.length).map((p, i) => ({ cls: p.cls, ...frontSpots[i] })),
    ];
  }
}
