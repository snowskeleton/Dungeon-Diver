import { Schema, type } from "@colyseus/schema";
import { WeaponInstance, DroppedWeaponStateView } from "shared";
import { WeaponSlotState } from "./WeaponSlotState";

// A weapon lying on the floor, keyed in GameState.droppedWeapons by a drop id.
// Dropped when a player already at the weapon cap (MAX_WEAPONS) takes a new one:
// the weapon in hand is set down where they stand. Anyone whose class can wield it
// may pick it back up (the drop is not owner-locked), which re-mints it identically
// and — if the picker is also capped — drops THEIR held weapon in turn.
//
// Like RewardState it previews resolved stats (`weapon`) so the ground item shows
// exactly what you'd get, while the modifiers that produced them ride along on the
// undecorated `instance` field.

export class DroppedWeaponState extends Schema implements DroppedWeaponStateView {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  /** Template id, so the client picks the right icon. */
  @type("string") weaponId: string = "";
  @type("string") name: string = "";
  /** Resolved stats for the ground preview (mods folded in). */
  @type(WeaponSlotState) weapon = new WeaponSlotState();

  /**
   * SERVER-ONLY — deliberately not decorated with `@type`, so it never syncs.
   *
   * The exact WeaponInstance that was dropped. A pickup re-grants THIS instance
   * (its template + rolled WeaponMods), so the weapon that comes back off the floor
   * is identical to the one set down. The mods can't be schema fields — a WeaponMod's
   * value is behaviour (getters) and `@type` holds only primitives/Schemas — and the
   * client has no use for them anyway (`weapon` already carries the resolved numbers
   * it draws). Same pattern as RewardState.mods / ChestState.weaponId. Colyseus
   * preserves an undecorated property through MapSchema.set, so it survives here.
   */
  instance!: WeaponInstance;
}
