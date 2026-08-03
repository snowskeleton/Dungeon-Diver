import { Observable, ObservableMap, ObservableList, tracked } from "shared";
import { WeaponMod, WeaponId, ChestStateView } from "shared";

// A maze room's treasure chest, at its deepest tile, keyed in GameState.chests by
// room id. (There is no "chest room" type — that was retired; chests now reward
// solving a maze.)
//
// A chest is deliberately the least interactive reward in the game: no picker, no
// cost, no choice. You walk up, press interact, and the weapon is yours. That's
// what separates it from the shrine (a deliberate 1-of-3 build decision) and the
// shop (a paid one) — a chest is a surprise, so what's inside is never previewed.

export class ChestState extends Observable implements ChestStateView {
  @tracked("string") roomId: string = "";
  @tracked("number") x: number = 0;
  @tracked("number") y: number = 0;
  /** True once someone has opened it — drives the open animation client-side and
   *  makes a duplicated or racing "chestOpen" message harmless rather than a
   *  double-grant, exactly as `claimed` does for an offer. */
  @tracked("boolean") opened: boolean = false;
  /** The rarer gold chest. Purely a rarity tier: it uses row 1 of the sprite sheet
   *  and rolls an extra modifier onto the weapon inside. */
  @tracked("boolean") gold: boolean = false;

  /**
   * SERVER-ONLY — deliberately not decorated with `@type`, so they never sync.
   *
   * Two reasons, and only the first applies to OfferChoiceState. A WeaponMod's
   * value is behaviour (getters), which `@type` cannot carry — same constraint
   * documented on OfferChoiceState.mods.
   *
   * But here it's also the point: syncing the contents would spoil the surprise
   * the chest exists to create. The client is told a chest is there and whether
   * it's gold, nothing more. The player learns what they got from the AcquireFX
   * that fires when the weapon lands in their inventory.
   */
  weaponId: WeaponId | null = null;
  mods: WeaponMod[] = [];
}
