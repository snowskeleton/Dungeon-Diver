import { WeaponClass } from "../base";
import { Sword } from "../swords/base";
import { Axe } from "../axes/base";
import { Mace } from "../maces/base";
import { Spear } from "../spears/base";
import { Staff } from "../staves/base";

// ─── Enemy armaments ────────────────────────────────────────────────────────
//
// The weapons enemies swing, kept OUT of the player catalog (WEAPONS). They're
// still ordinary `Weapon` subclasses on the same category bases, so they SHARE
// THE ART — the same `fxType` (and therefore the same FX-derived hurtbox) and,
// via an `iconPath` override, the same icon PNG as a player weapon. What they do
// NOT share is catalog membership: because they're listed in ENEMY_WEAPONS rather
// than WEAPONS, `partyRollableWeaponIds` can never roll them as loot, and their
// damage/force are authored here for enemy balance rather than borrowed from a
// player weapon whose numbers exist to feel good in a player's hand.
//
// They still land in WEAPON_REGISTRY (which is derived from BOTH lists) so the
// server's weaponSpell lookup and the client's held-weapon visual both resolve an
// enemy weapon by id exactly like a player one. Timing (wind-up telegraph + recast
// cadence) is the enemy's, applied on top by ArmedEnemy's retimedSpell — the
// weapon here only supplies the hitbox, damage, and projectile.
//
// These live in a single file (not one dir per weapon like the catalog) because
// they carry no art of their own: each reuses an existing icon, so there's no
// matching sprite directory to mirror.

// The sword-beast's crude blade (its own art in swords/beast-sword/). Sword base
// stats — the light, fast baseline swing.
export class BeastSword extends Sword {
  readonly id = "beast-sword";
  readonly name = "Beast Sword";
}

// The axe-beast's crude axe (its own art in axes/beast-axe/). Axe base stats —
// heavier: more damage and force than the sword.
export class BeastAxe extends Axe {
  readonly id = "beast-axe";
  readonly name = "Beast Axe";
}

// The mace-beast's crude mace (its own art in maces/beast-mace/). Mace base stats.
export class BeastMace extends Mace {
  readonly id = "beast-mace";
  readonly name = "Beast Mace";
}

// The skeleton's blade — a humanoid holding a broadsword-shaped weapon. Reuses the
// broadsword icon (no dedicated art), but is its own weapon so retuning the
// player's broadsword never touches the skeleton. Sword base stats today.
export class SkeletonBlade extends Sword {
  readonly id = "skeleton-blade";
  readonly name = "Skeletal Blade";
  get iconPath(): string { return "/sprites/weapons/swords/broadsword/broadsword.png"; }
}

// The skeleton-mage's staff — reuses the oak-staff icon, but fires its OWN enemy
// bolt (hex-bolt) rather than the player Mage's magic-bolt, so the mage's ranged
// damage/speed/knockback tune in isolation (that lives on the ammo — see
// ammo/hex-bolt). Its own weapon so the Mage's starter staff can be retuned freely.
export class SkeletonStaff extends Staff {
  readonly id = "skeleton-staff";
  readonly name = "Bone Staff";
  get iconPath(): string { return "/sprites/weapons/staves/oak-staff/oak-staff.png"; }
  get ammoId(): string { return "hex-bolt"; }
}

// The armor-lancer's lance — a long thrust. The player lance weapon was retired
// from the catalog, but its icon art (spears/lance/lance.png) is kept solely for
// this enemy armament, which is the only thing that still renders it.
export class SoldierLance extends Spear {
  readonly id = "soldier-lance";
  readonly name = "Soldier Lance";
  get iconPath(): string { return "/sprites/weapons/spears/lance/lance.png"; }
}

// The enemy-armament analogue of WEAPONS: the source-of-truth array the registry
// folds in for lookup, but NOT part of the rollable loot pool.
export const ENEMY_WEAPONS: WeaponClass[] = [
  BeastSword, BeastAxe, BeastMace,
  SkeletonBlade, SkeletonStaff, SoldierLance,
];

export type EnemyWeaponId =
  | "beast-sword"
  | "beast-axe"
  | "beast-mace"
  | "skeleton-blade"
  | "skeleton-staff"
  | "soldier-lance";
