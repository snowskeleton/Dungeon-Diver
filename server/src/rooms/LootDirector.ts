import {
  TILE, TILE_SIZE, tileCenter,
  DungeonResult, RoomData, mazeDeepestTile,
  WEAPON_REGISTRY, WeaponId, WeaponInstance, Weapon,
  AMMO_REGISTRY,
  SHOP_TIERS,
  CharacterClass, partyRollableWeaponIds, firstRollWeaponIds,
  DebugConfig,
} from "shared";
import { GameState } from "../schema/GameState";
import { ShopState, ShopItemState } from "../schema/ShopState";
import { OfferState, OfferChoiceState } from "../schema/OfferState";
import { RewardState } from "../schema/RewardState";
import { ChestState } from "../schema/ChestState";
import { Player, resolveTemplate, slotStateFor } from "../entities/Player";
import { upgradeById, upgradePool, rollWeaponMod } from "../upgrades";

const SHOP_ITEM_COUNT = 3;
// How many choices a reward pedestal presents.
const OFFER_CHOICES = 3;
// How close (px) a player must stand to a pedestal to buy it.
const BUY_RADIUS = 40;

// The single room-clear reward: a weighted roll over three kinds. Weapons and
// upgrades are the meat; gold is the consolation that still feels earned. Balance
// is deliberately rough for now — tune these three numbers, nothing else.
const ROOM_REWARD_WEIGHTS: { kind: "weapon" | "upgrade" | "gold"; weight: number }[] = [
  // Weapons no longer drop from room-clear pedestals — they flooded the run
  // (shops + offer pedestals + maze chests already supply plenty), so a cleared
  // room now yields an upgrade or gold. Weapon acquisition lives in shops,
  // offer pedestals, and maze chests only.
  { kind: "weapon",  weight:  0 },
  { kind: "upgrade", weight: 70 },
  { kind: "gold",    weight: 30 },
];
// Gold handed out when a room-clear reward rolls gold — one cheap shop item's
// worth, so it reads as a small windfall rather than a jackpot.
const ROOM_REWARD_GOLD = SHOP_TIERS[0];

// Chance a maze chest is the rarer gold one.
const GOLD_CHEST_CHANCE = 0.15;
// Modifiers rolled onto the weapon inside a chest. A chest is pure loot — even the
// common one is enchanted, which is what makes it read differently from a shop's
// plain stock; gold just rolls a second modifier on top.
const BROWN_CHEST_MODS = 1;
const GOLD_CHEST_MODS = 2;

// Shown to a player who interacts with a weapon their class can't wield (D9/D18).
export const WRONG_CLASS_MSG = "Your class can't use that weapon.";

/** Everything reward-shaped: shops, shrine/boss offers, room-clear pedestals, and
 *  the floor-1 supply pedestals — placement at floor generation, and the
 *  validate-then-grant half of the player-facing loot messages. GameRoom owns one
 *  of these and delegates; it knows nothing about Colyseus beyond the GameState it
 *  writes into. The weapon-granting methods return a `string | null`: a non-null
 *  string is a user-facing error (GameRoom relays it as `loot_error`), null is a
 *  silent no-op or success. */
export class LootDirector {
  private dungeon!: DungeonResult;

  constructor(
    private readonly state: GameState,
    // The live player map — read for party composition (D10 loot filter) and for
    // laying one supply pedestal per player.
    private readonly players: Map<string, Player>,
    // The active debug config, or null in the real game. Only spawnSupply reads it
    // (the debug-menu first-weapon override).
    private readonly debug: DebugConfig | null = null,
  ) {}

  /** The classes present in the party right now — the D10 loot filter reads these
   *  so a weapon nobody can use never rolls. */
  private partyClasses(): CharacterClass[] {
    const classes: CharacterClass[] = [];
    this.players.forEach((p) => classes.push(p.character.id));
    return classes;
  }

  /** Point at the newly generated floor. Called from GameRoom.initFloor before any
   *  of the spawn methods. */
  setFloor(dungeon: DungeonResult) {
    this.dungeon = dungeon;
  }

  // ---- placement -----------------------------------------------------------

  // Populate each shop room with weapon pedestals (shared team pool). Rebuilt
  // per floor; the previous floor's shops are cleared here.
  spawnShops() {
    this.state.shops.clear();
    for (const room of this.dungeon.rooms) {
      if (room.type !== "shop") continue;
      const shop = new ShopState();
      shop.roomId = room.id;
      // Sorted cheapest-quality-first so the fixed tiers line up left→right with
      // ascending price: the leftmost pedestal is the bargain, the rightmost the
      // splurge, every floor (roadmap "Currency").
      const ids = this.rollShopWeapons(SHOP_ITEM_COUNT)
        .sort((a, b) => weaponQuality(WEAPON_REGISTRY[a]) - weaponQuality(WEAPON_REGISTRY[b]));
      // Lay pedestals in a row along the room's (always-carved) center row. The
      // generator keeps the stairs out of shop rooms, but a debug floor can force
      // every room to "shop" — nudge any pedestal that would cover the stairs.
      const cols = [room.centerCol - 3, room.centerCol, room.centerCol + 3]
        .map((col) => this.freeShopCol(col, room.centerRow));
      ids.forEach((wid, i) => {
        const item = new ShopItemState();
        item.weaponId = wid;
        // Fixed gold tiers (50 / 100 / 150), not a per-weapon price. What scales
        // with depth is the shop's quality, not its costs.
        item.cost = SHOP_TIERS[Math.min(i, SHOP_TIERS.length - 1)];
        const pos = tileCenter(cols[i], room.centerRow);
        item.x = pos.x;
        item.y = pos.y;
        shop.items.push(item);
      });
      this.state.shops.set(room.id, shop);
    }
  }

  // One reward pedestal at the center of every shrine room. Shrines spawn no
  // enemies and are pre-cleared by finalizeEmptyRooms, so the offer is reachable
  // the moment the player walks in — the room IS the reward.
  spawnShrineOffers() {
    this.state.offers.clear();
    for (const room of this.dungeon.rooms) {
      if (room.type !== "shrine") continue;
      const pos = this.pedestalPos(room);
      this.state.offers.set(room.id, this.rollOffer(room.id, pos.x, pos.y, "shrine"));
    }
  }

  // One chest at the DEEP END of every maze room — the tile hardest to reach from
  // the maze's doorways (mazeDeepestTile). Placed at floor generation and openable
  // anytime: the maze traversal is the gate, not a room clear, so a party that
  // solves the maze is rewarded whether or not they mop up every enemy. Maze rooms
  // still drop the ordinary room-clear pedestal on top of this (reward-per-room).
  spawnChests() {
    this.state.chests.clear();
    for (const room of this.dungeon.rooms) {
      if (room.type !== "maze") continue;
      const deep = mazeDeepestTile(this.dungeon.mapData, room);
      const pos = tileCenter(deep.col, deep.row);
      const chest = new ChestState();
      chest.roomId = room.id;
      chest.x = pos.x;
      chest.y = pos.y;
      chest.gold = Math.random() < GOLD_CHEST_CHANCE;

      // Roll the contents now, at floor generation. The weapon a chest holds is
      // fixed the moment the floor exists, so opening it can't be re-rolled by
      // walking away and coming back.
      chest.weaponId = this.rollShopWeapons(1)[0];
      const modCount = chest.gold ? GOLD_CHEST_MODS : BROWN_CHEST_MODS;
      for (let i = 0; i < modCount; i++) chest.mods.push(rollWeaponMod(this.state.floor));

      // NOT a collision body: you walk through it and open it by proximity/interact,
      // exactly like the reward and offer pedestals (B1). The chest used to be a solid
      // prop (B8), but the maze's deepest tile isn't always a dead end — when it landed
      // on a required corridor the chest walled off the only path to the exit and
      // hard-softlocked the run. Solving the maze is still the gate; the chest no
      // longer blocks anything.
      this.state.chests.set(room.id, chest);
    }
  }

  /** Clear the previous floor's room-clear pedestals. Unlike shops/shrines these
   *  are dropped dynamically as rooms are cleared (dropRoomReward), not placed at
   *  generation — so there's nothing to spawn up front, only last floor's to wipe. */
  resetRoomRewards() {
    this.state.rewards.clear();
  }

  /** Clear any supply pedestals from a previous floor. They only ever exist on
   *  floor 1, so on floors 2+ this just keeps the map empty. */
  resetSupplies() {
    this.state.supplies.clear();
  }

  /** Lay the floor-1 supply pedestals: one weapon per player, spread across the
   *  supply (start) room, each rolled from that player's UNIQUE weapon categories
   *  (its first-weapon pool). Called from GameRoom.startRun once the party is
   *  settled — players carry no weapon until they claim one here.
   *
   *  Not owner-locked: the pedestals are simply class-gated like every other
   *  weapon pickup, so a second Knight can take a Knight pedestal. */
  spawnSupply() {
    this.state.supplies.clear();
    if (this.state.floor !== 1) return;
    const room = this.dungeon.rooms.find((r) => r.type === "supply");
    if (!room) return;

    const sessionIds = [...this.players.keys()];
    // Fan the pedestals out along the room's center row, 3 columns apart, centred
    // on the room middle, so they read as one per player in front of the spawn.
    const spacing = 3;
    const startCol = room.centerCol - Math.floor((sessionIds.length - 1) / 2) * spacing;
    sessionIds.forEach((sid, i) => {
      const player = this.players.get(sid);
      if (!player) return;
      const weaponId = this.firstSupplyWeaponFor(player);
      if (!weaponId) return;
      const col = this.freeShopCol(startCol + i * spacing, room.centerRow);
      const pos = tileCenter(col, room.centerRow);
      const reward = this.buildWeaponReward(`supply:${i}`, pos.x, pos.y, weaponId);
      this.state.supplies.set(`supply:${i}`, reward);
    });
  }

  /** Which weapon drops at a player's supply pedestal. The debug menu's first-weapon
   *  picker forces it when set AND the player's class can equip it; otherwise (and in
   *  the real game) it rolls from the class's unique first-weapon pool. */
  private firstSupplyWeaponFor(player: Player): WeaponId | undefined {
    const forced = this.debug?.firstWeaponId;
    if (forced && forced in WEAPON_REGISTRY && player.canEquip(forced)) {
      return forced as WeaponId;
    }
    return pickDistinct(firstRollWeaponIds(player.character.id), 1)[0];
  }

  /** Drop a single-reward pedestal where a room's last enemy fell. Called once, on
   *  the room's clearing tick (GameRoom), for any room that doesn't already grant
   *  its own reward. The `has` guard means a room drops its reward exactly once. */
  dropRoomReward(roomId: string, x: number, y: number): void {
    if (this.state.rewards.has(roomId)) return;
    this.state.rewards.set(roomId, this.rollRoomReward(roomId, x, y));
  }

  /** Drop a reward pedestal where a boss died. Called once, on the boss's death
   *  tick, so it can't be farmed. */
  dropBossOffer(x: number, y: number): void {
    const room = this.dungeon.rooms.find((r) => r.type === "boss");
    if (!room || this.state.offers.has(room.id)) return;
    this.state.offers.set(room.id, this.rollOffer(room.id, x, y, "boss"));
  }

  /** A reward pedestal at the room's centre, for a challenge the party beat.
   *  Rolled at the "shrine" tier — a boon for a room well fought, not boss loot.
   *  The `has` guard means a challenge cannot grant twice. */
  dropChallengeReward(roomId: string): void {
    if (this.state.offers.has(roomId)) return;
    const room = this.dungeon.rooms.find((r) => r.id === roomId);
    if (!room) return;
    const pos = this.pedestalPos(room);
    this.state.offers.set(roomId, this.rollOffer(roomId, pos.x, pos.y, "shrine"));
  }

  // ---- player actions ------------------------------------------------------

  // Buy a shop pedestal from the shared party purse. Validated server-side: buyer
  // must stand near the pedestal, item unsold, and the purse must cover the cost.
  buy(player: Player, msg: { roomId: string; itemIndex: number }): string | null {
    const shop = this.state.shops.get(msg?.roomId);
    const item = shop?.items[msg?.itemIndex];
    if (!item || item.purchased) return null;
    if (!isNear(player, item.x, item.y)) return null;
    if (this.state.gold < item.cost) return null;
    const template = resolveTemplate(item.weaponId);
    if (!template) return null;
    // Wrong class for this weapon — refuse before charging or consuming, and tell
    // the buyer why (D9/D18). Party-filtered rolls can still surface a weapon a
    // teammate can use but this player cannot.
    if (!player.canEquip(template.id)) return WRONG_CLASS_MSG;
    // Already own an unmodified copy? Don't charge or consume the pedestal — a
    // teammate who lacks it may still want it (shared pool). Duplicate instances
    // are legal in general, but a shop weapon carries no modifiers, so a second
    // copy is strictly worthless gold spent. If shop pedestals ever roll modifiers
    // this guard stops matching on its own and buying two becomes a real choice.
    if (player.ownsUnmodified(template.id)) return null;
    player.addWeapon(template);
    this.state.gold -= item.cost;
    item.purchased = true;
    return null;
  }

  // Claim one of the pedestal's three shared cards (shrine boon / boss drop). The
  // whole party sees the same three, and picks are mutually exclusive: this player
  // may take one, and only a card no teammate has already taken. Two guards make it
  // safe against a racing or duplicated message, both processed one-after-another on
  // the single-threaded room: `claimedBy` refuses a second pick from the same player,
  // and `consumed` refuses a card another player already took (the second claimant
  // finds the index already present). Proximity is re-validated here; the client's
  // prompt is only a hint.
  offerPick(
    sessionId: string,
    player: Player,
    msg: { roomId: string; choiceIndex: number },
  ): string | null {
    const offer = this.state.offers.get(msg?.roomId);
    const index = msg?.choiceIndex;
    const choice = offer?.choices[index];
    if (!offer || !choice) return null;
    if (!isNear(player, offer.x, offer.y)) return null;
    // Already spent your one pick, or someone beat you to this card.
    if (offer.claimedBy.includes(sessionId)) return null;
    if (offer.consumed.includes(index)) return null;
    // Exhaustive on `kind` — a new choice kind is a compile error here, not a
    // silently-ignored pedestal.
    switch (choice.kind) {
      case "upgrade": {
        const upgrade = upgradeById(choice.upgradeId);
        if (!upgrade) return null;
        player.addUpgrade(upgrade);
        break;
      }
      case "weapon": {
        const template = resolveTemplate(choice.weapon.weaponId);
        if (!template) return null;
        // Wrong class — refuse WITHOUT consuming the card, so it's still there for
        // a teammate who can use it and this player can spend their pick elsewhere.
        if (!player.canEquip(template.id)) return WRONG_CLASS_MSG;
        // The rolled modifiers ride along on the choice (server-only field), so
        // the weapon granted is precisely the one previewed on the card — never
        // rebuilt from the synced labels.
        player.addWeapon(template, choice.mods);
        break;
      }
    }
    offer.consumed.push(index);
    offer.claimedBy.push(sessionId);
    return null;
  }

  // Claim a room-clear pedestal. Same shape as offerPick minus the choice —
  // `claimed` is the whole concurrency story, so a racing or duplicated message is a
  // no-op rather than a second reward. Proximity is re-validated here; the client's
  // prompt is only a hint. The kind switch is exhaustive so a new reward kind is a
  // compile error, not a silently-ignored pedestal.
  claimReward(player: Player, msg: { roomId: string }): string | null {
    const reward = this.state.rewards.get(msg?.roomId);
    if (!reward || reward.claimed) return null;
    if (!isNear(player, reward.x, reward.y)) return null;
    const err = this.grantReward(player, reward);
    if (err) return err;
    reward.claimed = true;
    return null;
  }

  // Claim a floor-1 supply pedestal — the SAME grant path as a room-clear reward
  // (a RewardState, always kind "weapon"), keyed by pedestal id instead of room id.
  // Class-gated, not owner-locked, so any player whose class fits can take it.
  claimSupply(player: Player, msg: { supplyId: string }): string | null {
    const reward = this.state.supplies.get(msg?.supplyId);
    if (!reward || reward.claimed) return null;
    if (!isNear(player, reward.x, reward.y)) return null;
    const err = this.grantReward(player, reward);
    if (err) return err;
    reward.claimed = true;
    return null;
  }

  /** Grant a single-reward pedestal's payload to a player, WITHOUT touching the
   *  pedestal's claimed/consumed flag (the caller owns that). Returns a user-facing
   *  error string when a weapon is refused for class, else null. The kind switch is
   *  exhaustive so a new reward kind is a compile error, not a silent miss. */
  private grantReward(player: Player, reward: RewardState): string | null {
    switch (reward.kind) {
      case "weapon": {
        const template = resolveTemplate(reward.weapon.weaponId);
        if (!template) return null;
        if (!player.canEquip(template.id)) return WRONG_CLASS_MSG;
        // The mods rolled at drop time ride along on the reward (server-only), so
        // the weapon granted is precisely the one previewed on the pedestal — a
        // second copy is a genuinely different weapon, so no ownsUnmodified guard.
        player.addWeapon(template, reward.mods);
        return null;
      }
      case "upgrade": {
        const upgrade = upgradeById(reward.upgradeId);
        if (!upgrade) return null;
        player.addUpgrade(upgrade);
        return null;
      }
      case "gold":
        this.state.gold += reward.gold;
        return null;
    }
  }

  // Open a maze chest. Same shape as claimReward minus the kinds — `opened` is the
  // whole concurrency story, so a racing or duplicated message is a no-op rather
  // than a second weapon. Proximity is re-validated here; the client's prompt is
  // only a hint. No ownsUnmodified guard like the shop has: a chest weapon always
  // carries rolled modifiers, so a second copy is a genuinely different weapon.
  chestOpen(player: Player, msg: { roomId: string }): string | null {
    const chest = this.state.chests.get(msg?.roomId);
    if (!chest || chest.opened || !chest.weaponId) return null;
    if (!isNear(player, chest.x, chest.y)) return null;

    const template = resolveTemplate(chest.weaponId);
    if (!template) return null;
    // Wrong class — leave the chest closed (and unspoiled) so a teammate who can
    // use it still opens it.
    if (!player.canEquip(template.id)) return WRONG_CLASS_MSG;
    // The mods rolled at floor generation are handed over as-is, so the weapon
    // granted is the one the chest has been holding all along.
    player.addWeapon(template, chest.mods);
    chest.opened = true;
    return null;
  }

  // ---- rolling -------------------------------------------------------------

  // Build a shared 1-of-3. A shrine leans on upgrades (permanent, build-defining); a
  // boss drop leans on a rolled weapon, so beating a boss feels like loot rather than
  // another stat bump. Both draw upgrades from the floor-legal pool. Every player in
  // the party sees this same set and drafts one card each (see offerPick).
  private rollOffer(roomId: string, x: number, y: number, tier: "shrine" | "boss"): OfferState {
    const offer = new OfferState();
    offer.roomId = roomId;
    offer.x = x;
    offer.y = y;
    // Every pedestal is FREE — shrine, boss and challenge alike. Gold is spent at
    // shops and nowhere else; a reward you fought for never asks for payment.

    // Each choice carries its own rolled modifiers, so shuffling can't desync the
    // card from the reward — there is nothing to keep aligned.
    const choices: OfferChoiceState[] = [];
    const weaponCount = tier === "boss" ? 2 : 1;
    for (let i = 0; i < weaponCount; i++) choices.push(this.rollWeaponChoice());

    const pool = upgradePool(this.state.floor);
    shuffle(pool);
    for (const upgrade of pool.slice(0, OFFER_CHOICES - choices.length)) {
      const choice = new OfferChoiceState();
      choice.kind = "upgrade";
      choice.upgradeId = upgrade.id;
      choice.name = upgrade.name;
      choice.description = upgrade.description;
      choices.push(choice);
    }
    shuffle(choices);

    for (const choice of choices) offer.choices.push(choice);
    return offer;
  }

  // A single-weapon RewardState carrying one rolled modifier, resolved so the
  // pedestal previews the exact stats the claimer receives. Shared by the room-clear
  // weapon reward and the supply pedestals (which are just a fixed weapon id).
  private buildWeaponReward(roomId: string, x: number, y: number, weaponId: WeaponId): RewardState {
    const reward = new RewardState();
    reward.roomId = roomId;
    reward.x = x;
    reward.y = y;
    const template = WEAPON_REGISTRY[weaponId];
    const mods = [rollWeaponMod(this.state.floor)];
    const preview = new WeaponInstance(template, "preview", mods);
    reward.kind = "weapon";
    reward.name = template.name;
    reward.description = mods.map((m) => m.label).join(", ");
    reward.weapon = slotStateFor(preview);
    reward.mods = mods;
    return reward;
  }

  // Roll one room-clear reward: a weighted pick over weapon / upgrade / gold. The
  // weapon and gold branches always succeed; the upgrade branch falls back to gold
  // if the floor-legal pool is exhausted (every upgrade already taken), so a late
  // floor never drops an empty pedestal.
  private rollRoomReward(roomId: string, x: number, y: number): RewardState {
    const reward = new RewardState();
    reward.roomId = roomId;
    reward.x = x;
    reward.y = y;

    const kind = this.pickRewardKind();

    if (kind === "weapon") {
      return this.buildWeaponReward(roomId, x, y, this.rollShopWeapons(1)[0]);
    }

    if (kind === "upgrade") {
      const pool = upgradePool(this.state.floor);
      if (pool.length > 0) {
        const upgrade = pool[Math.floor(Math.random() * pool.length)];
        reward.kind = "upgrade";
        reward.upgradeId = upgrade.id;
        reward.name = upgrade.name;
        reward.description = upgrade.description;
        return reward;
      }
      // Pool exhausted (every upgrade already taken) — fall back to a gold payout
      // so the pedestal is never empty.
    }

    reward.kind = "gold";
    reward.gold = ROOM_REWARD_GOLD;
    reward.name = "Gold";
    reward.description = `${ROOM_REWARD_GOLD}g`;
    return reward;
  }

  // Weighted pick over the reward kinds (see ROOM_REWARD_WEIGHTS).
  private pickRewardKind(): "weapon" | "upgrade" | "gold" {
    const total = ROOM_REWARD_WEIGHTS.reduce((n, e) => n + e.weight, 0);
    let roll = Math.random() * total;
    for (const entry of ROOM_REWARD_WEIGHTS) {
      roll -= entry.weight;
      if (roll < 0) return entry.kind;
    }
    return "gold";
  }

  // A random weapon carrying one rolled modifier. The preview instance synced to
  // the card and the weapon handed to Player.addWeapon on pick are built from the
  // SAME mods array (held on the choice), so the card cannot show stats the reward
  // won't have.
  private rollWeaponChoice(): OfferChoiceState {
    const template = WEAPON_REGISTRY[this.rollShopWeapons(1)[0]];
    const mods = [rollWeaponMod(this.state.floor)];
    const preview = new WeaponInstance(template, "preview", mods);
    const choice = new OfferChoiceState();
    choice.kind = "weapon";
    choice.name = template.name;
    choice.description = mods.map((m) => m.label).join(", ");
    choice.weapon = slotStateFor(preview);
    choice.mods = mods;
    return choice;
  }

  // Pick N distinct weapon ids uniformly (partial Fisher–Yates from the front),
  // drawing only from what the PRESENT party can use (D10) so a weapon nobody can
  // equip never rolls. All shared loot — shops, chests, offer/reward weapon
  // choices — routes through here, so the filter is applied in exactly one place.
  private rollShopWeapons(n: number): WeaponId[] {
    return pickDistinct(partyRollableWeaponIds(this.partyClasses()), n);
  }

  // ---- geometry ------------------------------------------------------------

  /** Where a single-pedestal room puts its prop: the room's center tile, nudged
   *  off the stairs. Shared by shrines and challenge rewards so both
   *  land in the same spot. */
  private pedestalPos(room: RoomData): { x: number; y: number } {
    return tileCenter(this.freeShopCol(room.centerCol, room.centerRow), room.centerRow);
  }

  // Nearest column to `col` on `row` whose tile isn't the stairs, so a pedestal
  // never hides the way down. Shop rooms are fully carved, so a ±2 search always
  // finds open floor.
  private freeShopCol(col: number, row: number): number {
    const { mapData } = this.dungeon;
    for (const offset of [0, -1, 1, -2, 2]) {
      if (mapData[row]?.[col + offset] === TILE.FLOOR) return col + offset;
    }
    return col;
  }
}

/** A rough quality score for ordering a shop's three pedestals into the fixed
 *  price tiers. Melee weapons carry their damage directly; a ranged weapon's own
 *  `damage` is only a flat bonus on top of its ammo, so fold the ammo's base
 *  damage in too or every bow would sort as the cheapest thing on the floor. This
 *  decides ORDER only — the actual prices are the fixed SHOP_TIERS. */
function weaponQuality(w: Weapon): number {
  const ammoBase = w.ammoId ? (AMMO_REGISTRY[w.ammoId]?.damage ?? 0) : 0;
  return w.damage + ammoBase;
}

/** Shared proximity gate for all three loot interactions. */
function isNear(player: Player, x: number, y: number): boolean {
  const dx = player.state.x - x;
  const dy = player.state.y - y;
  return dx * dx + dy * dy <= BUY_RADIUS * BUY_RADIUS;
}

/** In-place Fisher–Yates. Used for offer choices so a weapon isn't always slot 0. */
function shuffle<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

/** Up to `n` distinct items drawn uniformly (partial Fisher–Yates from the front),
 *  without mutating the source. */
function pickDistinct<T>(pool: readonly T[], n: number): T[] {
  const all = [...pool];
  const count = Math.min(n, all.length);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(Math.random() * (all.length - i));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, count);
}
