// The payload one hit delivers to whatever it lands on — the game's analogue of
// the Godot reference's `Attack` value object (damage + knockback_force +
// attack_position). It is pure data: it says how much to hurt and where the blow
// came from, and knows nothing about layers, teams, or dedupe (those live on the
// HitSource that carries it). The receiver (`Entity.takeHit`) derives the
// knockback DIRECTION from (target − source), so a single Attack shoves every
// target away from the blow's origin correctly.
export interface Attack {
  /** HP removed from the target. */
  damage: number;
  /** Knockback force (same units as weapon.attackForce / ammo.knockback). The
   *  receiver turns this into a push away from (sourceX, sourceY); 0 = no shove. */
  knockback: number;
  /** World-space origin of the blow — the point the target is pushed away from. */
  sourceX: number;
  sourceY: number;
}
