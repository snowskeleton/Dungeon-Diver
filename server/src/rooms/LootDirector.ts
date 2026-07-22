import {
  TILE, TILE_SIZE, tileCenter,
  DungeonResult, RoomData,
  WEAPON_REGISTRY, WeaponId, WeaponInstance,
} from "shared";
import { GameState } from "../schema/GameState";
import { ShopState, ShopItemState } from "../schema/ShopState";
import {
  OfferState,
  OfferChoiceState,
  PlayerOfferState,
} from "../schema/OfferState";
import { ChestState } from "../schema/ChestState";
import { Player, resolveTemplate, slotStateFor } from "../entities/Player";
import { upgradeById, upgradePool, rollWeaponMod } from "../upgrades";
import { PhysicsWorld } from "../physics/PhysicsWorld";

const SHOP_ITEM_COUNT = 3;
// How many choices a reward pedestal presents.
const OFFER_CHOICES = 3;
// How close (px) a player must stand to a pedestal to buy it.
const BUY_RADIUS = 40;
// The chest's collision box. Matches the 28px sprite the client draws (see
// ChestEntity), kept a little shorter so a player can press up against its front
// face and still be inside interact range.
const CHEST_SOLID_W = 26;
const CHEST_SOLID_H = 20;

// Chance a chest room's chest is the rarer gold one.
const GOLD_CHEST_CHANCE = 0.15;
// Modifiers rolled onto the weapon inside a chest. A chest is pure loot — even the
// common one is enchanted, which is what makes it read differently from a shop's
// plain stock; gold just rolls a second modifier on top.
const BROWN_CHEST_MODS = 1;
const GOLD_CHEST_MODS = 2;

const ALL_WEAPON_IDS = Object.keys(WEAPON_REGISTRY) as WeaponId[];

/** One floor-legal upgrade instance — the element type `upgradePool` deals out. */
type UpgradePoolItem = ReturnType<typeof upgradePool>[number];

/** Everything reward-shaped: shops, shrine/boss offers, and chests — placement at
 *  floor generation, and the validate-then-grant half of the three player-facing
 *  loot messages. GameRoom owns one of these and delegates; it knows nothing about
 *  Colyseus beyond the GameState it writes into. */
export class LootDirector {
  private dungeon!: DungeonResult;

  constructor(private readonly state: GameState) {}

  /** The floor's physics world. Handed over in setFloor rather than the
   *  constructor because GameRoom builds the PhysicsWorld from the first
   *  generated floor, which happens after the directors exist — the same reason
   *  SpawnDirector takes it here. */
  private physics!: PhysicsWorld;

  /** Point at the newly generated floor. Called from GameRoom.initFloor before any
   *  of the spawn methods. */
  setFloor(dungeon: DungeonResult, physics: PhysicsWorld) {
    this.dungeon = dungeon;
    this.physics = physics;
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

      // Solid: you used to walk straight through a chest (playtest B8). Sized to
      // the drawn sprite, and slightly shorter than it is wide so you can stand
      // close enough to the front of it to interact.
      this.physics.addSolidProp(room.id, pos.x, pos.y, CHEST_SOLID_W, CHEST_SOLID_H);

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

  // Claim a card from a reward pedestal (shrine boon / boss drop). Every player has
  // their OWN draft on the pedestal, so the pick is resolved against the sender's
  // slice (keyed by session id), not a single shared `claimed`. Two things make it
  // safe against a racing or duplicated message: the per-player `claimed` flag
  // refuses a second grant to the same player, and the party-wide `consumed` set
  // refuses any card whose item another player already took — the two claims are
  // processed one after the other on the single-threaded room, so the second sees
  // the first's identity already in `consumed`. Proximity is re-validated here; the
  // client's prompt is only a hint.
  offerPick(
    sessionId: string,
    player: Player,
    msg: { roomId: string; choiceIndex: number },
  ): void {
    const offer = this.state.offers.get(msg?.roomId);
    const draft = offer?.players.get(sessionId);
    const choice = draft?.choices[msg?.choiceIndex];
    if (!offer || !draft || !choice || draft.claimed) return;
    if (!isNear(player, offer.x, offer.y)) return;
    // Someone in the party already drafted this exact item — it's spent.
    if (offer.consumed.includes(choice.identity)) return;

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
    draft.claimed = true;
    offer.consumed.push(choice.identity);
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

  // Build a pedestal's worth of per-player 1-of-3 drafts. A shrine leans on upgrades
  // (permanent, build-defining); a boss drop leans on a rolled weapon, so beating a
  // boss feels like loot rather than another stat bump. Both draw upgrades from the
  // floor-legal pool.
  //
  // The party drafts against each other: no two players are offered the same weapon
  // (weapons are drawn distinct across the whole party from the 50+ ids), and
  // upgrades are dealt distinct across the party while the pool lasts, only repeating
  // once it's exhausted — a small floor-1 pool with a full party. Because every
  // player keeps at least one exclusive weapon card, a player can never be left with
  // nothing pickable no matter what the rest of the party claims first.
  private rollOffer(roomId: string, x: number, y: number, tier: "shrine" | "boss"): OfferState {
    const offer = new OfferState();
    offer.roomId = roomId;
    offer.x = x;
    offer.y = y;

    // The party as it stands right now. Shrines roll at floor start and boss/challenge
    // drops mid-run — the room is locked once the run begins, so this roster is fixed.
    const sessionIds = [...this.state.players.keys()];
    const weaponsPer = tier === "boss" ? 2 : 1;
    const upgradesPer = OFFER_CHOICES - weaponsPer;

    // Distinct weapon ids for the whole party, so a weapon card is exclusive to the
    // one player who holds it — that exclusivity is the anti-softlock guarantee.
    const weaponIds = this.rollShopWeapons(weaponsPer * sessionIds.length);
    const upgrades = this.upgradeDealer();

    let wi = 0;
    for (const sessionId of sessionIds) {
      const draft = new PlayerOfferState();
      const choices: OfferChoiceState[] = [];
      for (let i = 0; i < weaponsPer; i++) {
        choices.push(this.weaponChoiceFor(weaponIds[wi++]));
      }
      for (const upgrade of upgrades(upgradesPer)) {
        const choice = new OfferChoiceState();
        choice.kind = "upgrade";
        choice.upgradeId = upgrade.id;
        choice.name = upgrade.name;
        choice.description = upgrade.description;
        choice.identity = `upgrade:${upgrade.id}`;
        choices.push(choice);
      }
      shuffle(choices);
      for (const choice of choices) draft.choices.push(choice);
      offer.players.set(sessionId, draft);
    }
    return offer;
  }

  // A weapon card for a given id, carrying one rolled modifier. The preview instance
  // synced to the card and the weapon handed to Player.addWeapon on pick are built
  // from the SAME mods array (held on the choice), so the card cannot show stats the
  // reward won't have.
  private weaponChoiceFor(weaponId: WeaponId): OfferChoiceState {
    const template = WEAPON_REGISTRY[weaponId];
    const mods = [rollWeaponMod(this.state.floor)];
    const preview = new WeaponInstance(template, "preview", mods);
    const choice = new OfferChoiceState();
    choice.kind = "weapon";
    choice.name = template.name;
    choice.description = mods.map((m) => m.label).join(", ");
    choice.weapon = slotStateFor(preview);
    choice.mods = mods;
    choice.identity = `weapon:${template.id}`;
    return choice;
  }

  // A dealer that hands out upgrades distinct across the party while the floor pool
  // lasts, then repeats (still distinct within each player's own hand). Each call
  // returns `n` upgrades for one player.
  private upgradeDealer(): (n: number) => UpgradePoolItem[] {
    const pool = upgradePool(this.state.floor);
    const unused = [...pool];
    shuffle(unused);
    return (n: number) => {
      const hand: typeof pool = [];
      const taken = new Set<string>();
      while (hand.length < n) {
        // Prefer a party-fresh upgrade this player doesn't already hold.
        let idx = unused.findIndex((u) => !taken.has(u.id));
        if (idx >= 0) {
          const [pick] = unused.splice(idx, 1);
          taken.add(pick.id);
          hand.push(pick);
          continue;
        }
        // Pool exhausted party-wide — fall back to any pool upgrade not already in
        // this player's hand, so a hand still has no internal duplicates.
        const fresh = pool.filter((u) => !taken.has(u.id));
        if (fresh.length === 0) break;
        const pick = fresh[Math.floor(Math.random() * fresh.length)];
        taken.add(pick.id);
        hand.push(pick);
      }
      return hand;
    };
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
