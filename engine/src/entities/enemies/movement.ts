// Reusable approach movements for casting enemies — the enemy analogue of
// bosses/movement.ts. Each is a PURE function of position + per-instance state,
// returning the heading (and, for the hop, the airHeight) to apply. The enemy holds
// the small state (orbitClock, hopClock) and applies the result through its own
// protected move()/setAirHeight() — the math is shared and unit-testable, the
// application stays on the creature. An enemy links to one of these in approach().

/** Weave-and-orbit: circle the target at a standoff ring while swaying side to side,
 *  so the creature closes in a spiral instead of a straight line (the eye-bat). */
export function spiralApproach(p: {
  orbitClock: number;
  spinDir: 1 | -1;
  targetDx: number;
  targetDy: number;
  /** Ring distance it steers toward: wide while regrouping, tight while hunting. */
  standoff: number;
  dtMs: number;
}): { dx: number; dy: number; orbitClock: number } {
  const orbitClock = p.orbitClock + p.dtMs;
  const dist = Math.hypot(p.targetDx, p.targetDy) || 1;
  const ux = p.targetDx / dist;
  const uy = p.targetDy / dist;

  // Radial: +1 inward, -1 outward. Steer toward the standoff ring, easing off as it
  // nears so it settles onto the ring instead of oscillating hard.
  const radial = Math.max(-1, Math.min(1, (dist - p.standoff) / 60));

  // Tangential weave: sin sweeps the orbit direction through zero and back, so the
  // creature visibly sways left-right rather than tracing a clean circle.
  const weave = Math.sin(orbitClock / 300) * p.spinDir;
  const tx = -uy * weave;
  const ty = ux * weave;

  return { dx: tx + ux * radial, dy: ty + uy * radial, orbitClock };
}

/** Discrete bounding: move for hopMs, then hold still for pauseMs, driving a visible
 *  jump arc (rise-and-fall airHeight) each hop so the creature bounds toward the
 *  target instead of gliding (the frog-flower). */
export function hopApproach(p: {
  hopClock: number;
  dtMs: number;
  hopMs: number;
  pauseMs: number;
  /** Visual arc peak (px) of each locomotion hop. */
  hopHeight: number;
}): { hopClock: number; moving: boolean; airHeight: number } {
  let hopClock = p.hopClock + p.dtMs;
  const cycle = p.hopMs + p.pauseMs;
  if (hopClock >= cycle) hopClock -= cycle;
  const moving = hopClock < p.hopMs;
  // 0 at the ends of the hop, peak at mid-hop; flat 0 during the pause.
  const airHeight = moving ? Math.sin(Math.PI * (hopClock / p.hopMs)) * p.hopHeight : 0;
  return { hopClock, moving, airHeight };
}
