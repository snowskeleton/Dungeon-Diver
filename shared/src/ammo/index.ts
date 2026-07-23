import { Ammo, AmmoClass } from "./base";

// ─── Arrows ───────────────────────────────────────────────────────────────────
import { Arrow }          from "./arrows/arrow";
import { SteelArrow }     from "./arrows/steel-arrow";
import { PiercingArrow }  from "./arrows/piercing-arrow";
import { PrismaticArrow } from "./arrows/prismatic-arrow";
import { WoodenArrow }    from "./arrows/wooden-arrow";
import { FireArrow }      from "./arrows/fire-arrow";

// ─── Boomerangs ───────────────────────────────────────────────────────────────
import { Boomerang }      from "./boomerangs/boomerang";
import { SteelBoomerang } from "./boomerangs/steel-boomerang";

// ─── Bolts (the Mage's staff projectiles, one element per staff) ──────────────
import { MagicBolt }      from "./bolts/magic-bolt";
import { ArcaneBolt }     from "./bolts/arcane-bolt";
import { FlameBolt }      from "./bolts/flame-bolt";
import { VerdantBolt }    from "./bolts/verdant-bolt";
import { FrostBolt }      from "./bolts/frost-bolt";

// ─── Thrown (one-offs) ────────────────────────────────────────────────────────
import { ThrowingKnife }  from "./throwing-knife";
import { ThrowingStar }   from "./throwing-star";

// ─── Enemy projectiles (one-offs) ─────────────────────────────────────────────
import { Fireball }       from "./fireball";
import { MagicOrb }       from "./magic-orb";
import { RockShard }      from "./rock-shard";
import { Boulder }        from "./boulder";

// ─── Registry ─────────────────────────────────────────────────────────────────

// Every ammo, as a class. Mirrors WEAPONS / REGULAR_ENEMIES: the array of classes
// is the source of truth the compiler checks, and AMMO_REGISTRY below is the
// id→instance lookup derived from it (ammo, like weapons, is referenced by id
// across the wire, so the map is a genuine need).
export const AMMO_CLASSES: AmmoClass[] = [
  Arrow, SteelArrow, PiercingArrow, PrismaticArrow, WoodenArrow, FireArrow,
  MagicBolt, ArcaneBolt, FlameBolt, VerdantBolt, FrostBolt,
  ThrowingKnife, ThrowingStar, Boomerang, SteelBoomerang,
  Fireball, MagicOrb, RockShard, Boulder,
];

export const AMMO_REGISTRY: Record<string, Ammo> = Object.fromEntries(
  AMMO_CLASSES.map((A) => { const a = new A(); return [a.id, a]; }),
);

export type ArrowId      = "arrow" | "steel-arrow" | "piercing-arrow" | "prismatic-arrow" | "wooden-arrow" | "fire-arrow";
export type BoltId       = "magic-bolt" | "arcane-bolt" | "flame-bolt" | "verdant-bolt" | "frost-bolt";
export type BoomerangId  = "boomerang" | "steel-boomerang";
export type ThrownAmmoId = "throwing-knife" | "throwing-star";
export type EnemyAmmoId  = "fireball" | "magic-orb" | "rock-shard" | "boulder";

export type AmmoId = ArrowId | BoltId | BoomerangId | ThrownAmmoId | EnemyAmmoId;

export { Ammo } from "./base";
export type { AmmoClass } from "./base";
export { Arrow } from "./arrows/base";
export { Boomerang } from "./boomerangs/base";
export { Bolt } from "./bolts/base";
export type { AmmoConfig, AmmoCategory } from "./base";
