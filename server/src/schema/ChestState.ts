import { Schema, type } from "@colyseus/schema";
import { WeaponMod, WeaponId } from "shared";

// A chest room's treasure chest, keyed in GameState.chests by room id.
//
// A chest is deliberately the least interactive reward in the game: no picker, no
// cost, no choice. You walk up, press interact, and the weapon is yours. That's
// what separates it from the shrine (a deliberate 1-of-3 build decision) and the
// shop (a paid one) — a chest is a surprise, so what's inside is never previewed.

export class ChestState extends Schema {
  @type("string") roomId: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  /** True once someone has opened it — drives the open animation client-side and
   *  makes a duplicated or racing "chestOpen" message harmless rather than a
   *  double-grant, exactly as `claimed` does for an offer. */
  @type("boolean") opened: boolean = false;
  /** The rarer gold chest. Purely a rarity tier: it uses row 1 of the sprite sheet
   *  and rolls an extra modifier onto the weapon inside. */
  @type("boolean") gold: boolean = false;

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
