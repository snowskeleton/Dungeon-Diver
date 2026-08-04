import { describe, it, expect } from "vitest";
import { Extrapolator } from "../../client/src/entities/Extrapolator";

// The Extrapolator is the guest's "good enough" motion for entities it doesn't
// simulate (enemies, remote players): project the last authoritative sample forward
// by its measured velocity so it renders where it IS, not a sim-tick-plus-round-trip
// behind. These assert the CONTRACT (leads in the direction of travel, stays bounded,
// re-anchors on every sample), never specific pixel counts.

const TICK = 50; // sim cadence the samples arrive at

describe("Extrapolator", () => {
  it("projects ahead in the direction of travel between samples", () => {
    const e = new Extrapolator();
    e.sample(0, 0, 0);
    e.sample(100, 0, TICK); // moving +x at 2 px/ms

    // Mid-way to the next expected sample, it should lead PAST the last sample toward
    // where the entity is heading — not sit on the stale point a plain lerp would.
    const mid = e.target(TICK + TICK / 2);
    expect(mid.x).toBeGreaterThan(100);
    expect(mid.y).toBeCloseTo(0);
  });

  it("never leads further than maxLeadMs (a dropped update can't fling it away)", () => {
    const maxLead = 120;
    const e = new Extrapolator(maxLead);
    e.sample(0, 0, 0);
    e.sample(100, 0, TICK); // 2 px/ms

    // No further samples for a long time (a stall). Lead is capped, so the projection
    // stops at last + v*maxLead and holds — it does not run off to infinity.
    const capped = 100 + 2 * maxLead;
    const wayLater = e.target(TICK + 10_000);
    expect(wayLater.x).toBeCloseTo(capped);
  });

  it("decays the heading when the entity stops (same position resampled)", () => {
    const e = new Extrapolator();
    e.sample(0, 0, 0);
    e.sample(100, 0, TICK);
    const leadWhileMoving = e.target(TICK + TICK / 2).x - 100;
    // Park at the same spot for several ticks — velocity bleeds off each time, so the
    // stale eastward lead shrinks toward zero and the view settles on the true spot.
    for (let i = 2; i <= 7; i++) e.sample(100, 0, TICK * i);
    const leadWhenStopped = e.target(TICK * 7 + TICK / 2).x - 100;
    expect(leadWhenStopped).toBeLessThan(leadWhileMoving * 0.1);
    expect(leadWhenStopped).toBeLessThan(2);
  });

  it("ignores duplicate sub-tick patches so an HP-only hit can't corrupt velocity", () => {
    const e = new Extrapolator();
    e.sample(0, 0, 0);
    e.sample(100, 0, TICK); // establishes +x velocity
    // An HP patch lands 2ms later at the SAME position — must not zero the heading.
    e.sample(100, 0, TICK + 2);
    const mid = e.target(TICK + TICK / 2);
    expect(mid.x).toBeGreaterThan(100);
  });

  it("reset hard-anchors with no inferred velocity (teleport / floor change)", () => {
    const e = new Extrapolator();
    e.sample(0, 0, 0);
    e.sample(100, 0, TICK); // moving fast
    e.reset(500, 500, TICK); // blinked elsewhere
    const t = e.target(TICK + 1000);
    expect(t.x).toBeCloseTo(500);
    expect(t.y).toBeCloseTo(500);
  });
});
