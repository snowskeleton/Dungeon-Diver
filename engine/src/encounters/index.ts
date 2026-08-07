import { EncounterContext, EncounterProfile } from "./EncounterProfile";
import { Skirmish } from "./profiles/Skirmish";
import { Swarm } from "./profiles/Swarm";
import { Ambush } from "./profiles/Ambush";
import { BrutePack } from "./profiles/BrutePack";

export { EncounterProfile } from "./EncounterProfile";
export type { EncounterContext, EnemyPick, PlacedSpawn } from "./EncounterProfile";
export type { RoomGeometry } from "./placement";
export { enemiesByRole, pickRole } from "./roles";

/** Every encounter recipe, in the OO spirit of REGULAR_ENEMIES / BOSSES / UPGRADES:
 *  a plain array of profile instances, behavior in their methods. Add a recipe by
 *  writing its class and listing it here — nothing else to wire. */
export const ENCOUNTERS: EncounterProfile[] = [
  new Skirmish(),
  new Swarm(),
  new Ambush(),
  new BrutePack(),
];

// Guaranteed fallback: Skirmish weights every rank-and-file room type > 0, so a
// room can never come up empty of profiles. Kept as a named constant so profileFor
// can lean on it without re-scanning.
const DEFAULT_PROFILE = ENCOUNTERS[0];

/** Pick a profile for a room, weighted by each profile's `weight(ctx)`. Draws from
 *  ctx.rng, so the choice is reproducible from the floor seed. Falls back to the
 *  default profile if — against the design — nothing is eligible. */
export function profileFor(ctx: EncounterContext): EncounterProfile {
  const eligible = ENCOUNTERS
    .map((p) => ({ p, w: p.weight(ctx) }))
    .filter((e) => e.w > 0);
  if (eligible.length === 0) return DEFAULT_PROFILE;
  const total = eligible.reduce((s, e) => s + e.w, 0);
  let r = ctx.rng() * total;
  for (const e of eligible) {
    r -= e.w;
    if (r < 0) return e.p;
  }
  return eligible[eligible.length - 1].p;
}
