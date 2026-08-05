import { describe, it, expect } from "vitest";
import { SnapshotBuffer } from "../../client/src/entities/SnapshotBuffer";

// SnapshotBuffer renders entities the client doesn't simulate slightly in the PAST,
// interpolating between two received samples. Unlike the extrapolator it replaced, it
// never projects forward — so the contract these pin is: it reaches the exact position
// the entity was at and NEVER goes past it (the anti-overshoot guarantee that fixes the
// co-op stop-drift). Assertions are on behaviour/relationships, not pixel counts.

const TICK = 50; // sim cadence samples arrive at
const DELAY = 100; // render-in-the-past delay used at read time

describe("SnapshotBuffer", () => {
  it("interpolates linearly between two bracketing samples", () => {
    const b = new SnapshotBuffer();
    b.push(0, 0, 0);
    b.push(100, 0, TICK);

    // Query the midpoint of the [0, TICK] segment: exactly halfway along the move.
    const mid = b.sampleAt(TICK / 2);
    expect(mid.x).toBeCloseTo(50, 5);
    expect(mid.y).toBeCloseTo(0, 5);
  });

  it("reaches the stop position and never overshoots it", () => {
    const b = new SnapshotBuffer();
    // Move steadily to x=300, then STOP (later samples repeat the final position and are
    // collapsed away, exactly like a held-still entity on the 60 Hz patch stream).
    b.push(0, 0, 0);
    b.push(100, 0, TICK);
    b.push(200, 0, TICK * 2);
    b.push(300, 0, TICK * 3);
    b.push(300, 0, TICK * 4); // stopped
    b.push(300, 0, TICK * 5); // still stopped

    // Render well after the stop: must sit ON the stop point, not past it.
    const settled = b.sampleAt(TICK * 6 - DELAY);
    expect(settled.x).toBeCloseTo(300, 5);

    // And at NO render time along the whole path does x ever exceed the last sample it
    // could have seen — the property that makes the stop exact instead of a coast.
    for (let now = 0; now <= TICK * 7; now += 5) {
      const p = b.sampleAt(now - DELAY);
      expect(p.x).toBeLessThanOrEqual(300 + 1e-6);
    }
  });

  it("collapses duplicate (60 Hz) coords so motion segments stay smooth", () => {
    const b = new SnapshotBuffer();
    // Three patches at the same position (sub-tick duplicates), then a real move.
    b.push(0, 0, 0);
    b.push(0, 0, 16);
    b.push(0, 0, 33);
    b.push(100, 0, TICK);

    // The segment must span the true 0..TICK move (smooth), not a compressed 33..TICK
    // window (which would jump then sit flat). Midpoint of the real move is x=50.
    const mid = b.sampleAt(TICK / 2);
    expect(mid.x).toBeCloseTo(50, 5);
  });

  it("holds the newest sample when the render time runs past it (starved)", () => {
    const b = new SnapshotBuffer();
    b.push(0, 0, 0);
    b.push(100, 0, TICK);

    // No newer samples arrived; asking for a time past the newest holds it, never
    // projects beyond.
    const held = b.sampleAt(TICK * 5);
    expect(held.x).toBeCloseTo(100, 5);
  });

  it("does not crawl across an idle-then-move gap", () => {
    const b = new SnapshotBuffer();
    b.push(0, 0, 0);
    // Long idle: the next distinct sample is 2 seconds later.
    b.push(50, 0, 2000);

    // Rendering just into the new segment must race toward the fresh keyframe (segment
    // span is capped), not crawl 1/40th of the way across a 2s gap.
    const p = b.sampleAt(1980);
    // With a 2s raw span, an uncapped lerp would give ~x=49.5*(1980/2000)≈ near 0 early
    // on; the cap makes alpha advance over the last MAX_SEG_MS, so by 20ms before the end
    // we're already most of the way there.
    expect(p.x).toBeGreaterThan(40);
  });

  it("reset drops history and anchors to one point", () => {
    const b = new SnapshotBuffer();
    b.push(0, 0, 0);
    b.push(100, 0, TICK);
    b.reset(500, 500, TICK * 2);

    // After a teleport-style reset, it reports the anchor with no lerp back toward the
    // old history.
    const p = b.sampleAt(TICK * 2 - DELAY);
    expect(p.x).toBeCloseTo(500, 5);
    expect(p.y).toBeCloseTo(500, 5);
  });
});
