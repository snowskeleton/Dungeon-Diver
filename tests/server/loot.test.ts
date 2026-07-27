import { describe, it, expect } from "vitest";
import {
  generateDungeon,
  WEAPON_REGISTRY,
  WeaponId,
  RoomType,
  DungeonResult,
  TILE,
  TILE_SIZE,
  mazeDeepestTile,
  CharacterClass,
  DEFAULT_DEBUG_CONFIG,
} from "shared";
import { LootDirector, WRONG_CLASS_MSG } from "../../server/src/rooms/LootDirector";
import { GameState } from "../../server/src/schema/GameState";
import { Player } from "../../server/src/entities/Player";
import { PhysicsWorld } from "../../server/src/physics/PhysicsWorld";

// Loot is where a bad guard costs a player real progress: a double-granted
// reward, an HP charge for nothing, or a pedestal that kills the buyer. Every
// grant path is driven through its validate-then-grant surface.

function floor(type: RoomType, floorNumber = 1) {
  const dungeon: DungeonResult = generateDungeon(1, { showcaseRoomType: type });
  const physics = new PhysicsWorld(dungeon.mapData, dungeon.cols, dungeon.rows);
  const state = new GameState();
  state.floor = floorNumber;
  // Fund the shared purse generously: these tests exercise proximity, dedup, and
  // the shared-draft rules, not affordability (the gold sinks have their own suite
  // in economy.test.ts). An empty purse would make every buy/shrine-pick a no-op.
  state.gold = 100000;
  // A single-knight party so the D10 loot filter rolls knight-usable weapons and
  // the knight buyers below can equip everything a pedestal offers. Position is
  // irrelevant — the map is only read for party composition.
  const players = new Map<string, Player>();
  players.set("party", new Player(physics, x0, y0, "knight", "guy"));
  const loot = new LootDirector(state, players);
  loot.setFloor(dungeon, physics);
  const room = dungeon.rooms.find(r => r.type === type)!;
  return { dungeon, physics, state, loot, room, players };
}

// A parking spot for the party-composition player, off in a corner of the floor.
const x0 = TILE_SIZE * 2;
const y0 = TILE_SIZE * 2;

/** A knight standing exactly on a pedestal, so proximity always passes. Starts
 *  empty-handed (no default weapon), like every player now. */
function playerAt(physics: PhysicsWorld, x: number, y: number) {
  return new Player(physics, x, y, "knight", "guy");
}

describe("shops", () => {
  function shopFloor() {
    const f = floor("shop");
    f.loot.spawnShops();
    return { ...f, shop: f.state.shops.get(f.room.id)! };
  }

  it("stocks every shop room with pedestals", () => {
    const { shop } = shopFloor();
    expect(shop.items.length).toBeGreaterThan(0);
    for (const item of shop.items) {
      expect(WEAPON_REGISTRY[item.weaponId], item.weaponId).toBeDefined();
      expect(item.cost).toBeGreaterThan(0);
      expect(item.purchased).toBe(false);
    }
  });

  it("never stocks the same weapon twice in one shop", () => {
    for (let seed = 0; seed < 30; seed++) {
      const { shop } = shopFloor();
      const ids = [...shop.items].map(i => i!.weaponId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("never lays a pedestal on the stairs", () => {
    const { shop, dungeon } = shopFloor();
    for (const item of shop.items) {
      const col = Math.floor(item.x / 32);
      const row = Math.floor(item.y / 32);
      expect(dungeon.mapData[row][col]).not.toBe(TILE.STAIRS);
    }
  });

  it("clears the previous floor's stock when a new floor is built", () => {
    const f = shopFloor();
    f.loot.spawnShops();
    expect(f.state.shops.size).toBe(1);
  });

  it("sells a weapon for gold to a player standing at the pedestal", () => {
    const { shop, loot, state, physics, room } = shopFloor();
    const item = shop.items[0];
    const p = playerAt(physics, item!.x, item!.y);
    const hp0 = p.state.health;
    const gold0 = state.gold;

    loot.buy(p, { roomId: room.id, itemIndex: 0 });

    expect(p.weapons.map(w => w.id)).toContain(item!.weaponId);
    // Gold comes out of the shared purse; the buyer's HP is untouched.
    expect(state.gold).toBe(gold0 - item!.cost);
    expect(p.state.health).toBe(hp0);
    expect(item!.purchased).toBe(true);
  });

  it("refuses a player standing too far away", () => {
    const { shop, loot, physics, room } = shopFloor();
    const item = shop.items[0];
    const p = playerAt(physics, item!.x + 500, item!.y);

    loot.buy(p, { roomId: room.id, itemIndex: 0 });

    expect(p.weapons).toHaveLength(0);
    expect(item!.purchased).toBe(false);
  });

  it("refuses a second purchase of an already-sold pedestal", () => {
    const { shop, loot, physics, room } = shopFloor();
    const item = shop.items[0];
    const buyer = playerAt(physics, item!.x, item!.y);
    const latecomer = playerAt(physics, item!.x, item!.y);
    loot.buy(buyer, { roomId: room.id, itemIndex: 0 });

    loot.buy(latecomer, { roomId: room.id, itemIndex: 0 });

    expect(latecomer.weapons).toHaveLength(0);
  });

  it("refuses a purchase the shared purse can't cover", () => {
    const { shop, loot, state, physics, room } = shopFloor();
    const item = shop.items[0];
    const p = playerAt(physics, item!.x, item!.y);
    state.gold = item!.cost - 1; // one short

    loot.buy(p, { roomId: room.id, itemIndex: 0 });

    expect(state.gold).toBe(item!.cost - 1); // not charged
    expect(item!.purchased).toBe(false);
    expect(p.weapons).toHaveLength(0); // nothing granted
  });

  it("refuses to charge for an unmodified duplicate the player already owns", () => {
    const { shop, loot, physics, room } = shopFloor();
    const item = shop.items[0];
    const p = playerAt(physics, item!.x, item!.y);
    p.addWeapon(WEAPON_REGISTRY[item!.weaponId]);
    const hp0 = p.state.health;

    loot.buy(p, { roomId: room.id, itemIndex: 0 });

    expect(p.state.health).toBe(hp0);
    // ...and the pedestal stays available for a teammate who lacks it.
    expect(item!.purchased).toBe(false);
  });

  it("shrugs off a malformed or out-of-range buy message", () => {
    const { loot, physics, room } = shopFloor();
    const p = playerAt(physics, 0, 0);
    expect(() => {
      loot.buy(p, { roomId: "nope", itemIndex: 0 });
      loot.buy(p, { roomId: room.id, itemIndex: 99 });
      loot.buy(p, { roomId: room.id, itemIndex: -1 });
      loot.buy(p, undefined as never);
    }).not.toThrow();
    expect(p.weapons).toHaveLength(0);
  });
});

describe("reward pedestals", () => {
  function shrineFloor() {
    const f = floor("shrine");
    f.loot.spawnShrineOffers();
    return { ...f, offer: f.state.offers.get(f.room.id)! };
  }

  it("puts one offer in every shrine room, with three choices", () => {
    const { offer } = shrineFloor();
    expect(offer.choices).toHaveLength(3);
    for (const c of offer.choices) {
      expect(["upgrade", "weapon"]).toContain(c.kind);
      expect(c.name.length).toBeGreaterThan(0);
    }
  });

  it("grants an upgrade or a weapon when a nearby player picks a card", () => {
    const { offer, loot, physics, room } = shrineFloor();
    const p = playerAt(physics, offer.x, offer.y);
    const before = { weapons: p.weapons.length, upgrades: p.upgrades.length };

    loot.offerPick("s1", p, { roomId: room.id, choiceIndex: 0 });

    const gained = (p.weapons.length - before.weapons) + (p.upgrades.length - before.upgrades);
    expect(gained).toBe(1);
    expect([...offer.consumed]).toEqual([0]);
    expect([...offer.claimedBy]).toEqual(["s1"]);
  });

  it("gives a picked WEAPON exactly the stats its card previewed", () => {
    // The card's rolled modifiers ride on the choice as a server-only field, so
    // the reward can never differ from the preview.
    for (let attempt = 0; attempt < 20; attempt++) {
      const { offer, loot, physics, room } = shrineFloor();
      const index = [...offer.choices].findIndex(c => c!.kind === "weapon");
      if (index < 0) continue;
      const previewed = offer.choices[index]!.weapon;
      const p = playerAt(physics, offer.x, offer.y);

      loot.offerPick("s1", p, { roomId: room.id, choiceIndex: index });

      const got = p.weapons[p.weapons.length - 1];
      expect(got.id).toBe(previewed.weaponId);
      expect(got.damage).toBe(previewed.damage);
      expect(got.modLabels).toEqual([...previewed.modLabels]);
      return;
    }
    throw new Error("no shrine offer contained a weapon in 20 attempts");
  });

  it("gives each player exactly one pick", () => {
    const { offer, loot, physics, room } = shrineFloor();
    const p = playerAt(physics, offer.x, offer.y);
    loot.offerPick("s1", p, { roomId: room.id, choiceIndex: 0 });
    const after = p.weapons.length + p.upgrades.length;

    loot.offerPick("s1", p, { roomId: room.id, choiceIndex: 1 });

    expect(p.weapons.length + p.upgrades.length).toBe(after);
    expect([...offer.consumed]).toEqual([0]);
  });

  it("makes picks mutually exclusive across the party", () => {
    const { offer, loot, physics, room } = shrineFloor();
    const a = playerAt(physics, offer.x, offer.y);
    const b = playerAt(physics, offer.x, offer.y);
    loot.offerPick("s1", a, { roomId: room.id, choiceIndex: 0 });

    const beforeB = b.weapons.length + b.upgrades.length;
    loot.offerPick("s2", b, { roomId: room.id, choiceIndex: 0 }); // same card
    expect(b.weapons.length + b.upgrades.length).toBe(beforeB);

    loot.offerPick("s2", b, { roomId: room.id, choiceIndex: 1 }); // a free one
    expect(b.weapons.length + b.upgrades.length).toBe(beforeB + 1);
  });

  it("lets at most three items leave one pedestal", () => {
    const { offer, loot, physics, room } = shrineFloor();
    let granted = 0;
    for (let i = 0; i < 6; i++) {
      const p = playerAt(physics, offer.x, offer.y);
      const before = p.weapons.length + p.upgrades.length;
      loot.offerPick(`s${i}`, p, { roomId: room.id, choiceIndex: i % 3 });
      granted += (p.weapons.length + p.upgrades.length) - before;
    }
    expect(granted).toBe(3);
    expect(offer.consumed).toHaveLength(3);
  });

  it("refuses a pick from a player standing away from the pedestal", () => {
    const { offer, loot, physics, room } = shrineFloor();
    const p = playerAt(physics, offer.x + 500, offer.y);
    loot.offerPick("s1", p, { roomId: room.id, choiceIndex: 0 });
    expect(offer.consumed).toHaveLength(0);
  });

  it("shrugs off a malformed pick message", () => {
    const { loot, physics, room } = shrineFloor();
    const p = playerAt(physics, 0, 0);
    expect(() => {
      loot.offerPick("s1", p, { roomId: "nope", choiceIndex: 0 });
      loot.offerPick("s1", p, { roomId: room.id, choiceIndex: 99 });
      loot.offerPick("s1", p, undefined as never);
    }).not.toThrow();
  });

  it("leans a boss drop toward weapons and a shrine toward upgrades", () => {
    // Beating a boss should read as loot, not another stat bump.
    const countWeapons = (mk: (l: LootDirector, roomId: string) => void) => {
      let n = 0;
      for (let i = 0; i < 40; i++) {
        const f = floor("boss");
        mk(f.loot, f.room.id);
        const offer = f.state.offers.get(f.room.id)!;
        n += [...offer.choices].filter(c => c!.kind === "weapon").length;
      }
      return n;
    };
    const boss = countWeapons((l) => l.dropBossOffer(500, 500));
    const shrine = countWeapons((l, id) => l.dropChallengeReward(id));
    expect(boss).toBeGreaterThan(shrine);
  });

  it("drops a boss offer only once, so it cannot be farmed", () => {
    const f = floor("boss");
    f.loot.dropBossOffer(500, 500);
    const first = f.state.offers.get(f.room.id);
    f.loot.dropBossOffer(600, 600);
    expect(f.state.offers.get(f.room.id)).toBe(first);
  });

  it("drops a challenge reward only once, and only for a real room", () => {
    const f = floor("timed");
    f.loot.dropChallengeReward(f.room.id);
    const first = f.state.offers.get(f.room.id);
    f.loot.dropChallengeReward(f.room.id);
    expect(f.state.offers.get(f.room.id)).toBe(first);

    f.loot.dropChallengeReward("9,9");
    expect(f.state.offers.has("9,9")).toBe(false);
  });

  it("offers only upgrades legal on the current floor", () => {
    for (let i = 0; i < 30; i++) {
      const f = floor("shrine", 1);
      f.loot.spawnShrineOffers();
      const offer = f.state.offers.get(f.room.id)!;
      for (const c of offer.choices) {
        if (c.kind !== "upgrade") continue;
        expect(["vitality", "ferocity", "bloodthirst", "berserk"]).not.toContain(c.upgradeId);
      }
    }
  });
});

describe("room-clear rewards", () => {
  const RX = 500;
  const RY = 500;

  // Drop one reward pedestal at (RX, RY), keyed "r". The kind is a weighted roll
  // over weapon/upgrade/gold, so a caller who needs a specific kind re-rolls.
  function rewardFloor() {
    const f = floor("combat");
    f.loot.dropRoomReward("r", RX, RY);
    return { ...f, reward: f.state.rewards.get("r")! };
  }

  function rewardOfKind(kind: "weapon" | "upgrade" | "gold") {
    for (let i = 0; i < 1000; i++) {
      const f = rewardFloor();
      if (f.reward.kind === kind) return f;
    }
    throw new Error(`never rolled a ${kind} reward`);
  }

  it("drops a well-formed, unclaimed reward on clear", () => {
    const { reward } = rewardFloor();
    expect(["weapon", "upgrade", "gold"]).toContain(reward.kind);
    expect(reward.name.length).toBeGreaterThan(0);
    expect(reward.claimed).toBe(false);
  });

  it("only drops once per room, however many enemies fall", () => {
    const { loot, state, reward } = rewardFloor();
    loot.dropRoomReward("r", 1, 1); // a later kill in the same room
    expect(state.rewards.get("r")).toBe(reward); // untouched
  });

  // Room-clear pedestals no longer roll weapons (they flooded the run — see
  // ROOM_REWARD_WEIGHTS). Weapons come from shops, offer pedestals, and maze
  // chests now, so this path only ever hands out an upgrade or gold.
  it("never rolls a weapon from a room-clear pedestal", () => {
    for (let i = 0; i < 300; i++) {
      expect(rewardFloor().reward.kind).not.toBe("weapon");
    }
  });

  it("adds a gold reward to the shared purse", () => {
    const { reward, loot, state, physics } = rewardOfKind("gold");
    const before = state.gold;
    loot.claimReward(playerAt(physics, RX, RY), { roomId: "r" });
    expect(state.gold).toBe(before + reward.gold);
    expect(reward.gold).toBeGreaterThan(0);
  });

  it("grants an upgrade reward to the player who claims it", () => {
    const { reward, loot, physics } = rewardOfKind("upgrade");
    const p = playerAt(physics, RX, RY);
    const before = p.upgrades.length;
    loot.claimReward(p, { roomId: "r" });
    expect(p.upgrades.length).toBe(before + 1);
    expect(p.upgrades[before].id).toBe(reward.upgradeId);
  });

  it("is claimed exactly once, however many players reach for it", () => {
    const { reward, loot, physics } = rewardOfKind("upgrade");
    const a = playerAt(physics, RX, RY);
    const b = playerAt(physics, RX, RY);
    loot.claimReward(a, { roomId: "r" });

    loot.claimReward(b, { roomId: "r" });
    loot.claimReward(a, { roomId: "r" });

    expect(reward.claimed).toBe(true);
    expect(a.upgrades).toHaveLength(1);
    expect(b.upgrades).toHaveLength(0);
  });

  it("refuses a player standing away from it", () => {
    const { reward, loot, physics } = rewardFloor();
    loot.claimReward(playerAt(physics, RX + 500, RY), { roomId: "r" });
    expect(reward.claimed).toBe(false);
  });

  it("rolls both non-weapon kinds over many drops", () => {
    const kinds = new Set<string>();
    for (let i = 0; i < 300; i++) kinds.add(rewardFloor().reward.kind);
    expect(kinds).toEqual(new Set(["upgrade", "gold"]));
  });

  it("shrugs off a malformed claim message", () => {
    const { loot, physics } = rewardFloor();
    const p = playerAt(physics, 0, 0);
    expect(() => {
      loot.claimReward(p, { roomId: "nope" });
      loot.claimReward(p, undefined as never);
    }).not.toThrow();
  });
});

describe("maze chests", () => {
  function chestFloor() {
    const f = floor("maze");
    f.loot.spawnChests();
    return { ...f, chest: f.state.chests.get(f.room.id)! };
  }

  it("puts one chest in every maze room, pre-loaded and closed", () => {
    const { chest } = chestFloor();
    expect(WEAPON_REGISTRY[chest.weaponId!]).toBeDefined();
    expect(chest.mods.length).toBeGreaterThan(0);
    expect(chest.opened).toBe(false);
  });

  it("sits at the maze's deepest tile, on floor inside the room", () => {
    const { chest, dungeon, room } = chestFloor();
    const deep = mazeDeepestTile(dungeon.mapData, room);
    expect(chest.x).toBe(deep.col * TILE_SIZE + TILE_SIZE / 2);
    expect(chest.y).toBe(deep.row * TILE_SIZE + TILE_SIZE / 2);
    expect(dungeon.mapData[deep.row][deep.col]).toBe(TILE.FLOOR);
  });

  it("keeps its contents server-side, so opening it is still a surprise", () => {
    // weaponId and mods are deliberately UNDECORATED on ChestState.
    const { chest } = chestFloor();
    const synced = JSON.parse(JSON.stringify(chest.toJSON()));
    expect(synced.weaponId).toBeUndefined();
    expect(synced.mods).toBeUndefined();
  });

  it("hands over the weapon it has been holding, mods and all", () => {
    const { chest, loot, physics, room } = chestFloor();
    const p = playerAt(physics, chest.x, chest.y);

    loot.chestOpen(p, { roomId: room.id });

    const got = p.weapons[p.weapons.length - 1];
    expect(got.id).toBe(chest.weaponId);
    expect(got.modLabels).toEqual(chest.mods.map(m => m.label));
    expect(chest.opened).toBe(true);
  });

  it("costs nothing — a chest is pure loot", () => {
    const { chest, loot, physics, room } = chestFloor();
    const p = playerAt(physics, chest.x, chest.y);
    const hp0 = p.state.health;
    loot.chestOpen(p, { roomId: room.id });
    expect(p.state.health).toBe(hp0);
  });

  it("opens exactly once, however many players reach for it", () => {
    const { chest, loot, physics, room } = chestFloor();
    const a = playerAt(physics, chest.x, chest.y);
    const b = playerAt(physics, chest.x, chest.y);
    loot.chestOpen(a, { roomId: room.id });

    loot.chestOpen(b, { roomId: room.id });
    loot.chestOpen(a, { roomId: room.id });

    expect(a.weapons).toHaveLength(1);
    expect(b.weapons).toHaveLength(0);
  });

  it("refuses a player standing away from it", () => {
    const { chest, loot, physics, room } = chestFloor();
    const p = playerAt(physics, chest.x + 500, chest.y);
    loot.chestOpen(p, { roomId: room.id });
    expect(chest.opened).toBe(false);
  });

  it("stops an arrow too, like any solid rectangle", () => {
    const { chest, physics } = chestFloor();
    expect(physics.barrierAt(chest.x, chest.y)).toBe(true);
  });

  it("rolls gold chests as the rare case, with more modifiers on them", () => {
    let gold = 0;
    let goldMods = 0;
    let brownMods = 0;
    const runs = 300;
    for (let i = 0; i < runs; i++) {
      const { chest } = chestFloor();
      if (chest.gold) { gold++; goldMods = chest.mods.length; }
      else brownMods = chest.mods.length;
    }
    expect(gold).toBeGreaterThan(0);
    expect(gold).toBeLessThan(runs / 2); // rare
    expect(goldMods).toBeGreaterThan(brownMods);
  });

  it("shrugs off a malformed open message", () => {
    const { loot, physics } = chestFloor();
    const p = playerAt(physics, 0, 0);
    expect(() => {
      loot.chestOpen(p, { roomId: "nope" });
      loot.chestOpen(p, undefined as never);
    }).not.toThrow();
  });
});

describe("supply pedestals (floor-1 first weapon)", () => {
  // A floor-1 supply room with a given party, pedestals laid.
  function supplyFloor(classes: CharacterClass[]) {
    const f = floor("supply");
    f.players.clear();
    const party = classes.map((cls, i) => {
      const p = new Player(f.physics, x0, y0, cls, "guy");
      f.players.set(`p${i}`, p);
      return p;
    });
    f.loot.spawnSupply();
    return { ...f, party, supplies: f.state.supplies };
  }

  it("lays one weapon pedestal per player, from that class's unique categories", () => {
    const { supplies } = supplyFloor(["knight", "mage"]);
    expect(supplies.size).toBe(2);
    const cats = [...supplies.values()].map(s => WEAPON_REGISTRY[s.weapon.weaponId].category);
    // Knight → hammer/mace, Mage → staff; every pedestal is one of the party's uniques.
    for (const cat of cats) expect(["hammer", "mace", "staff"]).toContain(cat);
    expect(cats).toContain("staff"); // the mage's pedestal
  });

  it("only exists on floor 1", () => {
    const f = floor("supply", 2);
    f.players.set("p0", new Player(f.physics, x0, y0, "knight", "guy"));
    f.loot.spawnSupply();
    expect(f.state.supplies.size).toBe(0);
  });

  it("lets any compatible player claim it — it is class-gated, not owner-locked", () => {
    const s = supplyFloor(["knight"]);
    const [supplyId, reward] = [...s.supplies.entries()][0];
    // A DIFFERENT knight (not the one it was rolled for) standing on it can claim.
    const otherKnight = new Player(s.physics, reward.x, reward.y, "knight", "guy");
    expect(s.loot.claimSupply(otherKnight, { supplyId })).toBeNull();
    expect(reward.claimed).toBe(true);
    expect(otherKnight.weapons).toHaveLength(1);
  });

  it("blocks an incompatible class with an error and grants nothing", () => {
    const s = supplyFloor(["mage"]); // a single staff pedestal
    const [supplyId, reward] = [...s.supplies.entries()][0];
    const knight = new Player(s.physics, reward.x, reward.y, "knight", "guy");

    expect(s.loot.claimSupply(knight, { supplyId })).toBe(WRONG_CLASS_MSG);
    expect(reward.claimed).toBe(false);
    expect(knight.weapons).toHaveLength(0);

    // ...and the intended class can still take it afterwards.
    const mage = new Player(s.physics, reward.x, reward.y, "mage", "guy");
    expect(s.loot.claimSupply(mage, { supplyId })).toBeNull();
    expect(mage.weapons).toHaveLength(1);
  });

  // The debug-menu "First weapon" picker: force the supply pedestal weapon.
  function debugSupplyFloor(cls: CharacterClass, firstWeaponId: string) {
    const dungeon = generateDungeon(1, { showcaseRoomType: "supply" });
    const physics = new PhysicsWorld(dungeon.mapData, dungeon.cols, dungeon.rows);
    const state = new GameState();
    state.floor = 1;
    const players = new Map<string, Player>();
    players.set("p0", new Player(physics, x0, y0, cls, "guy"));
    const loot = new LootDirector(state, players, { ...DEFAULT_DEBUG_CONFIG, enabled: true, firstWeaponId });
    loot.setFloor(dungeon, physics);
    loot.spawnSupply();
    return { state, supplies: state.supplies };
  }

  const anyWeaponOfCategory = (cat: string): WeaponId =>
    (Object.keys(WEAPON_REGISTRY) as WeaponId[]).find((id) => WEAPON_REGISTRY[id].category === cat)!;

  it("forces the debug-picked first weapon when the class can equip it", () => {
    const hammer = anyWeaponOfCategory("hammer"); // knight-only, so canEquip passes
    const { supplies } = debugSupplyFloor("knight", hammer);
    expect(supplies.size).toBe(1);
    expect([...supplies.values()][0].weapon.weaponId).toBe(hammer);
  });

  it("ignores the debug pick a class can't use and rolls from its own pool instead", () => {
    const staff = anyWeaponOfCategory("staff"); // mage-only, a knight can't equip it
    const { supplies } = debugSupplyFloor("knight", staff);
    const rolled = [...supplies.values()][0].weapon.weaponId;
    expect(rolled).not.toBe(staff);
    // Fell back to the knight's unique first-weapon pool (hammer/mace).
    expect(["hammer", "mace"]).toContain(WEAPON_REGISTRY[rolled].category);
  });
});

describe("class restriction blocks incompatible pickups everywhere", () => {
  it("refuses a shop purchase of a weapon the class can't use, and charges nothing", () => {
    const f = floor("shop");
    f.loot.spawnShops();
    const shop = f.state.shops.get(f.room.id)!;
    shop.items[0].weaponId = "oak-staff"; // force a Mage-only weapon onto the pedestal
    const knight = playerAt(f.physics, shop.items[0].x, shop.items[0].y);
    const gold0 = f.state.gold;

    expect(f.loot.buy(knight, { roomId: f.room.id, itemIndex: 0 })).toBe(WRONG_CLASS_MSG);
    expect(shop.items[0].purchased).toBe(false);
    expect(f.state.gold).toBe(gold0);
    expect(knight.weapons).toHaveLength(0);
  });

  it("refuses an offer weapon card the class can't use, without consuming it", () => {
    const f = floor("shrine");
    f.loot.spawnShrineOffers();
    const offer = f.state.offers.get(f.room.id)!;
    offer.choices[0].kind = "weapon";
    offer.choices[0].weapon.weaponId = "oak-staff";
    const knight = playerAt(f.physics, offer.x, offer.y);

    expect(f.loot.offerPick("s1", knight, { roomId: f.room.id, choiceIndex: 0 })).toBe(WRONG_CLASS_MSG);
    expect([...offer.consumed]).toEqual([]); // still available for a Mage teammate
    expect(knight.weapons).toHaveLength(0);
  });

  it("refuses to open a chest holding a weapon the class can't use", () => {
    const f = floor("maze");
    f.loot.spawnChests();
    const chest = f.state.chests.get(f.room.id)!;
    chest.weaponId = "oak-staff";
    const knight = playerAt(f.physics, chest.x, chest.y);

    expect(f.loot.chestOpen(knight, { roomId: f.room.id })).toBe(WRONG_CLASS_MSG);
    expect(chest.opened).toBe(false); // left closed and unspoiled for a Mage
    expect(knight.weapons).toHaveLength(0);
  });
});
