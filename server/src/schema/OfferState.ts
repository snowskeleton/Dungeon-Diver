import { Schema, ArraySchema, type } from "@colyseus/schema";
import { WeaponMod, OfferStateView, OfferChoiceStateView } from "shared";
import { WeaponSlotState } from "./WeaponSlotState";

// A 1-of-3 reward waiting on a pedestal — the shrine boon and the boss drop.
//
// Unlike a shop, an offer is a single irreversible modal choice, so the room
// pauses while the picker is open (see GameRoom's offer_open handler) and the
// first player to claim it consumes it.

/** One of the three things a player may pick. `kind` decides which of the two
 *  payload halves is meaningful — an exhaustive switch, not a lookup. */
export class OfferChoiceState extends Schema implements OfferChoiceStateView {
  @type("string") kind: "weapon" | "upgrade" = "upgrade";
  @type("string") name: string = "";
  @type("string") description: string = "";
  /** kind === "upgrade": which Upgrade class to instantiate on pick. */
  @type("string") upgradeId: string = "";
  /** kind === "weapon": the rolled weapon, already resolved so the card can show
   *  the exact stats the player will receive (modifiers included). */
  @type(WeaponSlotState) weapon = new WeaponSlotState();

  /**
   * SERVER-ONLY — deliberately not decorated with `@type`, so it never syncs.
   *
   * The rolled modifiers have to survive from floor generation until someone
   * claims the pedestal, and they cannot be schema fields: a WeaponMod's value is
   * behaviour (getters), and `@type` holds only primitives and Schemas. Rebuilding
   * one client-side from a synced tag would need an id→class table, which this
   * project doesn't do — and the client has no use for the object anyway, since
   * `weapon` above already carries the resolved numbers it draws.
   *
   * So the real objects just stay here, on the choice they belong to. Claiming
   * hands these straight to Player.addWeapon, which is what guarantees the weapon
   * granted is precisely the one previewed rather than re-derived from labels.
   */
  mods: WeaponMod[] = [];
}

/** A pedestal's worth of choices, keyed in GameState.offers by room id. */
export class OfferState extends Schema implements OfferStateView {
  @type("string") roomId: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  /** True once someone has taken it — the pedestal ghosts out and further picks
   *  are refused, which is also what makes a duplicated message harmless. */
  @type("boolean") claimed: boolean = false;
  @type([OfferChoiceState]) choices = new ArraySchema<OfferChoiceState>();
}
