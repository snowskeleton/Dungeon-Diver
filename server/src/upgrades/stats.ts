import { Upgrade } from "./Upgrade";

// The first upgrade set: plain stat boosts. Each is a class overriding only the
// getters it affects — see Upgrade for why this isn't a config table.
//
// Design intent: flat boosts are strong early and fade, percent boosts are weak
// early and compound, so the two feel different at the moment of the pick rather
// than being reskins of one another. Nothing here is floor-gated yet except the
// percent tiers, which are dead weight on floor 1.

export class IronSkin extends Upgrade {
  readonly id = "iron-skin";
  readonly name = "Iron Skin";
  readonly description = "Ignore 2 damage from every hit.";
  override get armorFlat() { return 2; }
}

export class Toughness extends Upgrade {
  readonly id = "toughness";
  readonly name = "Toughness";
  readonly description = "+20 max health, and heal for it now.";
  override get maxHpFlat() { return 20; }
}

export class Vitality extends Upgrade {
  readonly id = "vitality";
  readonly name = "Vitality";
  readonly description = "+25% max health.";
  override get maxHpPct() { return 0.25; }
  override get minFloor() { return 2; }
}

export class SwiftBoots extends Upgrade {
  readonly id = "swift-boots";
  readonly name = "Swift Boots";
  readonly description = "+15% movement speed.";
  override get speedPct() { return 0.15; }
}

export class KeenEdge extends Upgrade {
  readonly id = "keen-edge";
  readonly name = "Keen Edge";
  readonly description = "+3 damage on every attack.";
  override get damageFlat() { return 3; }
}

export class Ferocity extends Upgrade {
  readonly id = "ferocity";
  readonly name = "Ferocity";
  readonly description = "+20% damage.";
  override get damagePct() { return 0.2; }
  override get minFloor() { return 2; }
}

export class Bloodthirst extends Upgrade {
  readonly id = "bloodthirst";
  readonly name = "Bloodthirst";
  readonly description = "Heal for 10% of the damage you deal.";
  override get lifestealPct() { return 0.1; }
  override get minFloor() { return 2; }
}

/** A glass-cannon pick: real upside, real cost. Kept honest by the armor floor —
 *  a hit always removes at least 1 HP, so this can't be stacked into immunity. */
export class Berserk extends Upgrade {
  readonly id = "berserk";
  readonly name = "Berserk";
  readonly description = "+40% damage, but -15% max health.";
  override get damagePct() { return 0.4; }
  override get maxHpPct() { return -0.15; }
  override get minFloor() { return 3; }
}
