/**
 * The synced state as the CLIENT sees it.
 *
 * The client generates its own map and renders server-authoritative entities, so
 * it reads the room state constantly — but it cannot import the server's schema
 * classes (they pull in matter-js, the entity classes, the whole server tree).
 * The historical workaround was `pState: any` at every callback boundary, which
 * CLAUDE.md documents as the project's most dangerous gotcha: rename a `@type`
 * field and the client silently reads `undefined` at runtime, with nothing
 * failing the typecheck.
 *
 * These interfaces close that hole. Each server schema declares
 * `implements <View>`, so a field the client reads that the server no longer
 * writes is a **server-side compile error** — the rename fails at the source
 * rather than 20 files away at runtime.
 *
 * Rules for this file:
 *
 * - **Synced fields only.** A property that is deliberately undecorated on the
 *   schema (OfferChoiceState.mods, ChestState.weaponId/mods) must NOT appear
 *   here: it never crosses the wire, so a client that could see it in the types
 *   would be reading undefined. Their absence is the point.
 * - **Read-only.** The client never writes state; only the server does.
 * - **No behaviour**, beyond the sync callbacks Colyseus puts on every Schema
 *   and collection.
 *
 * This mirrors how WeaponSlotView and UpgradeSlotView already work — the wire
 * shape named in `shared`, the schema that implements it on the server.
 */

import type { Facing, AiState } from "./types";
import type { CharacterClass, CharacterType } from "./characters/base";
import type { WeaponSlotView } from "./weapons/instance";
import type { UpgradeSlotView } from "./upgrades";

// ── Colyseus collection shapes ─────────────────────────────────────────────
// Structural subsets of MapSchema/ArraySchema: exactly the members the client
// uses, so a plain object can stand in for one in a test.

export interface SyncedMap<T> {
  onAdd(callback: (item: T, key: string) => void, triggerAll?: boolean): unknown;
  onRemove(callback: (item: T, key: string) => void): unknown;
  get(key: string): T | undefined;
  forEach(callback: (value: T, key: string, map: unknown) => void): void;
  has(key: string): boolean;
  readonly size: number;
}

export interface SyncedList<T> {
  /** Iterable, so `Array.from(list)` yields T[]. Deliberately NOT ArrayLike (no
   *  numeric index signature): ArrayLike wins Array.from's overload resolution
   *  and would degrade the result to (T | undefined)[] at every call site. */
  [Symbol.iterator](): IterableIterator<T>;
  readonly length: number;
  at(index: number): T | undefined;
  forEach(callback: (value: T, index: number, list: unknown) => void): void;
}

/** Every Schema instance can be watched for changes. */
export interface SyncedSchema {
  onChange(callback: () => void): unknown;
}

// ── Entity views ───────────────────────────────────────────────────────────

export interface EntityStateView extends SyncedSchema {
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly speedMultiplier: number;
  readonly stunned: boolean;
}

export interface PlayerStateView extends EntityStateView {
  readonly facing: Facing;
  readonly isAttacking: boolean;
  readonly attackSeq: number;
  readonly characterClass: CharacterClass;
  readonly characterType: CharacterType;
  /** The ACTIVE weapon's id. A plain string on purpose: the server's Weapon.id
   *  is a string (the combat harness mints ad-hoc weapons outside the registry),
   *  so consumers resolve it against WEAPON_REGISTRY defensively rather than
   *  trusting it to be a WeaponId. */
  readonly weaponId: string;
  readonly weapons: SyncedList<WeaponSlotView>;
  readonly activeWeaponIndex: number;
  readonly maxHp: number;
  readonly upgrades: SyncedList<UpgradeSlotView>;
}

export interface EnemyStateView extends EntityStateView {
  readonly aiState: AiState;
  readonly targetId: string;
  readonly facing: Facing;
  readonly isDying: boolean;
  readonly enemyType: string;
  readonly maxHealth: number;
  readonly aggroRadius: number;
  readonly attackRadius: number;
  readonly telegraph: boolean;
  readonly abilityId: string;
  readonly channeling: boolean;
  readonly airHeight: number;
}

export interface ProjectileStateView extends EntityStateView {
  readonly angle: number;
  readonly ammoId: string;
  readonly ownerSessionId: string;
}

// ── Room-feature views ─────────────────────────────────────────────────────

export interface ShopItemStateView extends SyncedSchema {
  readonly weaponId: string;
  readonly cost: number;
  readonly purchased: boolean;
  readonly x: number;
  readonly y: number;
}

export interface ShopStateView extends SyncedSchema {
  readonly roomId: string;
  readonly items: SyncedList<ShopItemStateView>;
}

export interface OfferChoiceStateView extends SyncedSchema {
  readonly kind: "weapon" | "upgrade";
  readonly name: string;
  readonly description: string;
  readonly upgradeId: string;
  /** Resolved stats for the card. The WeaponMods that produced them stay
   *  server-side — see OfferChoiceState.mods. */
  readonly weapon: WeaponSlotView;
}

export interface OfferStateView extends SyncedSchema {
  readonly roomId: string;
  readonly x: number;
  readonly y: number;
  readonly claimed: boolean;
  readonly choices: SyncedList<OfferChoiceStateView>;
}

/** Note what is NOT here: `weaponId` and `mods`. A chest's contents are
 *  deliberately unsynced — that's the surprise the chest exists to create. */
export interface ChestStateView extends SyncedSchema {
  readonly roomId: string;
  readonly x: number;
  readonly y: number;
  readonly opened: boolean;
  readonly gold: boolean;
}

export interface RoomChallengeStateView extends SyncedSchema {
  readonly roomId: string;
  readonly text: string;
  readonly complete: boolean;
}

// ── The root ───────────────────────────────────────────────────────────────

export interface GameStateView extends SyncedSchema {
  readonly players: SyncedMap<PlayerStateView>;
  readonly enemies: SyncedMap<EnemyStateView>;
  readonly projectiles: SyncedMap<ProjectileStateView>;
  readonly shops: SyncedMap<ShopStateView>;
  readonly offers: SyncedMap<OfferStateView>;
  readonly chests: SyncedMap<ChestStateView>;
  readonly challenges: SyncedMap<RoomChallengeStateView>;
  readonly floor: number;
  readonly seed: number;
  readonly dungeonOpts: string;
  readonly paused: boolean;
}
