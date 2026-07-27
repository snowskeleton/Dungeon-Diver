import { Schema, type } from "@colyseus/schema";
import { WeaponMod, RewardStateView } from "shared";
import { WeaponSlotState } from "./WeaponSlotState";

// The single-reward pedestal dropped where a room's last enemy fell, keyed in
// GameState.rewards by room id. Every room that isn't already a reward room (shop,
// shrine, boss, a challenge that pays out) drops one on clear.
//
// Unlike an OfferState there is no choice and no cost: walk up, press interact,
// and the one reward is yours. `kind` decides which payload half is meaningful —
// an exhaustive switch, not a lookup. Unlike the old chest, the reward IS
// previewed (the client draws the weapon icon / upgrade name / gold amount), so a
// player can see what they're about to grab.

export class RewardState extends Schema implements RewardStateView {
  @type("string") roomId: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  /** True once someone has taken it — drives the ghost-out client-side and makes a
   *  duplicated or racing "claimReward" message harmless rather than a double-grant,
   *  exactly as `consumed` does for an offer. */
  @type("boolean") claimed: boolean = false;

  @type("string") kind: "weapon" | "upgrade" | "gold" = "gold";
  @type("string") name: string = "";
  @type("string") description: string = "";
  /** kind === "upgrade": which Upgrade class to instantiate on claim. */
  @type("string") upgradeId: string = "";
  /** kind === "gold": how much this adds to the shared purse. */
  @type("number") gold: number = 0;
  /** kind === "weapon": the rolled weapon, already resolved so the pedestal can show
   *  the exact stats the player will receive (modifiers included). */
  @type(WeaponSlotState) weapon = new WeaponSlotState();

  /**
   * SERVER-ONLY — deliberately not decorated with `@type`, so it never syncs.
   *
   * kind === "weapon" only. The rolled modifiers must survive from the drop until
   * someone claims it, and cannot be schema fields: a WeaponMod's value is
   * behaviour (getters), and `@type` holds only primitives and Schemas. Rebuilding
   * one client-side from a synced tag would need an id→class table this project
   * doesn't do — and the client has no use for the object anyway, since `weapon`
   * already carries the resolved numbers it draws. Same pattern as
   * OfferChoiceState.mods; claiming hands these straight to Player.addWeapon.
   */
  mods: WeaponMod[] = [];
}
