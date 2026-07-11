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

// ─── Thrown (one-offs) ────────────────────────────────────────────────────────
import throwingKnife  from "./throwing-knife";
import throwingStar   from "./throwing-star";

// ─── Enemy projectiles (one-offs) ─────────────────────────────────────────────
import fireball       from "./fireball";
import magicOrb       from "./magic-orb";

// ─── Registry ─────────────────────────────────────────────────────────────────

const ALL_AMMO: Ammo[] = [
  arrow, steelArrow, piercingArrow, prismaticArrow, woodenArrow, fireArrow,
  throwingKnife, throwingStar, boomerang, steelBoomerang,
  fireball, magicOrb,
];

export const AMMO_REGISTRY: Record<string, Ammo> = Object.fromEntries(
  ALL_AMMO.map(a => [a.id, a]),
);

export type AmmoId =
  | "arrow" | "steel-arrow" | "piercing-arrow"
  | "prismatic-arrow" | "wooden-arrow" | "fire-arrow"
  | "throwing-knife" | "throwing-star" | "boomerang" | "steel-boomerang"
  | "fireball" | "magic-orb";

export { Ammo } from "./base";
export { Arrow } from "./arrows/base";
export { Boomerang } from "./boomerangs/base";
export type { AmmoConfig, AmmoOpts, AmmoOverride, AmmoCategory } from "./base";
