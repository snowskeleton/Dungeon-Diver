import { Ammo, AmmoClass } from "./base";

// ─── Arrows ───────────────────────────────────────────────────────────────────
import { Arrow } from "./arrows/arrow";

// ─── Bolts (the Mage's staff projectile) ──────────────────────────────────────
import { MagicBolt } from "./bolts/magic-bolt";

// ─── Thrown (one-offs) ────────────────────────────────────────────────────────
import { ThrowingStar } from "./throwing-star";

// ─── Enemy projectiles (one-offs) ─────────────────────────────────────────────
import { Fireball }       from "./fireball";
import { MagicOrb }       from "./magic-orb";
import { RockShard }      from "./rock-shard";
import { Boulder }        from "./boulder";
import { HexBolt }        from "./hex-bolt";

// ─── Registry ─────────────────────────────────────────────────────────────────

// Every ammo, as a class. Mirrors WEAPONS / REGULAR_ENEMIES: the array of classes
// is the source of truth the compiler checks, and AMMO_REGISTRY below is the
// id→instance lookup derived from it (ammo, like weapons, is referenced by id
// across the wire, so the map is a genuine need).
export const AMMO_CLASSES: AmmoClass[] = [
  Arrow,
  MagicBolt,
  ThrowingStar,
  Fireball, MagicOrb, RockShard, Boulder, HexBolt,
];

// The id→instance lookup. Like WEAPON_REGISTRY, it is the network-boundary
// resolver for the one place an ammo id crosses the wire (ProjectileState.ammoId):
// the string must become an Ammo object on the client. Built FROM the class array
// (every key is a class's `id: AmmoId`), so look ammo up ONLY through `resolveAmmo`.
export const AMMO_REGISTRY: Record<AmmoId, Ammo> = Object.fromEntries(
  AMMO_CLASSES.map((A) => { const a = new A(); return [a.id, a]; }),
) as Record<AmmoId, Ammo>;

/** Resolve an ammo instance from a wire (or otherwise untrusted) id string. The one
 *  seam where a `string` becomes an `Ammo`; undefined for an unknown id. */
export function resolveAmmo(id: string): Ammo | undefined {
  return (AMMO_REGISTRY as Record<string, Ammo | undefined>)[id];
}

export type ArrowId      = "arrow";
export type BoltId       = "magic-bolt";
export type ThrownAmmoId = "throwing-star";
export type EnemyAmmoId  = "fireball" | "magic-orb" | "rock-shard" | "boulder" | "hex-bolt";

export type AmmoId = ArrowId | BoltId | ThrownAmmoId | EnemyAmmoId;

export { Ammo } from "./base";
export type { AmmoClass } from "./base";
export { Arrow } from "./arrows/base";
export { Bolt } from "./bolts/base";
export type { AmmoConfig, AmmoCategory } from "./base";
