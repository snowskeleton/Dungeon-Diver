// Upgrades themselves are BEHAVIOURAL content and live server-side as OO classes
// (server/src/upgrades) — they never cross the wire, because reconstructing one
// client-side would mean an id→class lookup table, which this project doesn't do.
//
// What lives here is only what both sides must agree on: the set of ids (so the
// debug menu can offer them and the server can validate a request), and the
// descriptive shape a held upgrade takes on the wire. This mirrors how enemies
// already work — `EnemyType` is a shared union, the classes are server-side.

/** Every upgrade id. The server has one Upgrade subclass per entry, and
 *  `assertUpgradesCoverAllIds` fails loudly at boot if the two ever drift. */
export type UpgradeId =
  | "iron-skin"
  | "toughness"
  | "vitality"
  | "swift-boots"
  | "keen-edge"
  | "ferocity"
  | "bloodthirst"
  | "berserk";

/** The same ids as a value, for the debug menu's picker. */
export const UPGRADE_IDS: UpgradeId[] = [
  "iron-skin",
  "toughness",
  "vitality",
  "swift-boots",
  "keen-edge",
  "ferocity",
  "bloodthirst",
  "berserk",
];

/** What crosses the wire for a held upgrade: purely descriptive. The client
 *  renders these strings and computes nothing from them. */
export interface UpgradeSlotView {
  id: string;
  name: string;
  description: string;
}
