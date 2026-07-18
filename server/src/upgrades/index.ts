import { UpgradeId, UPGRADE_IDS } from "shared";
import { Upgrade, UpgradeClass } from "./Upgrade";
import {
  IronSkin,
  Toughness,
  Vitality,
  SwiftBoots,
  KeenEdge,
  Ferocity,
  Bloodthirst,
  Berserk,
} from "./stats";

export { Upgrade } from "./Upgrade";
export type { UpgradeClass, StatContributor } from "./Upgrade";
export * from "./stats";
export * from "./weaponMods";

/** Every upgrade that can be offered — direct class references, compiler-checked,
 *  no id→class map. Mirrors REGULAR_ENEMIES / BOSSES. Add an upgrade by writing
 *  the class and adding one line here. */
export const UPGRADES: UpgradeClass[] = [
  IronSkin,
  Toughness,
  Vitality,
  SwiftBoots,
  KeenEdge,
  Ferocity,
  Bloodthirst,
  Berserk,
];

/** The upgrades legal to offer on `floor`, as fresh instances. */
export function upgradePool(floor: number): InstanceType<UpgradeClass>[] {
  return UPGRADES.map(U => new U()).filter(u => u.minFloor <= floor);
}

/** Find the class for an id. A linear scan over 8 classes rather than a keyed map:
 *  the array is the single source of truth and there's no second structure to keep
 *  in sync (see the engineering note in CLAUDE.md). */
export function upgradeById(id: string): Upgrade | undefined {
  const Cls = UPGRADES.find(U => new U().id === id);
  return Cls ? new Cls() : undefined;
}

/** Boot-time guard that the shared id union and the class list agree. Without it,
 *  adding an id to `UpgradeId` without writing the class (or vice versa) would only
 *  surface as a silently-ignored debug option. */
export function assertUpgradesCoverAllIds(): void {
  const built = new Set(UPGRADES.map(U => new U().id));
  const missing = UPGRADE_IDS.filter(id => !built.has(id));
  const extra = [...built].filter(id => !UPGRADE_IDS.includes(id as UpgradeId));
  if (missing.length || extra.length) {
    throw new Error(
      `Upgrade registry mismatch — missing classes for [${missing}], unlisted ids [${extra}]`,
    );
  }
}
