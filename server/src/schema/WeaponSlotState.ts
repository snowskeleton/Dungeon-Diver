import { Schema, type, ArraySchema } from "@colyseus/schema";
import { WeaponSlotView } from "shared";

// One wielded weapon as the client sees it.
//
// The wire carries RESOLVED stats, not the modifier objects that produced them.
// Two reasons. Modifiers are behaviour-bearing classes, so reconstructing them
// client-side would need an id→class lookup table — exactly the design CLAUDE.md
// rules out. And a second fold implementation on the client is a divergence bug
// waiting to happen: the server folds once, authoritatively, and broadcasts
// numbers. `modLabels` carries the presentation strings the server already
// generated, so the UI can say WHY a weapon is better without reconstructing how.
//
// Everything else the client needs about a weapon (icon, name, fx type, hurtbox
// geometry) is template data it already has via WEAPON_REGISTRY[weaponId].
// `implements WeaponSlotView` is the compile-time guard that the wire shape the
// client reads and the schema the server writes never drift apart.
export class WeaponSlotState extends Schema implements WeaponSlotView {
  /** Stable per-instance id. Two identical weapons are distinct slots, so the
   *  client's acquire diff keys off this rather than the weapon id. */
  @type("string") uid: string = "";
  @type("string") weaponId: string = "";
  @type("float32") damage: number = 0;
  @type("uint16") attackCooldownMs: number = 0;
  @type("float32") attackForce: number = 0;
  // Post-fold projectile stats; all zero for a melee weapon.
  @type("float32") ammoDamage: number = 0;
  @type("float32") ammoSpeed: number = 0;
  @type("uint8") ammoPierce: number = 0;
  @type("float32") ammoKnockback: number = 0;
  @type(["string"]) modLabels = new ArraySchema<string>();
}
