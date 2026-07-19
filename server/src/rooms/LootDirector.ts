import {
  TILE, TILE_SIZE, tileCenter,
  DungeonResult, RoomData,
  WEAPON_REGISTRY, WeaponId, WeaponInstance,
} from "shared";
import { GameState } from "../schema/GameState";
import { ShopState, ShopItemState } from "../schema/ShopState";
import { OfferState, OfferChoiceState } from "../schema/OfferState";
import { ChestState } from "../schema/ChestState";
import { Player, resolveTemplate, slotStateFor } from "../entities/Player";
import { upgradeById, upgradePool, rollWeaponMod } from "../upgrades";

const SHOP_ITEM_COUNT = 3;
// How many choices a reward pedestal presents.
const OFFER_CHOICES = 3;
// How close (px) a player must stand to a pedestal to buy it.
const BUY_RADIUS = 40;
// Chance a chest room's chest is the rarer gold one.
const GOLD_CHEST_CHANCE = 0.15;
// Modifiers rolled onto the weapon inside a chest. A chest is pure loot — even the
// common one is enchanted, which is what makes it read differently from a shop's
// plain stock; gold just rolls a second modifier on top.
const BROWN_CHEST_MODS = 1;
const GOLD_CHEST_MODS = 2;

const ALL_WEAPON_IDS = Object.keys(WEAPON_REGISTRY) as WeaponId[];

/** Everything reward-shaped: shops, shrine/boss offers, and chests — placement at
 *  floor generation, and the validate-then-grant half of the three player-facing
 *  loot messages. GameRoom owns one of these and delegates; it knows nothing about
 *  Colyseus beyond the GameState it writes into. */
export class LootDirector {
  private dungeon!: DungeonResult;

  constructor(private readonly state: GameState) {}

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
      const ids = this.rollShopWeapons(SHOP_ITEM_COUNT);
      // Lay pedestals in a row along the room's (always-carved) center row. The
      // generator keeps the stairs out of shop rooms, but a debug floor can force
      // every room to "shop" — nudge any pedestal that would cover the stairs.
      const cols = [room.centerCol - 3, room.centerCol, room.centerCol + 3]
        .map((col) => this.freeShopCol(col, room.centerRow));
      ids.forEach((wid, i) => {
        const w = WEAPON_REGISTRY[wid];
        const item = new ShopItemState();
        item.weaponId = wid;
        item.cost = Math.min(30, Math.max(8, Math.round(w.damage * 1.4)));
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

  // One chest at the center of every chest room. Like a shrine the room spawns no
  // enemies and is pre-cleared by finalizeEmptyRooms, so the chest is reachable the
  // moment the player walks in — the room IS the reward.
  spawnChests() {
    this.state.chests.clear();
    for (const room of this.dungeon.rooms) {
      if (room.type !== "chest") continue;
      const pos = this.pedestalPos(room);
      const chest = new ChestState();
      chest.roomId = room.id;
      chest.x = pos.x;
      chest.y = pos.y;
      chest.gold = Math.random() < GOLD_CHEST_CHANCE;

      // Roll the contents now, at floor generation, rather than on open. The
      // weapon a chest holds is fixed the moment the floor exists, so opening it
      // can't be re-rolled by walking away and coming back.
      chest.weaponId = this.rollShopWeapons(1)[0];
      const modCount = chest.gold ? GOLD_CHEST_MODS : BROWN_CHEST_MODS;
      for (let i = 0; i < modCount; i++) chest.mods.push(rollWeaponMod(this.state.floor));

      this.state.chests.set(room.id, chest);
    }
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

  // Buy a shop pedestal (spend HP, shared team pool). Validated server-side:
  // buyer must stand near the pedestal, item unsold, and HP > cost (never lethal).
  buy(player: Player, msg: { roomId: string; itemIndex: number }): void {
    const shop = this.state.shops.get(msg?.roomId);
    const item = shop?.items[msg?.itemIndex];
    if (!item || item.purchased) return;
    if (!isNear(player, item.x, item.y)) return;
    if (player.state.health <= item.cost) return;
    const template = resolveTemplate(item.weaponId);
    if (!template) return;
    // Already own an unmodified copy? Don't charge or consume the pedestal — a
    // teammate who lacks it may still want it (shared pool). Duplicate instances
    // are legal in general, but a shop weapon carries no modifiers, so a second
    // copy is strictly worthless HP spent. If shop pedestals ever roll modifiers
    // this guard stops matching on its own and buying two becomes a real choice.
    if (player.ownsUnmodified(template.id)) return;
    player.addWeapon(template);
    player.spendHp(item.cost);
    item.purchased = true;
  }

  // Claim a reward pedestal (shrine boon / boss drop). Unlike a shop this is
  // free, irreversible, and first-come — `claimed` is the whole concurrency
  // story, so a duplicated or racing message is harmless rather than a
  // double-grant. Proximity is re-validated here; the client's prompt is only a
  // hint.
  offerPick(player: Player, msg: { roomId: string; choiceIndex: number }): void {
    const offer = this.state.offers.get(msg?.roomId);
    const choice = offer?.choices[msg?.choiceIndex];
    if (!offer || !choice || offer.claimed) return;
    if (!isNear(player, offer.x, offer.y)) return;

    // Exhaustive on `kind` — a new choice kind is a compile error here, not a
    // silently-ignored pedestal.
    switch (choice.kind) {
      case "upgrade": {
        const upgrade = upgradeById(choice.upgradeId);
        if (!upgrade) return;
        player.addUpgrade(upgrade);
        break;
      }
      case "weapon": {
        const template = resolveTemplate(choice.weapon.weaponId);
        if (!template) return;
        // The rolled modifiers ride along on the choice (server-only field), so
        // the weapon granted is precisely the one previewed on the card — never
        // rebuilt from the synced labels.
        player.addWeapon(template, choice.mods);
        break;
      }
    }
    offer.claimed = true;
  }

  // Open a chest. Same shape as offerPick minus the choice — `opened` is the
  // whole concurrency story, so a racing or duplicated message is a no-op rather
  // than a second weapon. Proximity is re-validated here; the client's prompt is
  // only a hint. No ownsUnmodified guard like the shop has: a chest weapon always
  // carries rolled modifiers, so a second copy is a genuinely different weapon.
  chestOpen(player: Player, msg: { roomId: string }): void {
    const chest = this.state.chests.get(msg?.roomId);
    if (!chest || chest.opened || !chest.weaponId) return;
    if (!isNear(player, chest.x, chest.y)) return;

    const template = resolveTemplate(chest.weaponId);
    if (!template) return;
    // The mods rolled at floor generation are handed over as-is, so the weapon
    // granted is the one the chest has been holding all along.
    player.addWeapon(template, chest.mods);
    chest.opened = true;
  }

  // ---- rolling -------------------------------------------------------------

  // Build a 1-of-3. A shrine leans on upgrades (permanent, build-defining); a boss
  // drop leans on a rolled weapon, so beating a boss feels like loot rather than
  // another stat bump. Both draw upgrades from the floor-legal pool.
  private rollOffer(roomId: string, x: number, y: number, tier: "shrine" | "boss"): OfferState {
    const offer = new OfferState();
    offer.roomId = roomId;
    offer.x = x;
    offer.y = y;

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

  // Pick N distinct weapon ids uniformly (partial Fisher–Yates from the front).
  private rollShopWeapons(n: number): WeaponId[] {
    const all = [...ALL_WEAPON_IDS];
    const count = Math.min(n, all.length);
    for (let i = 0; i < count; i++) {
      const j = i + Math.floor(Math.random() * (all.length - i));
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all.slice(0, count);
  }

  // ---- geometry ------------------------------------------------------------

  /** Where a single-pedestal room puts its prop: the room's center tile, nudged
   *  off the stairs. Shared by shrines, chests, and challenge rewards so all three
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
