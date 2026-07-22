import { Schema, ArraySchema, MapSchema, type } from "@colyseus/schema";
import {
  WeaponMod,
  OfferStateView,
  OfferChoiceStateView,
  PlayerOfferStateView,
} from "shared";
import { WeaponSlotState } from "./WeaponSlotState";

// A per-player 1-of-3 reward waiting on a pedestal — the shrine boon and the boss
// drop. Every player in the party gets their OWN three cards (rolled at
// LootDirector.rollOffer), and the party's picks are a DRAFT: once anyone claims a
// given item it is consumed party-wide and greyed out of everyone else's remaining
// options, so the whole party can't all grab the single strongest reward.
//
// Weapon options are drawn distinct across the party, so each player always keeps at
// least their own exclusive weapon card — that's what guarantees no player can be
// left with nothing to pick (only upgrade cards, drawn from a smaller pool, may
// repeat across players and be contested).
//
// Like a shop this pauses the room while the picker is open, but the claim is
// per-player: one player picking doesn't consume the pedestal for the others.

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
  /** The party-wide draft key for this choice ("weapon:<id>" / "upgrade:<id>").
   *  When a player claims a choice this string lands in OfferState.consumed, and the
   *  same choice on any other player's card greys out. Synced so the client can grey
   *  a card without knowing how the identity is composed. */
  @type("string") identity: string = "";

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

/** One player's slice of a pedestal: their three cards and whether they've taken
 *  one yet. Keyed by session id in OfferState.players. */
export class PlayerOfferState extends Schema implements PlayerOfferStateView {
  /** True once this player has taken one of their cards — their pedestal ghosts out
   *  and further picks from this player are refused, which is also what makes a
   *  duplicated message harmless. */
  @type("boolean") claimed: boolean = false;
  @type([OfferChoiceState]) choices = new ArraySchema<OfferChoiceState>();
}

/** A pedestal's worth of per-player drafts, keyed in GameState.offers by room id. */
export class OfferState extends Schema implements OfferStateView {
  @type("string") roomId: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  /** One draft per player, keyed by session id. */
  @type({ map: PlayerOfferState }) players = new MapSchema<PlayerOfferState>();
  /** Identity strings already claimed by someone in the party. A choice whose
   *  `identity` is in here is spent and cannot be picked again by anyone. */
  @type(["string"]) consumed = new ArraySchema<string>();
}
