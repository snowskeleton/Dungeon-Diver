import { Ammo } from "./base";

// ─── Arrows ───────────────────────────────────────────────────────────────────
import arrow          from "./arrows/arrow";
import steelArrow     from "./arrows/steel-arrow";
import piercingArrow  from "./arrows/piercing-arrow";
import prismaticArrow from "./arrows/prismatic-arrow";
import woodenArrow    from "./arrows/wooden-arrow";
import fireArrow      from "./arrows/fire-arrow";

// ─── Boomerangs ───────────────────────────────────────────────────────────────
import boomerang      from "./boomerangs/boomerang";
import steelBoomerang from "./boomerangs/steel-boomerang";

// ─── Bolts (the Mage's staff projectiles, one element per staff) ──────────────
import magicBolt      from "./bolts/magic-bolt";
import arcaneBolt     from "./bolts/arcane-bolt";
import flameBolt      from "./bolts/flame-bolt";
import verdantBolt    from "./bolts/verdant-bolt";
import frostBolt      from "./bolts/frost-bolt";

// ─── Thrown (one-offs) ────────────────────────────────────────────────────────
import throwingKnife  from "./throwing-knife";
import throwingStar   from "./throwing-star";

// ─── Enemy projectiles (one-offs) ─────────────────────────────────────────────
import fireball       from "./fireball";
import magicOrb       from "./magic-orb";
import rockShard      from "./rock-shard";
import boulder        from "./boulder";

// ─── Registry ─────────────────────────────────────────────────────────────────

const ALL_AMMO: Ammo[] = [
  arrow, steelArrow, piercingArrow, prismaticArrow, woodenArrow, fireArrow,
  magicBolt, arcaneBolt, flameBolt, verdantBolt, frostBolt,
  throwingKnife, throwingStar, boomerang, steelBoomerang,
  fireball, magicOrb, rockShard, boulder,
];

export const AMMO_REGISTRY: Record<string, Ammo> = Object.fromEntries(
  ALL_AMMO.map(a => [a.id, a]),
);

export type AmmoId =
  | "arrow" | "steel-arrow" | "piercing-arrow"
  | "prismatic-arrow" | "wooden-arrow" | "fire-arrow"
  | "magic-bolt" | "arcane-bolt" | "flame-bolt" | "verdant-bolt" | "frost-bolt"
  | "throwing-knife" | "throwing-star" | "boomerang" | "steel-boomerang"
  | "fireball" | "magic-orb" | "rock-shard" | "boulder";

export { Ammo } from "./base";
export { Arrow } from "./arrows/base";
export { Boomerang } from "./boomerangs/base";
export { Bolt } from "./bolts/base";
export type { AmmoConfig, AmmoOpts, AmmoOverride, AmmoCategory } from "./base";
