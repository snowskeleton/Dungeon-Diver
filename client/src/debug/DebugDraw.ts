// Shared vocabulary for the hit/hurtbox debug overlay (toggled with H — see
// HitboxDebug.ts). Each drawable entity contributes its own shapes so the
// overlay stays generic and the geometry lives next to the code that knows it.
// This module holds only plain data + the interface, so entities can import it
// without depending on the overlay itself (avoids an import cycle).

export type DebugShape =
  // Axis-aligned circle. `fill` (0–1) shades the interior; omit for outline only.
  | { kind: "circle"; x: number; y: number; r: number; color: number; fill?: number }
  // Ellipse rotated by `angle` radians — rx runs along the angle, ry across it.
  | { kind: "ellipse"; x: number; y: number; rx: number; ry: number; angle: number; color: number; fill?: number }
  // Axis-aligned rectangle at (x, y) with size (w, h).
  | { kind: "rect"; x: number; y: number; w: number; h: number; color: number; fill?: number };

export interface DebugDrawable {
  /** Shapes to render for this entity when the debug overlay is on. */
  collectDebugShapes(): DebugShape[];
}

// One palette so every entity type is visually distinguishable at a glance.
export const DEBUG_COLORS = {
  playerBody: 0x33ccff, // player collision circle (at the feet)
  melee: 0xff3333, // weapon swing hurtbox (filled while actively attacking)
  enemyBody: 0x33ff66, // enemy collision circle (at the feet)
  enemyAttack: 0xffaa00, // enemy attack radius (center-to-center)
  enemyAggro: 0xffff66, // enemy aggro radius (center-to-center)
  hurt: 0xffffff, // damageable region — the DRAWN sprite's extent, centred on the
  //                  sprite. Deliberately NOT the collision circle below it: what
  //                  an entity walks with and what it can be hit on are separate.
  projectile: 0xff33ff, // projectile hit ellipse (forward/side)
} as const;

/** Outline of a measured hurt box (shared/enemies/hurtBounds.generated.ts) around
 *  a sprite centre. The overlay draws exactly the region the server hit-tests, so
 *  art and hitbox disagreeing is visible rather than only felt. */
export function hurtBoxShape(
  b: { halfW: number; halfH: number; offsetX: number; offsetY: number },
  cx: number,
  cy: number,
): DebugShape {
  return {
    kind: "rect",
    x: cx + b.offsetX - b.halfW,
    y: cy + b.offsetY - b.halfH,
    w: b.halfW * 2,
    h: b.halfH * 2,
    color: DEBUG_COLORS.hurt,
  };
}
