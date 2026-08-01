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
// The BASE art the client needs (icon, fx type, hurtbox geometry) is template data
// it already has via resolveWeapon(weaponId). What the template CANNOT know — the
// runtime-composed name and tint — rides here as data, so a weapon assembled from an
// unbounded mix of modifiers renders correctly without the client knowing the combo.
// `implements WeaponSlotView` is the compile-time guard that the wire shape the
// client reads and the schema the server writes never drift apart.
export class WeaponSlotState extends Schema implements WeaponSlotView {
  /** Stable per-instance id. Two identical weapons are distinct slots, so the
   *  client's acquire diff keys off this rather than the weapon id. */
  @type("string") uid: string = "";
  @type("string") weaponId: string = "";
  // The composed display name and art tint (see WeaponInstance.displayName / .tint).
  // `weaponId` selects the BASE ART; these carry the runtime-composed identity, so a
  // "Cold Broadsword of Vampirism" the client has never heard of still renders right.
  @type("string") displayName: string = "";
  @type("int32") tint: number = -1;
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
