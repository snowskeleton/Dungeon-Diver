import { Schema, type, ArraySchema } from "@colyseus/schema";
import { Facing, CharacterClass, CharacterType, UpgradeSlotView, PlayerStateView } from "shared";
import { EntityState } from "./EntityState";
import { WeaponSlotState } from "./WeaponSlotState";

/** One held upgrade, for the pause menu's list. Purely descriptive — the effect
 *  itself lives in the server-side Upgrade class and never crosses the wire. */
export class UpgradeSlotState extends Schema implements UpgradeSlotView {
  @type("string") id: string = "";
  @type("string") name: string = "";
  @type("string") description: string = "";
}

export class PlayerState extends EntityState implements PlayerStateView {
  @type("string") facing: Facing = "down";
  @type("boolean") isAttacking: boolean = false;
  // Increments once per swing — clients edge-detect this to restart the attack
  // animation even when isAttacking never flips false (held attack key).
  @type("uint16") attackSeq: number = 0;
  @type("string") characterClass: CharacterClass = "knight";
  @type("string") characterType: CharacterType = "guy";
  // weaponId is the ACTIVE weapon (updated on switch) so remote weapon-visual
  // swaps key off it; weapons + activeWeaponIndex drive the HUD/switching.
  @type("string") weaponId: string = "broadsword";
  // Named `weapons` rather than `inventory` because other item lists (consumables,
  // key items, equipment) are expected to sit beside it as their own typed lists.
  @type([WeaponSlotState]) weapons = new ArraySchema<WeaponSlotState>();
  @type("uint8") activeWeaponIndex: number = 0;
  // Folded max HP — the client HUD draws the bar against this, and upgrades move it.
  @type("uint16") maxHp: number = 100;
  @type([UpgradeSlotState]) upgrades = new ArraySchema<UpgradeSlotState>();
}
