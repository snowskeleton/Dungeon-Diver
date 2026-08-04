import { describe, it, expect } from "vitest";
import { Layer, HitShape, Elevation, ELEVATION_ALL } from "shared";
import {
  OverlapSystem,
  OverlapSensor,
  OverlapArea,
  OverlapGroup,
} from "../../engine/src/combat/OverlapSystem";

// The OverlapSystem is the reusable Godot-Area engine that CombatSystem is now just
// one consumer of. These tests exercise it with a NON-combat sensor (a pickup radius
// that collects ids) to prove the generalisation: the same layer/present/owner/
// elevation/shape/claim predicate chain, with any consequence in the callback.

class Area implements OverlapArea {
  present = true;
  elevation = Elevation.GROUND;
  constructor(
    public state: { x: number; y: number },
    public hurtBounds = { halfW: 8, halfH: 8, offsetX: 0, offsetY: 0 },
  ) {}
}

/** A circle sensor that scans `affects`, claiming each area at most once (a pickup). */
function pickupSensor(affects: number, claimed: Set<string>, opts: Partial<OverlapSensor> = {}): OverlapSensor {
  return {
    shape: { kind: "circle", cx: 0, cy: 0, r: 40 } as HitShape,
    affects,
    reaches: ELEVATION_ALL,
    claim: (id) => (claimed.has(id) ? false : (claimed.add(id), true)),
    ...opts,
  };
}

function group(layer: number, entries: Record<string, Area>): OverlapGroup<Area> {
  return { layer, areas: new Map(Object.entries(entries)) };
}

describe("OverlapSystem, used as a non-combat pickup", () => {
  const sys = new OverlapSystem();

  it("fires the callback for each overlapping area on an affected layer, carrying both parties", () => {
    const near = new Area({ x: 10, y: 0 });
    const far = new Area({ x: 500, y: 0 });
    const hit: Array<{ id: string; area: Area }> = [];
    sys.detect(pickupSensor(Layer.PICKUP, new Set()), [group(Layer.PICKUP, { a: near, b: far })],
      (id, area) => hit.push({ id, area }));
    expect(hit).toHaveLength(1);
    expect(hit[0]).toEqual({ id: "a", area: near });
  });

  it("ignores a layer the sensor does not scan for", () => {
    const a = new Area({ x: 0, y: 0 });
    const hit: string[] = [];
    sys.detect(pickupSensor(Layer.PICKUP, new Set()), [group(Layer.ENEMY, { a })], (id) => hit.push(id));
    expect(hit).toHaveLength(0);
  });

  it("skips areas that are not present, and the sensor's own owner", () => {
    const gone = new Area({ x: 0, y: 0 });
    gone.present = false;
    const self = new Area({ x: 0, y: 0 });
    const hit: string[] = [];
    const sensor = pickupSensor(Layer.PICKUP, new Set(), { ownerId: "me" });
    sys.detect(sensor, [group(Layer.PICKUP, { gone, me: self })], (id) => hit.push(id));
    expect(hit).toHaveLength(0);
  });

  it("respects the claim gate — a once-only pickup is collected exactly once across ticks", () => {
    const a = new Area({ x: 0, y: 0 });
    const claimed = new Set<string>();
    const sensor = pickupSensor(Layer.PICKUP, claimed);
    const g = [group(Layer.PICKUP, { a })];
    let count = 0;
    sys.detect(sensor, g, () => count++);
    sys.detect(sensor, g, () => count++); // second tick, same claim set
    expect(count).toBe(1);
  });

  it("respects the elevation gate", () => {
    const flyer = new Area({ x: 0, y: 0 });
    flyer.elevation = Elevation.AIR;
    const hit: string[] = [];
    const groundOnly = pickupSensor(Layer.PICKUP, new Set(), { reaches: Elevation.GROUND });
    sys.detect(groundOnly, [group(Layer.PICKUP, { flyer })], (id) => hit.push(id));
    expect(hit).toHaveLength(0);
  });
});
