// Elevation bands — the "levels of damage" axis layered on top of the flat 2D
// combat model. A body occupies GROUND or AIR based on its airHeight, and a hit
// source declares which band(s) it can REACH. The resolver lands a hit only when
// the source reaches the target's band (see CombatSystem), so a leaping Ranger
// (AIR) sails over a ground slam, fire, and a grounded enemy's touch — while a
// flying enemy, whose contact reaches BOTH bands, still catches them mid-air.
//
// This is deliberately a two-value band, not a continuous height: hit resolution
// stays a single bitmask test (like Layer), and "am I above the floor" is the
// only distinction the game needs today. Height itself remains the visual/feel
// value (airHeight); this is just which band that height falls into.

export enum Elevation {
  GROUND = 1 << 0, // 0x01  on (or near) the floor — the default for everything
  AIR    = 1 << 1, // 0x02  airborne: a vaulting player, a cruising/flying enemy
}

/** Both bands — the reach of anything that hits high and low alike (player
 *  attacks, a flyer's contact, a projectile in flight). The permissive default,
 *  so leaving `reaches` unset preserves the old height-agnostic behaviour. */
export const ELEVATION_ALL = Elevation.GROUND | Elevation.AIR;

/** Above this airHeight (px) a body is AIR rather than GROUND. Chosen below a
 *  Vault's arc peak and a flyer's cruise height, above the noise at the start/end
 *  of a leap — so the airborne window is most of the arc, not a knife-edge. */
export const AIRBORNE_HEIGHT_THRESHOLD = 12;

/** The band a body at `airHeight` occupies. */
export function elevationAt(airHeight: number): number {
  return airHeight > AIRBORNE_HEIGHT_THRESHOLD ? Elevation.AIR : Elevation.GROUND;
}

/** Does a source that reaches `sourceReaches` bands connect with a target in
 *  `targetElevation`? Mirrors canAffect for the Layer axis. */
export function reachesElevation(sourceReaches: number, targetElevation: number): boolean {
  return (sourceReaches & targetElevation) !== 0;
}
