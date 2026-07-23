import { describe, it, expect } from "vitest";
import { generateDungeon, WEAPON_REGISTRY, RoomType, DungeonResult, TILE } from "shared";
import { LootDirector } from "../../server/src/rooms/LootDirector";
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
  const loot = new LootDirector(state);
  loot.setFloor(dungeon, physics);
  const room = dungeon.rooms.find(r => r.type === type)!;
  return { dungeon, physics, state, loot, room };
}

/** A player standing exactly on a pedestal, so proximity always passes. */
function playerAt(physics: PhysicsWorld, x: number, y: number) {
  return new Player(physics, x, y, "knight", "guy", "wood-sword");
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

  it("sells a weapon for HP to a player standing at the pedestal", () => {
    const { shop, loot, physics, room } = shopFloor();
    const item = shop.items[0];
    const p = playerAt(physics, item!.x, item!.y);
    const hp0 = p.state.health;

    loot.buy(p, { roomId: room.id, itemIndex: 0 });

    expect(p.weapons.map(w => w.id)).toContain(item!.weaponId);
    expect(p.state.health).toBe(hp0 - item!.cost);
    expect(item!.purchased).toBe(true);
  });

  it("refuses a player standing too far away", () => {
    const { shop, loot, physics, room } = shopFloor();
    const item = shop.items[0];
    const p = playerAt(physics, item!.x + 500, item!.y);

    loot.buy(p, { roomId: room.id, itemIndex: 0 });

    expect(p.weapons).toHaveLength(1);
    expect(item!.purchased).toBe(false);
  });

  it("refuses a second purchase of an already-sold pedestal", () => {
    const { shop, loot, physics, room } = shopFloor();
    const item = shop.items[0];
    const buyer = playerAt(physics, item!.x, item!.y);
    const latecomer = playerAt(physics, item!.x, item!.y);
    loot.buy(buyer, { roomId: room.id, itemIndex: 0 });

    loot.buy(latecomer, { roomId: room.id, itemIndex: 0 });

    expect(latecomer.weapons).toHaveLength(1);
  });

  it("never lets a purchase kill the buyer", () => {
    const { shop, loot, physics, room } = shopFloor();
    const item = shop.items[0];
    const p = playerAt(physics, item!.x, item!.y);
    p.state.health = item!.cost; // exactly the price

    loot.buy(p, { roomId: room.id, itemIndex: 0 });

    expect(p.state.health).toBe(item!.cost); // refused, not charged
    expect(item!.purchased).toBe(false);
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
    expect(p.weapons).toHaveLength(1);
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

describe("chests", () => {
  function chestFloor() {
    const f = floor("chest");
    f.loot.spawnChests();
    return { ...f, chest: f.state.chests.get(f.room.id)! };
  }

  it("puts one chest in every chest room, pre-loaded", () => {
    const { chest } = chestFloor();
    expect(WEAPON_REGISTRY[chest.weaponId!]).toBeDefined();
    expect(chest.mods.length).toBeGreaterThan(0);
    expect(chest.opened).toBe(false);
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

    expect(a.weapons).toHaveLength(2);
    expect(b.weapons).toHaveLength(1);
  });

  it("refuses a player standing away from it", () => {
    const { chest, loot, physics, room } = chestFloor();
    const p = playerAt(physics, chest.x + 500, chest.y);
    loot.chestOpen(p, { roomId: room.id });
    expect(chest.opened).toBe(false);
  });

  it("is solid, so you can't walk through it (playtest B8)", () => {
    const { chest, physics } = chestFloor();
    const p = new Player(physics, chest.x - 40, chest.y);

    for (let i = 0; i < 60; i++) {
      p.move(1, 0, 200);
      p.commitVelocity();
      physics.step();
      p.syncFromBody();
    }

    expect(p.state.x).toBeLessThan(chest.x); // stopped at the chest's face
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
