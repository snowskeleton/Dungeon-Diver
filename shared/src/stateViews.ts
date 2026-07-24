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
import type { RunPhase } from "./lobby";

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
  /** Display name, chosen in the lobby. Never empty — the server substitutes a
   *  default rather than letting a blank row appear in the roster. */
  readonly name: string;
  /** Lobby readiness. Stays true through the run; it is only read before it starts. */
  readonly ready: boolean;
  /** At 0 HP but not out: frozen, waiting on a teammate. See PlayerState. */
  readonly downed: boolean;
  /** Revive-bar fill, 0..1, while a teammate stands over a downed player. */
  readonly reviveProgress: number;
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
  /** The three cards, shared by the whole party. */
  readonly choices: SyncedList<OfferChoiceStateView>;
  /** Indices of the cards already taken — greyed out for everyone. */
  readonly consumed: SyncedList<number>;
  /** Session ids that have already claimed a card (at most one each). */
  readonly claimedBy: SyncedList<string>;
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

/** A gold coin lying on the floor (or homing toward a player). `value` is what it
 *  adds to the shared purse when collected — the client draws every coin the same
 *  regardless, so it's only read for a tooltip/debug, never to pick a sprite. */
export interface CoinStateView extends SyncedSchema {
  readonly x: number;
  readonly y: number;
  readonly value: number;
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
  /** Loose coins on the floor, keyed by coin id. */
  readonly coins: SyncedMap<CoinStateView>;
  /** The shared party purse — gold everyone spends from, everyone contributes to. */
  readonly gold: number;
  readonly floor: number;
  readonly seed: number;
  readonly dungeonOpts: string;
  readonly paused: boolean;
  /** How many living players are standing on the stairs right now, of
   *  `stairsPartySize`. The floor descends only when the two are equal; the
   *  client shows an "N/M on stairs" prompt from these. */
  readonly playersOnStairs: number;
  /** Living player count the stairs prompt measures against (1 when solo). */
  readonly stairsPartySize: number;
  /** "lobby" until the host starts; the client watches this to leave the lobby
   *  panel and boot GameScene, so it is the run's one start signal. */
  readonly phase: RunPhase;
  /** Whose Start button is live. Reassigned if the host leaves the lobby. */
  readonly hostSessionId: string;
  readonly roomName: string;
  /** The 4-character join code, shown in the lobby so it can be shared. */
  readonly roomCode: string;
  readonly isPrivate: boolean;
}
