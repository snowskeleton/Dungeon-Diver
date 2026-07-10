import { type, ArraySchema } from "@colyseus/schema";
import { Facing } from "shared";
import { EntityState } from "./EntityState";

export class PlayerState extends EntityState {
  @type("string") facing: Facing = "down";
  @type("boolean") isAttacking: boolean = false;
  // Increments once per swing — clients edge-detect this to restart the attack
  // animation even when isAttacking never flips false (held attack key).
  @type("uint16") attackSeq: number = 0;
  @type("string") characterClass: string = "knight";
  @type("string") characterType: string = "guy";
  // weaponId is the ACTIVE weapon (updated on switch) so remote weapon-visual
  // swaps key off it; inventory + activeWeaponIndex drive the HUD/switching.
  @type("string") weaponId: string = "broadsword";
  @type(["string"]) inventory = new ArraySchema<string>();
  @type("uint8") activeWeaponIndex: number = 0;
}
