import { Attack, canAffect, shapeHitsBox, HurtBounds } from "shared";
import { HitSource } from "./HitSource";

// A thing a HitSource can land on: a body with a position, a hurt radius, a
// vulnerability flag, and a takeHit receiver. Players and enemies implement this
// (Entity provides the defaults). Its map key is passed in separately so the
// resolver can do owner self-exclusion without the target knowing its own id.
export interface CombatTarget {
  readonly state: { x: number; y: number };
  /** The box this target can be damaged on — its DRAWN sprite's extent, measured
   *  from the art (shared/enemies/hurtBounds.generated.ts), offset from the
   *  sprite centre. Deliberately unrelated to the physics body it walks with. */
  readonly hurtBounds: HurtBounds;
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

// One landed hit, reported back to the caller. This is the resolver's only output:
// it already knows every (source, target) pair that connected, so impact feedback —
// the hit-spark FX today, screen shake or hitstop tomorrow — reads this rather than
// re-deriving contacts somewhere else. Position is the target's center, which is
// where the impact reads on screen regardless of the source's shape.
export interface HitEvent {
  x: number;
  y: number;
  targetId: string;
  /** The source's owner key, so the caller can tell a player's hit from an enemy's. */
  ownerId?: string;
  /** Damage actually dealt (post-mitigation) — 0 for a fully-absorbed hit. */
  damage: number;
}

export class CombatSystem {
  resolve(sources: HitSource[], groups: TargetGroup[]): HitEvent[] {
    const hits: HitEvent[] = [];
    for (const src of sources) {
      for (const group of groups) {
        if (!canAffect(src.affects, group.layer)) continue;
        group.targets.forEach((target, id) => {
          if (!target.damageable) return;
          if (src.ownerId === id) return;
          const hb = target.hurtBounds;
          const box = {
            cx: target.state.x + hb.offsetX,
            cy: target.state.y + hb.offsetY,
            halfW: hb.halfW,
            halfH: hb.halfH,
          };
          if (!shapeHitsBox(src.shape, box)) return;
          if (!src.claim(id)) return;
          const dealt = target.takeHit(src.attack);
          src.onDealt?.(id, dealt);
          hits.push({
            x: box.cx,
            y: box.cy,
            targetId: id,
            ownerId: src.ownerId,
            damage: dealt,
          });
        });
      }
    }
    return hits;
  }
}
