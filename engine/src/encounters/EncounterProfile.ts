import { RoomType, Rng } from "shared";
import { EnemyClass, EnemyRole } from "../entities/Enemy";
import { RoomGeometry, placementPool, scatter } from "./placement";

/** Everything a profile sees when it composes and places a group. Built per room by
 *  the SpawnDirector. `rng` is the floor's seeded sim stream, so a profile's draws
 *  are reproducible from the floor seed (determinism is the netcode contract). */
export interface EncounterContext {
  roomType: RoomType;
  floor: number;
  partySize: number;
  rng: Rng;
  geometry: RoomGeometry;
}

/** One requested enemy: the resolved class plus the role it was drawn for. `place`
 *  reads the role to sort units into a formation without re-instantiating. */
export type EnemyPick = { cls: EnemyClass; role: EnemyRole };

/** A composed enemy pinned to a world position, ready for SpawnDirector.addEnemy. */
export type PlacedSpawn = { cls: EnemyClass; x: number; y: number };

/** A reusable enemy-group recipe. The OO analogue of a REGULAR_ENEMIES entry: a
 *  class listed in ENCOUNTERS, its behavior in compiler-checked methods rather than
 *  a config blob. A room picks one profile, fills it to a threat budget, and places
 *  the result. Add a recipe by subclassing this and listing it — no table to sync. */
export abstract class EncounterProfile {
  abstract readonly id: string;
  abstract readonly name: string;

  /** Relative likelihood this profile is chosen for `ctx`'s room; 0 = never here.
   *  profileFor draws among all profiles with weight > 0, so returning a floor- or
   *  party-scaled number is how a recipe grows/shrinks over a run. */
  abstract weight(ctx: EncounterContext): number;

  /** Fill up to `budget` threat points with role requests (resolved to concrete
   *  classes via pickRole). May return fewer picks than the budget if it rounds
   *  down, but must never exceed it — the budget IS the room's difficulty dial. */
  abstract compose(ctx: EncounterContext, budget: number): EnemyPick[];

  /** Turn picks into world positions. Default is a plain scatter (the pre-profiles
   *  behavior); a profile overrides this to sort units into a formation. Always
   *  draws from geometry.candidates via the shared placement helpers, so results
   *  are guaranteed walkable and in-room. */
  place(ctx: EncounterContext, picks: EnemyPick[]): PlacedSpawn[] {
    const pool = placementPool(ctx.geometry);
    const spots = scatter(pool, picks.length, ctx.rng);
    return picks
      .slice(0, spots.length)
      .map((p, i) => ({ cls: p.cls, x: spots[i].x, y: spots[i].y }));
  }
}
