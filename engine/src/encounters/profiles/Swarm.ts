import { EncounterContext, EncounterProfile, EnemyPick, PlacedSpawn } from "../EncounterProfile";
import { fillBudget } from "../compose";
import { cluster, placementPool } from "../placement";

/** A press of cheap, fast bodies. Because swarm units are low-threat, the same
 *  budget buys far more of them than any other profile — the room reads as a mob.
 *  They clump so the player is enveloped rather than picked at one at a time. */
export class Swarm extends EncounterProfile {
  readonly id = "swarm";
  readonly name = "Swarm";

  weight(ctx: EncounterContext): number {
    // Only in open combat rooms — a maze's tight corridors would bottleneck a mob
    // into a single-file line and defeat the point.
    return ctx.roomType === "combat" || ctx.roomType === "dark" ? 2 : 0;
  }

  compose(ctx: EncounterContext, budget: number): EnemyPick[] {
    return fillBudget(ctx.rng, budget, [
      { role: "swarm", weight: 5 },
      { role: "melee", weight: 1 },
    ]);
  }

  place(ctx: EncounterContext, picks: EnemyPick[]): PlacedSpawn[] {
    // One clump around a point offset from center, so the mob has a "front".
    const pool = placementPool(ctx.geometry);
    const { center } = ctx.geometry;
    const jitter = 96;
    const around = {
      x: center.x + (ctx.rng() - 0.5) * jitter,
      y: center.y + (ctx.rng() - 0.5) * jitter,
    };
    const spots = cluster(pool, picks.length, ctx.rng, around);
    return picks.slice(0, spots.length).map((p, i) => ({ cls: p.cls, ...spots[i] }));
  }
}
