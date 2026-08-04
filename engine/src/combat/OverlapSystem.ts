import {
  HitShape,
  HurtBounds,
  HurtBox,
  shapeHitsBox,
  canAffect,
  reachesElevation,
  ELEVATION_ALL,
} from "shared";

// The reusable overlap engine — the Godot "Area" idea generalised: a SENSOR (a shape
// on a layer mask) scans for AREAS (boxes on layers), and every eligible overlap fires
// a typed callback carrying both parties. The consequence lives in the callback, so
// one broadphase + one predicate chain serves many consumers:
//
//   - combat (CombatSystem): sensor = a HitSource, area = a CombatTarget, the
//     callback applies the Attack;
//   - pickups / hazard tiles / interact triggers: their own sensors and areas, the
//     callback runs their effect.
//
// This is exactly the predicate chain the combat resolver used to inline. Detection is
// pure geometry (deterministic, safe to run on a P2P guest for cosmetic prediction);
// the CONSEQUENCE in the callback is where authority matters — damage/RNG stay
// host-only (see docs/layers.md and the P2P plan).

/** A shape that scans for overlapping areas. Combat's `HitSource` is one
 *  implementation (it adds `attack`/`onDealt`); a pickup radius is another. */
export interface OverlapSensor {
  shape: HitShape;
  /** Layer mask this sensor scans for — tested with `canAffect` against area layers. */
  affects: number;
  /** Elevation bands it reaches (GROUND / AIR / both). Undefined = both. */
  reaches?: number;
  /** Self key, excluded from its own overlaps (a swing can't hit its owner). */
  ownerId?: string;
  /** Per-area gate: dedupe (combat's RehitGate) or one-shot (a pickup). Returning
   *  false skips this overlap without consuming it. */
  claim(areaId: string): boolean;
}

/** A detectable area: a box (measured from art) on a layer, present or not. */
export interface OverlapArea {
  readonly state: { x: number; y: number };
  readonly hurtBounds: HurtBounds;
  /** The Elevation band it occupies; a sensor only reaches matching bands. */
  readonly elevation: number;
  /** Eligible to be detected right now — false for a corpse / a claimed pickup. */
  readonly present: boolean;
}

/** A group of candidate areas sharing a Layer, so the team check is one bit test
 *  per group rather than per area. */
export interface OverlapGroup<A extends OverlapArea> {
  layer: number;
  areas: Map<string, A>;
}

/** The box an area is tested on: its art-measured hurt bounds, offset from the
 *  sprite centre. Extracted so a consumer that wants the box (an FX position) reads
 *  it the same way the resolver does. */
export function areaBox(area: OverlapArea): HurtBox {
  const hb = area.hurtBounds;
  return {
    cx: area.state.x + hb.offsetX,
    cy: area.state.y + hb.offsetY,
    halfW: hb.halfW,
    halfH: hb.halfH,
  };
}

export class OverlapSystem {
  /**
   * Run one sensor against every candidate group, firing `onOverlap` for each area
   * the sensor is eligible to affect and whose box its shape overlaps. The predicate
   * order (layer → present → owner → elevation → shape → claim) is exactly what the
   * combat resolver enforced.
   */
  detect<A extends OverlapArea>(
    sensor: OverlapSensor,
    groups: OverlapGroup<A>[],
    onOverlap: (areaId: string, area: A, box: HurtBox) => void,
  ): void {
    const reaches = sensor.reaches ?? ELEVATION_ALL;
    for (const group of groups) {
      if (!canAffect(sensor.affects, group.layer)) continue;
      group.areas.forEach((area, id) => {
        if (!area.present) return;
        if (sensor.ownerId === id) return;
        if (!reachesElevation(reaches, area.elevation)) return;
        const box = areaBox(area);
        if (!shapeHitsBox(sensor.shape, box)) return;
        if (!sensor.claim(id)) return;
        onOverlap(id, area, box);
      });
    }
  }
}
