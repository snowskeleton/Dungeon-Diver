import { Upgrade } from "./Upgrade";

// The first upgrade set: plain stat boosts. Each is a class overriding only the
// getters it affects — see Upgrade for why this isn't a config table.
//
// Design intent: flat boosts are strong early and fade, percent boosts are weak
// early and compound, so the two feel different at the moment of the pick rather
// than being reskins of one another. Nothing here is floor-gated yet except the
// percent tiers, which are dead weight on floor 1.
//
// Magnitudes are deliberately SMALL (27 July playtest): a buff drops every room,
// so a run stacks a dozen-plus of these. The knob we turned is frequency, not
// size — three of a buff should read as "meaningfully stronger," not "doubled."
// Keep new upgrades in this same modest range.

export class IronSkin extends Upgrade {
  readonly id = "iron-skin";
  readonly name = "Iron Skin";
  readonly description = "Ignore 1 damage from every hit.";
  override get armorFlat() { return 1; }
}

export class Toughness extends Upgrade {
  readonly id = "toughness";
  readonly name = "Toughness";
  readonly description = "+8 max health, and heal for it now.";
  override get maxHpFlat() { return 8; }
}

export class Vitality extends Upgrade {
  readonly id = "vitality";
  readonly name = "Vitality";
  readonly description = "+8% max health.";
  override get maxHpPct() { return 0.08; }
  override get minFloor() { return 2; }
}

export class SwiftBoots extends Upgrade {
  readonly id = "swift-boots";
  readonly name = "Swift Boots";
  readonly description = "+6% movement speed.";
  override get speedPct() { return 0.06; }
}

export class KeenEdge extends Upgrade {
  readonly id = "keen-edge";
  readonly name = "Keen Edge";
  readonly description = "+1 damage on every attack.";
  override get damageFlat() { return 1; }
}

export class Ferocity extends Upgrade {
  readonly id = "ferocity";
  readonly name = "Ferocity";
  readonly description = "+6% damage.";
  override get damagePct() { return 0.06; }
  override get minFloor() { return 2; }
}

export class Bloodthirst extends Upgrade {
  readonly id = "bloodthirst";
  readonly name = "Bloodthirst";
  readonly description = "Heal for 4% of the damage you deal.";
  override get lifestealPct() { return 0.04; }
  override get minFloor() { return 2; }
}

/** A glass-cannon pick: real upside, real cost. Kept honest by the armor floor —
 *  a hit always removes at least 1 HP, so this can't be stacked into immunity. */
export class Berserk extends Upgrade {
  readonly id = "berserk";
  readonly name = "Berserk";
  readonly description = "+12% damage, but -6% max health.";
  override get damagePct() { return 0.12; }
  override get maxHpPct() { return -0.06; }
  override get minFloor() { return 3; }
}
