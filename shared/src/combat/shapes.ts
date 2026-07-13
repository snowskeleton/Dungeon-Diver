// Hit-region geometry, shared by every damage source (melee swings, projectiles,
// AOE bursts, ground hazards). A HitShape describes the region a hit COVERS this
// tick; `shapeHitsPoint` tests whether a target sits inside it.
//
// `pad` inflates the shape by a target's hurt radius, so a target is modeled as a
// circle rather than a bare point — the Godot "hitbox overlaps hurtbox" model.
// Pass pad=0 to recover exact point-in-shape behaviour.

export type HitShape =
  // Axis-aligned rectangle (top-left origin) — a melee swing arc.
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  // Filled circle — an AOE burst, a spin reach, an enemy's contact range.
  | { kind: "circle"; cx: number; cy: number; r: number }
  // A thick line segment [x0,y0 → x1,y1] with half-width `halfWidth` — an oriented
  // rectangle (rounded-free capsule) for beams, dash trails, and ground-crack
  // spokes. Length is the segment length; the region is everything within
  // halfWidth of the line, between the endpoints.
  | { kind: "segment"; x0: number; y0: number; x1: number; y1: number; halfWidth: number }
  // The segment [x0,y0 → x1,y1] a projectile swept this tick, thickened into an
  // ellipse aligned to travel: `forward` is the half-length at the caps, `side`
  // the half-width. (ux, uy) is the unit travel direction. Sweeping the whole
  // segment (not just the endpoint) stops a fast shot tunnelling past a target
  // sitting in the gap between ticks.
  | {
      kind: "sweptEllipse";
      x0: number; y0: number;
      x1: number; y1: number;
      ux: number; uy: number;
      forward: number; side: number;
    };

/** Does `shape`, inflated by `pad` (the target's hurt radius), contain (px, py)? */
export function shapeHitsPoint(shape: HitShape, px: number, py: number, pad = 0): boolean {
  switch (shape.kind) {
    case "rect":
      return (
        px >= shape.x - pad && px <= shape.x + shape.w + pad &&
        py >= shape.y - pad && py <= shape.y + shape.h + pad
      );
    case "circle": {
      const dx = px - shape.cx;
      const dy = py - shape.cy;
      const r = shape.r + pad;
      return dx * dx + dy * dy <= r * r;
    }
    case "segment": {
      const sx = shape.x1 - shape.x0;
      const sy = shape.y1 - shape.y0;
      const len = Math.hypot(sx, sy) || 1;
      const ux = sx / len;
      const uy = sy / len;
      const rx = px - shape.x0;
      const ry = py - shape.y0;
      const along = rx * ux + ry * uy; // distance down the segment from the start
      if (along < -pad || along > len + pad) return false;
      const perp = rx * -uy + ry * ux; // perpendicular offset from the line
      return Math.abs(perp) <= shape.halfWidth + pad;
    }
    case "sweptEllipse": {
      // Ported verbatim from the old Projectile.tryHit swept-ellipse test.
      const fwd = shape.forward + pad;
      const side = shape.side + pad;
      const { ux, uy } = shape;
      const segLen = (shape.x1 - shape.x0) * ux + (shape.y1 - shape.y0) * uy;
      const dx = px - shape.x0;
      const dy = py - shape.y0;
      const along = dx * ux + dy * uy; // distance down the flight line from the start
      const perp = dx * -uy + dy * ux; // perpendicular offset from the line
      const k = (perp * perp) / (side * side);
      if (k > 1) return false; // beyond the side radius — no ellipse can reach it
      // Nearest point of the swept centre-line to the target, then compare against
      // the ellipse's forward half-width there (the elliptical end caps).
      const gap = along < 0 ? -along : along > segLen ? along - segLen : 0;
      return gap <= fwd * Math.sqrt(1 - k);
    }
  }
}
