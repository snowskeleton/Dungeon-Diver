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
  projectile: 0xff33ff, // projectile hit ellipse (forward/side)
} as const;
