import { Observable, ObservableMap, ObservableList, tracked } from "shared";
import { Facing, CharacterClass, CharacterType, UpgradeSlotView, PlayerStateView } from "shared";
import { EntityState } from "./EntityState";
import { WeaponSlotState } from "./WeaponSlotState";

/** One held upgrade, for the pause menu's list. Purely descriptive — the effect
 *  itself lives in the server-side Upgrade class and never crosses the wire. */
export class UpgradeSlotState extends Observable implements UpgradeSlotView {
  @tracked("string") id: string = "";
  @tracked("string") name: string = "";
  @tracked("string") description: string = "";
}

export class PlayerState extends EntityState implements PlayerStateView {
  @tracked("string") facing: Facing = "down";
  // Base move speed (px/sec, pre-multiplier), synced so the client can predict its
  // own movement at the server's exact pace.
  @tracked("float32") moveSpeed: number = 0;
  @tracked("boolean") isAttacking: boolean = false;
  // Increments once per swing — clients edge-detect this to restart the attack
  // animation even when isAttacking never flips false (held attack key).
  @tracked("uint16") attackSeq: number = 0;
  // Which swing of the melee combo the current attack is (0 = first, 1 = reverse,
  // 2 = finisher). Clients read it on an attackSeq change to draw the matching FX
  // strip and mirror. Meaningless for ranged/AOE weapons (stays 0).
  @tracked("uint8") comboStep: number = 0;
  // Melee attacks are deferred: while the button is held the player holds the
  // swing's wind-up pose (charging = true). chargeHard flips true once the hold
  // passes the threshold, so the client can telegraph that the heavy is armed.
  @tracked("boolean") charging: boolean = false;
  @tracked("boolean") chargeHard: boolean = false;
  // A melee swing spends the weapon's cooldown as a visible wind-up before the
  // blow: while this is true the client holds the cocked-back first swing frame
  // (same pose as charging), then plays the arc when it flips false. 0ms for fast
  // weapons whose swing animation already fills the cooldown.
  @tracked("boolean") windingUp: boolean = false;
  // The swing that the latest attackSeq fired was a hard (charged) swing — the
  // client reads this on an attackSeq change to draw the heavy strip.
  @tracked("boolean") hardSwing: boolean = false;
  @tracked("string") characterClass: CharacterClass = "knight";
  @tracked("string") characterType: CharacterType = "guy";
  // weaponId is the ACTIVE weapon (updated on switch) so remote weapon-visual
  // swaps key off it; weapons + activeWeaponIndex drive the HUD/switching. Empty
  // until the player claims their first weapon — they spawn empty-handed.
  @tracked("string") weaponId: string = "";
  // Named `weapons` rather than `inventory` because other item lists (consumables,
  // key items, equipment) are expected to sit beside it as their own typed lists.
  @tracked([WeaponSlotState]) weapons = new ObservableList<WeaponSlotState>();
  @tracked("uint8") activeWeaponIndex: number = 0;
  // Folded max HP — the client HUD draws the bar against this, and upgrades move it.
  @tracked("uint16") maxHp: number = 100;
  // Folded damage buffs from upgrades — synced so the inventory menu can show a
  // weapon's ACTUAL damage (base folded through these), not just its template base.
  @tracked("float32") damageFlat: number = 0;
  @tracked("float32") damagePct: number = 0;
  @tracked([UpgradeSlotState]) upgrades = new ObservableList<UpgradeSlotState>();
  // Lobby identity. Both survive into the run: the name because the HUD and the
  // party roster want it, `ready` because nothing reads it once the run starts.
  @tracked("string") name: string = "Player";
  @tracked("boolean") ready: boolean = false;
  // Downed = at 0 HP but not out of the run: frozen and un-controllable, waiting
  // for a teammate to revive. reviveProgress is 0..1, how full the revive bar is.
  @tracked("boolean") downed: boolean = false;
  @tracked("float32") reviveProgress: number = 0;
  // Class movement ability (Charge / Blink / Dash / Vault). abilityId names the
  // ability being cast this instant (""=idle) for the matching FX; abilitySeq
  // bumps once per cast so a multi-tick channel plays its FX exactly once;
  // abilityCooldownFrac is a 0..1 fill (0 just-cast → 1 ready) driving the little
  // cooldown bar under the player. Defaults to 1 = ready, so the bar starts hidden.
  @tracked("string") abilityId: string = "";
  @tracked("uint16") abilitySeq: number = 0;
  @tracked("float32") abilityCooldownFrac: number = 1;
  // True during a Mage Blink's disappearance gap — the client hides the sprite and
  // poofs at both ends. Only the Blink sets it; every other ability leaves it false.
  @tracked("boolean") blinkHidden: boolean = false;
}
