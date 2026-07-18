import { Attack, HitShape } from "shared";

// A live source of damage this tick — a melee swing, a projectile, an AOE burst,
// a ground hazard. Everything that can hurt something emits one (or more) of
// these each tick it is active; the CombatSystem resolver applies them uniformly.
//
// This is the "hitbox" half of the Godot hitbox→hurtbox model: the source owns
// its region (`shape`), which team it may reach (`affects`, a Layer mask), the
// payload it delivers (`attack`), and — crucially — its own DEDUPE policy
// (`claim`). Keeping dedupe on the source is what lets a swing hit each enemy
// once per swing, a projectile hit once-per-target-until-pierce-runs-out, and an
// AOE tick hit once per cooldown, all through the same resolver.
export interface HitSource {
  /** The region covered this tick. */
  shape: HitShape;
  /** Which Layer(s) this source's hits may reach (directional — see canAffect). */
  affects: number;
  /** Owner key (player session id / enemy id) so a shot never hits its own
   *  caster. Optional: a swing that can't reach its own team needs no exclusion. */
  ownerId?: string;
  /** The payload delivered to each target that is hit. */
  attack: Attack;
  /** Called after geometry + team + owner checks pass, once per candidate target.
   *  Returns true to actually land the hit (and records/consumes whatever dedupe
   *  state the source keeps); false to skip — already hit, on cooldown, or spent. */
  claim(targetId: string): boolean;
  /** Called after a hit actually lands, with the damage the target really took
   *  (post-mitigation, post-overkill). The return channel for anything that keys
   *  off damage dealt rather than damage attempted — lifesteal today. */
  onDealt?(targetId: string, damage: number): void;
}
