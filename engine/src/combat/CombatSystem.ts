import { Attack } from "shared";
import { HitSource } from "./HitSource";
import { OverlapSystem, OverlapArea, OverlapGroup } from "./OverlapSystem";

// A thing a HitSource can land on: an OverlapArea (position, hurt box, elevation,
// `present` flag) plus a takeHit receiver. Players and enemies implement this (Entity
// provides the defaults; `present` aliases `damageable`). Its map key is passed in
// separately so the resolver can do owner self-exclusion without the target knowing
// its own id.
export interface CombatTarget extends OverlapArea {
  /** Applies the hit; returns the damage actually dealt (see Entity.takeHit). */
  takeHit(attack: Attack): number;
}

// One group of candidate targets sharing a Layer (all players, all enemies). The
// group carries the layer so targets don't each store a copy, and the team check is
// one bit test per group.
export interface TargetGroup {
  layer: number;
  targets: Map<string, CombatTarget>;
}

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

// The single combat resolver. It is now one CONSUMER of the shared OverlapSystem
// (the Godot-Area-style sensor engine): every damage source in the game (melee
// swings, projectiles, contact, boss abilities) is a sensor, every target an area,
// and the overlap callback applies the Attack. There are no per-pair loops anywhere
// else — new content (boss AOE, cuttable props, hazard tiles) is a new source or a
// new TargetGroup, never a new loop. See docs/layers.md.
export class CombatSystem {
  private readonly overlap = new OverlapSystem();

  resolve(sources: HitSource[], groups: TargetGroup[]): HitEvent[] {
    const hits: HitEvent[] = [];
    // A HitSource is structurally an OverlapSensor (shape/affects/reaches/ownerId/
    // claim). A TargetGroup's `targets` are the group's `areas` (two groups per tick —
    // players and enemies — so this mapping is negligible).
    const areaGroups: OverlapGroup<CombatTarget>[] = groups.map((g) => ({
      layer: g.layer,
      areas: g.targets,
    }));
    for (const src of sources) {
      this.overlap.detect(src, areaGroups, (id, target, box) => {
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
    return hits;
  }
}
