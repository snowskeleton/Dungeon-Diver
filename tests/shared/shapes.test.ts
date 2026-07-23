import { describe, it, expect } from "vitest";
import { shapeHitsPoint, shapeHitsBox, HitShape } from "shared";

// Geometry is the substrate every hit in the game is decided on, so it is tested
// as pure math with hand-checked numbers rather than through a swing.

const rect: HitShape = { kind: "rect", x: 100, y: 100, w: 40, h: 20 };
const circle: HitShape = { kind: "circle", cx: 100, cy: 100, r: 10 };
const segment: HitShape = { kind: "segment", x0: 0, y0: 0, x1: 100, y1: 0, halfWidth: 5 };
const swept: HitShape = {
  kind: "sweptEllipse",
  x0: 0, y0: 0,
  x1: 100, y1: 0,
  ux: 1, uy: 0,
  forward: 10, side: 4,
};

const box = (cx: number, cy: number, halfW = 1, halfH = 1) => ({ cx, cy, halfW, halfH });

describe("shapeHitsPoint", () => {
  describe("rect", () => {
    it("contains interior points and excludes exterior ones", () => {
      expect(shapeHitsPoint(rect, 120, 110)).toBe(true);
      expect(shapeHitsPoint(rect, 99, 110)).toBe(false);
      expect(shapeHitsPoint(rect, 141, 110)).toBe(false);
      expect(shapeHitsPoint(rect, 120, 99)).toBe(false);
      expect(shapeHitsPoint(rect, 120, 121)).toBe(false);
    });

    it("includes its own edges", () => {
      expect(shapeHitsPoint(rect, 100, 100)).toBe(true);
      expect(shapeHitsPoint(rect, 140, 120)).toBe(true);
    });

    it("grows by exactly pad on every side", () => {
      expect(shapeHitsPoint(rect, 95, 110)).toBe(false);
      expect(shapeHitsPoint(rect, 95, 110, 5)).toBe(true);
      expect(shapeHitsPoint(rect, 94, 110, 5)).toBe(false);
    });
  });

  describe("circle", () => {
    it("is exact at the radius", () => {
      expect(shapeHitsPoint(circle, 110, 100)).toBe(true);   // exactly r away
      expect(shapeHitsPoint(circle, 110.01, 100)).toBe(false);
      expect(shapeHitsPoint(circle, 107, 107)).toBe(true);   // dist ≈ 9.90 — just inside
      expect(shapeHitsPoint(circle, 108, 108)).toBe(false);  // dist ≈ 11.3 — just outside
    });

    it("adds pad to the radius rather than to the box", () => {
      // (106, 108) is 10 away — exactly on the rim of a 10-radius circle.
      expect(shapeHitsPoint(circle, 106, 108)).toBe(true);
      expect(shapeHitsPoint(circle, 112, 116)).toBe(false); // 20 away
      expect(shapeHitsPoint(circle, 112, 116, 10)).toBe(true);
    });
  });

  describe("segment", () => {
    it("covers the band within halfWidth between the endpoints", () => {
      expect(shapeHitsPoint(segment, 50, 0)).toBe(true);
      expect(shapeHitsPoint(segment, 50, 5)).toBe(true);
      expect(shapeHitsPoint(segment, 50, -5)).toBe(true);
      expect(shapeHitsPoint(segment, 50, 6)).toBe(false);
    });

    it("stops at the endpoints (it is a segment, not a line)", () => {
      expect(shapeHitsPoint(segment, -1, 0)).toBe(false);
      expect(shapeHitsPoint(segment, 101, 0)).toBe(false);
      expect(shapeHitsPoint(segment, 100, 0)).toBe(true);
    });

    it("works at an angle, not just axis-aligned", () => {
      const diag: HitShape = { kind: "segment", x0: 0, y0: 0, x1: 100, y1: 100, halfWidth: 5 };
      expect(shapeHitsPoint(diag, 50, 50)).toBe(true);
      expect(shapeHitsPoint(diag, 50, 60)).toBe(false); // perpendicular offset ≈ 7.07
      expect(shapeHitsPoint(diag, 50, 56)).toBe(true);  // ≈ 4.24
    });
  });

  describe("sweptEllipse", () => {
    it("covers the swept corridor at its side half-width", () => {
      expect(shapeHitsPoint(swept, 50, 0)).toBe(true);
      expect(shapeHitsPoint(swept, 50, 4)).toBe(true);
      expect(shapeHitsPoint(swept, 50, 4.5)).toBe(false);
    });

    it("caps the ends with an ellipse, not a flat edge", () => {
      // Dead ahead of the tip: the full forward half-length reaches.
      expect(shapeHitsPoint(swept, 110, 0)).toBe(true);
      expect(shapeHitsPoint(swept, 110.5, 0)).toBe(false);
      // Off-axis at the cap, the reach shrinks — that is what makes it elliptical
      // rather than a rectangle: at |perp| = side/2 the forward reach is 10·√(3)/2.
      expect(shapeHitsPoint(swept, 100 + 8.6, 2)).toBe(true);
      expect(shapeHitsPoint(swept, 100 + 8.7, 2)).toBe(false);
    });

    it("catches a target sitting between two ticks' positions (no tunnelling)", () => {
      // A fast shot that jumped 0 → 100 in one tick still hits the target at 50.
      expect(shapeHitsPoint(swept, 50, 1)).toBe(true);
    });
  });
});

describe("shapeHitsBox", () => {
  it("tests rect against box as an exact AABB overlap", () => {
    expect(shapeHitsBox(rect, box(90, 110, 10, 2))).toBe(true);  // just touching x=100
    expect(shapeHitsBox(rect, box(89, 110, 10, 2))).toBe(false);
    expect(shapeHitsBox(rect, box(120, 90, 2, 10))).toBe(true);  // just touching y=100
    expect(shapeHitsBox(rect, box(120, 89, 2, 10))).toBe(false);
  });

  it("tests circle against box exactly, via the box's closest point", () => {
    // Corner case in the literal sense: the nearest corner is √2·7 ≈ 9.9 away.
    expect(shapeHitsBox(circle, box(114, 114, 7, 7))).toBe(true);
    expect(shapeHitsBox(circle, box(115, 115, 7, 7))).toBe(false);
    // Face-on it only needs the half-extent plus the radius.
    expect(shapeHitsBox(circle, box(120, 100, 10, 10))).toBe(true);
    expect(shapeHitsBox(circle, box(121, 100, 10, 10))).toBe(false);
  });

  it("is what makes non-square art hittable on its wide axis", () => {
    // A 30×15 creature (the spider's shape): a swing level with its middle
    // connects at ±15 horizontally but only ±7.5 vertically. A single radius
    // could not express both.
    const wide = box(200, 200, 15, 7.5);
    const swing = (x: number, y: number): HitShape => ({ kind: "rect", x, y, w: 2, h: 2 });
    expect(shapeHitsBox(swing(214, 200), wide)).toBe(true);
    expect(shapeHitsBox(swing(216, 200), wide)).toBe(false);
    expect(shapeHitsBox(swing(200, 206), wide)).toBe(true);
    expect(shapeHitsBox(swing(200, 209), wide)).toBe(false);
  });

  it("approximates segment/sweptEllipse with the circumradius, erring inclusive", () => {
    // Documented approximation: the box is treated as its bounding circle, so a
    // corner-adjacent miss reads as a hit. Pinning it means a future exact
    // implementation is a deliberate change, not a silent one.
    // This box spans y 6..12; the segment's band is y −5..5, so an exact test
    // would MISS. The circumradius (≈4.24) pads the band to 9.24 and it reads as
    // a hit — the inclusive error, pinned here on purpose.
    expect(shapeHitsBox(segment, box(50, 9, 3, 3))).toBe(true);
    // Far enough out that even the padded test lets go.
    expect(shapeHitsBox(segment, box(50, 10, 3, 3))).toBe(false);
    expect(shapeHitsBox(swept, box(50, 0, 1, 1))).toBe(true);
  });

  it("never reports a hit for a box entirely outside the shape", () => {
    expect(shapeHitsBox(rect, box(500, 500, 10, 10))).toBe(false);
    expect(shapeHitsBox(circle, box(500, 500, 10, 10))).toBe(false);
    expect(shapeHitsBox(segment, box(500, 500, 10, 10))).toBe(false);
    expect(shapeHitsBox(swept, box(500, 500, 10, 10))).toBe(false);
  });

  it("is never TIGHTER than the padded point test it replaced", () => {
    // The stated contract for the approximation. Sample the neighbourhood of a
    // shape and assert box-coverage is a superset of point-with-circumradius.
    const b = { halfW: 6, halfH: 3 };
    const pad = Math.hypot(b.halfW, b.halfH);
    for (const shape of [rect, circle, segment, swept]) {
      for (let x = -20; x <= 160; x += 7) {
        for (let y = -40; y <= 140; y += 7) {
          if (shapeHitsPoint(shape, x, y, 0)) {
            expect(shapeHitsBox(shape, { cx: x, cy: y, ...b })).toBe(true);
          }
          // And the box test never exceeds the circumradius-padded point test.
          if (shapeHitsBox(shape, { cx: x, cy: y, ...b })) {
            expect(shapeHitsPoint(shape, x, y, pad)).toBe(true);
          }
        }
      }
    }
  });
});
