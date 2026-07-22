import { Schema, ArraySchema, type } from "@colyseus/schema";
import { WeaponMod, OfferStateView, OfferChoiceStateView } from "shared";
import { WeaponSlotState } from "./WeaponSlotState";

// A shared 1-of-3 reward waiting on a pedestal — the shrine boon and the boss drop.
// The whole party sees the SAME three cards, and the picks are mutually exclusive:
// the first player takes one, that card greys out for everyone else, the next player
// takes one of the remaining two, and so on. Each player may claim at most one, and
// once all three are spent there is nothing left (a 4th player in a full party gets
// no pick — the pedestal reads as exhausted).
//
// Like a shop the room pauses while the picker is open, but unlike a shop a single
// claim doesn't consume the whole pedestal — only that one card.

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

/** A pedestal's shared 1-of-3, keyed in GameState.offers by room id. */
export class OfferState extends Schema implements OfferStateView {
  @type("string") roomId: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  /** The three cards, shown identically to every player. */
  @type([OfferChoiceState]) choices = new ArraySchema<OfferChoiceState>();
  /** Indices of the cards already taken. A card whose index is in here is spent and
   *  greys out for everyone; the pedestal is exhausted once this covers every card.
   *  This is the whole concurrency story — a racing or duplicated message just finds
   *  the index already present and is a no-op. */
  @type(["number"]) consumed = new ArraySchema<number>();
  /** Session ids that have already taken a card. Each player may claim at most one,
   *  so a second pick from the same player is refused even if cards remain. */
  @type(["string"]) claimedBy = new ArraySchema<string>();
}
