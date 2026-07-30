import { ENTITY_RADIUS } from "shared";

// The one shared piece of "charge/dive" movement: reflecting a heading off a
// wall/arena boundary this step. HOW the movement is then applied differs by
// caster — a boss self-moves a STATIC body (setPosition), a rank-and-file enemy
// drives a DYNAMIC matter body (velocity) — so only the reflection lives here.
// Both Boss.dashStep and Enemy.dashStep call this, then apply the returned heading
// their own way. This is the abstraction the enemy-overhaul plan flagged: one
// definition, two consumers, no copy/paste.

/** Look-ahead distance so a mover turns just before its body would clamp on a wall. */
export const DASH_LOOKAHEAD = ENTITY_RADIUS + 8;

/** Reflect (dirX, dirY) off any boundary within `look` px ahead on each axis,
 *  returning the possibly-flipped heading and how many axes bounced. `isBoundaryAt`
 *  is the caller's own wall/arena test (sprite-centre coords). */
export function reflectHeading(
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  isBoundaryAt: (cx: number, cy: number) => boolean,
  look: number = DASH_LOOKAHEAD,
): { dirX: number; dirY: number; bounces: number } {
  let bounces = 0;
  if (dirX !== 0 && isBoundaryAt(x + dirX * look, y)) {
    dirX = -dirX;
    bounces++;
  }
  if (dirY !== 0 && isBoundaryAt(x, y + dirY * look)) {
    dirY = -dirY;
    bounces++;
  }
  return { dirX, dirY, bounces };
}
