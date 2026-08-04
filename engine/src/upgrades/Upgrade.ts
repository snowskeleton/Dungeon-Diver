import { UpgradeId } from "shared";
import { Spell } from "../spells";

// A run-scoped boon a player picks up. Upgrades are BEHAVIOURAL content, so they
// follow the same rules as enemies and bosses (see the engineering note in
// CLAUDE.md): one class per upgrade, stats as compiler-checked getters, collected
// in a plain array. There is no UPGRADE_REGISTRY and no id→effect table.
//
// Every contribution defaults to zero, so a subclass overrides only the one or two
// getters it actually cares about and a typo'd override is a compile error rather
// than a silently-ignored config key. Percent values are fractions: 0.1 = +10%.

/**
 * Anything that contributes to a player's folded stats. Upgrades implement it
 * today; worn equipment will implement the same interface and join the same fold,
 * which is why Player folds over a list of these rather than over `upgrades`
 * directly.
 */
export interface StatContributor {
  readonly maxHpFlat: number;
  readonly maxHpPct: number;
  readonly speedFlat: number;
  readonly speedPct: number;
  readonly damageFlat: number;
  readonly damagePct: number;
  readonly armorFlat: number;
  readonly armorPct: number;
  readonly lifestealPct: number;
}

export abstract class Upgrade implements StatContributor {
  abstract readonly id: UpgradeId;
  abstract readonly name: string;
  /** One line shown on the offer card and in the pause menu. */
  abstract readonly description: string;

  /** Earliest floor this may be offered on — scaling without a lookup table. */
  get minFloor(): number { return 1; }

  get maxHpFlat(): number { return 0; }
  get maxHpPct(): number { return 0; }
  get speedFlat(): number { return 0; }
  get speedPct(): number { return 0; }
  get damageFlat(): number { return 0; }
  get damagePct(): number { return 0; }
  /** Flat damage subtracted from every incoming hit. */
  get armorFlat(): number { return 0; }
  /** Fraction of incoming damage ignored, applied before armorFlat. */
  get armorPct(): number { return 0; }
  /** Fraction of damage dealt returned as healing. */
  get lifestealPct(): number { return 0; }

  /**
   * An active ability this upgrade grants. Null = a passive stat upgrade, which is
   * everything today. The hook exists because active abilities are planned to live
   * in this same list rather than a parallel one — Player already skips nulls when
   * assembling its castable spells, so turning one on is a subclass override and
   * nothing else.
   */
  spell(): Spell | null { return null; }
}

/** A concrete upgrade class: `new`-able with no arguments, so the offer roller can
 *  hold direct class references in an array the compiler checks — mirroring
 *  REGULAR_ENEMIES / BOSSES, and again avoiding any id→class map. */
export type UpgradeClass = { new (): Upgrade };
