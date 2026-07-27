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
  // Which swing of the melee combo the current attack is (0 = first, 1 = reverse,
  // 2 = finisher). Clients read it on an attackSeq change to draw the matching FX
  // strip and mirror. Meaningless for ranged/AOE weapons (stays 0).
  @type("uint8") comboStep: number = 0;
  // Melee attacks are deferred: while the button is held the player holds the
  // swing's wind-up pose (charging = true). chargeHard flips true once the hold
  // passes the threshold, so the client can telegraph that the heavy is armed.
  @type("boolean") charging: boolean = false;
  @type("boolean") chargeHard: boolean = false;
  // The swing that the latest attackSeq fired was a hard (charged) swing — the
  // client reads this on an attackSeq change to draw the heavy strip.
  @type("boolean") hardSwing: boolean = false;
  @type("string") characterClass: CharacterClass = "knight";
  @type("string") characterType: CharacterType = "guy";
  // weaponId is the ACTIVE weapon (updated on switch) so remote weapon-visual
  // swaps key off it; weapons + activeWeaponIndex drive the HUD/switching. Empty
  // until the player claims their first weapon — they spawn empty-handed.
  @type("string") weaponId: string = "";
  // Named `weapons` rather than `inventory` because other item lists (consumables,
  // key items, equipment) are expected to sit beside it as their own typed lists.
  @type([WeaponSlotState]) weapons = new ArraySchema<WeaponSlotState>();
  @type("uint8") activeWeaponIndex: number = 0;
  // Folded max HP — the client HUD draws the bar against this, and upgrades move it.
  @type("uint16") maxHp: number = 100;
  @type([UpgradeSlotState]) upgrades = new ArraySchema<UpgradeSlotState>();
  // Lobby identity. Both survive into the run: the name because the HUD and the
  // party roster want it, `ready` because nothing reads it once the run starts.
  @type("string") name: string = "Player";
  @type("boolean") ready: boolean = false;
  // Downed = at 0 HP but not out of the run: frozen and un-controllable, waiting
  // for a teammate to revive. reviveProgress is 0..1, how full the revive bar is.
  @type("boolean") downed: boolean = false;
  @type("float32") reviveProgress: number = 0;
}
