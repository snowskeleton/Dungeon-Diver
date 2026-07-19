import { Attack, canAffect, shapeHitsPoint } from "shared";
import { HitSource } from "./HitSource";

// A thing a HitSource can land on: a body with a position, a hurt radius, a
// vulnerability flag, and a takeHit receiver. Players and enemies implement this
// (Entity provides the defaults). Its map key is passed in separately so the
// resolver can do owner self-exclusion without the target knowing its own id.
export interface CombatTarget {
  readonly state: { x: number; y: number };
  /** Radius the target occupies for hit tests — inflates the source shape. */
  readonly hurtRadius: number;
  /** False while dead/dying so a corpse takes no further hits. */
  readonly damageable: boolean;
  /** Applies the hit; returns the damage actually dealt (see Entity.takeHit). */
  takeHit(attack: Attack): number;
}

// One group of candidate targets sharing a Layer (all players, all enemies). The
// group carries the layer so targets don't each store a copy, and the resolver's
// team check is one bit test per group rather than per target.
export interface TargetGroup {
  layer: number;
  targets: Map<string, CombatTarget>;
}

// The single combat resolver. There are no per-pair loops anywhere else — every
// damage source in the game (melee swings, projectiles, contact, boss abilities)
// flows through here:
//
//   for each source × candidate target:
//     land the hit iff  source.affects reaches the target's layer
//                  AND  the shapes overlap
//                  AND  the target isn't the source's own owner
//                  AND  the source's dedupe policy claims it
//
// New content (boss AOE, cuttable props, hazard tiles) is a new source or a new
// TargetGroup — never a new loop. See docs/layers.md.
export class CombatSystem {
  resolve(sources: HitSource[], groups: TargetGroup[]): void {
    for (const src of sources) {
      for (const group of groups) {
        if (!canAffect(src.affects, group.layer)) continue;
        group.targets.forEach((target, id) => {
          if (!target.damageable) return;
          if (src.ownerId === id) return;
          if (!shapeHitsPoint(src.shape, target.state.x, target.state.y, target.hurtRadius)) return;
          if (!src.claim(id)) return;
          const dealt = target.takeHit(src.attack);
          src.onDealt?.(id, dealt);
        });
      }
    }
  }
}
