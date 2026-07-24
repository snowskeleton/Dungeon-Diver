import { describe, it, expect } from "vitest";
import {
  generateDungeon,
  DungeonResult, RoomType,
  floorGoldBudget, coinDenominations,
  SHOP_TIERS,
  COIN_IDLE_MS, COIN_PICKUP_RADIUS, SERVER_TICK_MS,
  DEFAULT_DEBUG_CONFIG, DebugConfig,
} from "shared";
import { startedRoom, RoomHarness } from "../helpers/gameRoom";
import { SpawnDirector } from "../../server/src/rooms/SpawnDirector";
import { LootDirector } from "../../server/src/rooms/LootDirector";
import { GameState } from "../../server/src/schema/GameState";
import { PlayerState } from "../../server/src/schema/PlayerState";
import { FloorManager } from "../../server/src/floor/FloorManager";
import { PhysicsWorld } from "../../server/src/physics/PhysicsWorld";
import { Enemy } from "../../server/src/entities/Enemy";
import { Player } from "../../server/src/entities/Player";
import { Coin } from "../../server/src/entities/Coin";

// The economy is BUDGETED, not per-enemy-priced (see shared/economy): a floor's
// gold is decided up front and divided across whatever spawned, weighted by each
// enemy's goldWeight. These lock the invariants that keeps true — the total is the
// budget, tougher enemies pay more — plus the two gold sinks and the coin pickup.

function spawnFloor(players = 1) {
  const dungeon: DungeonResult = generateDungeon(1);
  const physics = new PhysicsWorld(dungeon.mapData, dungeon.cols, dungeon.rows);
  const floorManager = new FloorManager(dungeon.rooms, dungeon.connections, physics);
  const state = new GameState();
  const enemies = new Map<string, Enemy>();
  const playerMap = new Map<string, Player>();
  for (let i = 0; i < players; i++) playerMap.set(`p${i}`, new Player(physics, 100, 100));
  const spawner = new SpawnDirector(state, enemies, playerMap, null, {});
  spawner.setFloor(dungeon, physics, floorManager);
  spawner.spawnFloorEnemies();
  return { dungeon, physics, state, enemies };
}

describe("the floor gold budget", () => {
  it("hands out exactly the floor budget across every enemy", () => {
    const { enemies } = spawnFloor(1);
    let total = 0;
    enemies.forEach(e => (total += e.goldValue));
    // Summed rounding of each share can drift by at most 1 per enemy, so allow
    // that slack rather than pinning an exact number (which would be a balance
    // assertion, not a behavioural one).
    expect(total).toBeGreaterThan(floorGoldBudget(1) - enemies.size);
    expect(total).toBeLessThanOrEqual(floorGoldBudget(1) + enemies.size);
  });

  it("scales the budget with party size", () => {
    const solo = spawnFloor(1);
    const four = spawnFloor(4);
    const sum = (m: Map<string, Enemy>) => {
      let t = 0; m.forEach(e => (t += e.goldValue)); return t;
    };
    expect(sum(four.enemies)).toBeGreaterThan(sum(solo.enemies));
  });

  it("pays a boss far more than a rank-and-file enemy (goldWeight)", () => {
    const { enemies } = spawnFloor(1);
    const values = [...enemies.values()];
    const boss = values.find(e => e.goldWeight > 1);
    const grunt = values.find(e => e.goldWeight === 1);
    if (boss && grunt) expect(boss.goldValue).toBeGreaterThan(grunt.goldValue);
  });
});

describe("coinDenominations", () => {
  it("always sums back to the exact amount", () => {
    for (const amount of [0, 1, 7, 25, 143, 999]) {
      expect(coinDenominations(amount).reduce((a, b) => a + b, 0)).toBe(amount);
    }
  });

  it("never scatters more than a capped number of coins", () => {
    // Even a huge payout is a handful of coins, not a carpet of them.
    expect(coinDenominations(100000).length).toBeLessThanOrEqual(5);
  });

  it("drops nothing for a zero payout", () => {
    expect(coinDenominations(0)).toEqual([]);
  });
});

describe("a dropped coin", () => {
  function player(x: number, y: number): Map<string, PlayerState> {
    const p = new PlayerState();
    p.x = x; p.y = y;
    return new Map([["p", p]]);
  }

  it("is swept up the instant a player walks over it, before the idle passes", () => {
    const coin = new Coin(100, 100, 5);
    // Player right on top: collected on the very first tick despite full idle left.
    expect(coin.update(50, player(100, 100))).toBe(true);
  });

  it("lies still during its idle window when no player is near", () => {
    const coin = new Coin(100, 100, 5);
    expect(coin.update(COIN_IDLE_MS - 50, player(1000, 1000))).toBe(false);
    // It has not moved toward the far-off player.
    expect(coin.state.x).toBe(100);
    expect(coin.state.y).toBe(100);
  });

  it("homes toward the player once idle expires, then is collected", () => {
    const coin = new Coin(100, 100, 5);
    const p = player(300, 100);
    coin.update(COIN_IDLE_MS, p); // burn the idle
    const startDx = Math.abs(p.get("p")!.x - coin.state.x);
    // A homing tick moves it closer to the player.
    let collected = false;
    for (let i = 0; i < 120 && !collected; i++) collected = coin.update(50, p);
    expect(collected).toBe(true);
    expect(Math.abs(p.get("p")!.x - coin.state.x)).toBeLessThan(startDx);
  });

  it("homes from clear across the floor — no distance gate", () => {
    const coin = new Coin(100, 100, 5);
    // A player far enough to be in another room entirely.
    const faraway = player(2000, 1500);
    coin.update(COIN_IDLE_MS, faraway); // burn the idle
    const before = Math.hypot(2000 - coin.state.x, 1500 - coin.state.y);
    coin.update(50, faraway);
    const after = Math.hypot(2000 - coin.state.x, 1500 - coin.state.y);
    expect(after).toBeLessThan(before); // pulled toward them despite the distance
  });
});

describe("killing an enemy in a real room drops gold", () => {
  const debug = (over: Partial<DebugConfig>): DebugConfig => ({
    ...DEFAULT_DEBUG_CONFIG, enabled: true, ...over,
  });
  const guts = (h: RoomHarness) => h.room as unknown as {
    players: Map<string, { teleport(x: number, y: number): void; state: { x: number; y: number } }>;
    enemies: Map<string, Enemy>;
  };

  it("puts a coin on the floor on the death tick, then sweeps it into the purse", async () => {
    // One enemy in the start room so it's revealed and killable immediately.
    const h = await startedRoom(1, {
      debug: debug({ gridCols: 1, gridRows: 1, roomType: "combat", enemiesPerRoom: 1 }),
    });
    const g = guts(h);
    const enemy = [...g.enemies.values()][0];
    expect(enemy.goldValue).toBeGreaterThan(0); // budget was assigned at spawn

    // Stand the player on the enemy, then reveal + kill it.
    g.players.get("s0")!.teleport(enemy.state.x, enemy.state.y);
    h.tick(1); // reveal the room's enemy onto the synced state
    enemy.takeDamage(99999);

    const goldBefore = h.state.gold;
    h.tick(1); // death tick: dropCoins runs in step 4
    // A coin exists (or was already collected this tick because the player is on top).
    const dropped = h.state.coins.size > 0 || h.state.gold > goldBefore;
    expect(dropped).toBe(true);

    // Every dropped coin ends up in the purse. A coin landing on the player (within
    // COIN_PICKUP_RADIUS) is swept instantly; one that scattered just past it — the
    // player is nudged off the exact death spot by the physics separation above —
    // lies idle for COIN_IDLE_MS before homing in. So tick until the floor is clear
    // rather than assuming a fixed count, which made this flaky on the scatter roll.
    // The cap comfortably clears the idle window (COIN_IDLE_MS / SERVER_TICK_MS ticks)
    // plus the short homing that follows.
    const maxTicks = Math.ceil(COIN_IDLE_MS / SERVER_TICK_MS) + 20;
    let ticks = 0;
    while (h.state.coins.size > 0 && ticks < maxTicks) {
      h.tick(1);
      ticks += 1;
    }
    expect(h.state.gold).toBeGreaterThan(goldBefore);
    expect(h.state.coins.size).toBe(0);
    h.dispose();
  });
});

// ── Gold sinks ──────────────────────────────────────────────────────────────

function lootFloor(type: RoomType, floorNumber = 1) {
  const dungeon = generateDungeon(1, { showcaseRoomType: type });
  const physics = new PhysicsWorld(dungeon.mapData, dungeon.cols, dungeon.rows);
  const state = new GameState();
  state.floor = floorNumber;
  const loot = new LootDirector(state);
  loot.setFloor(dungeon, physics);
  const room = dungeon.rooms.find(r => r.type === type)!;
  return { dungeon, physics, state, loot, room };
}

describe("the shop spends gold, not HP", () => {
  it("prices pedestals at the fixed tiers", () => {
    const f = lootFloor("shop");
    f.loot.spawnShops();
    const shop = f.state.shops.get(f.room.id)!;
    for (const item of shop.items) {
      expect(SHOP_TIERS).toContain(item.cost);
    }
  });

  it("buys from the shared purse and leaves the buyer's HP untouched", () => {
    const f = lootFloor("shop");
    f.loot.spawnShops();
    const shop = f.state.shops.get(f.room.id)!;
    const item = shop.items[0]!;
    f.state.gold = 500;
    const buyer = new Player(f.physics, item.x, item.y);
    const hpBefore = buyer.state.health;
    f.loot.buy(buyer, { roomId: f.room.id, itemIndex: 0 });
    expect(item.purchased).toBe(true);
    expect(f.state.gold).toBe(500 - item.cost);
    expect(buyer.state.health).toBe(hpBefore);
  });

  it("refuses a purchase the purse can't cover", () => {
    const f = lootFloor("shop");
    f.loot.spawnShops();
    const shop = f.state.shops.get(f.room.id)!;
    const item = shop.items[0]!;
    f.state.gold = item.cost - 1;
    const buyer = new Player(f.physics, item.x, item.y);
    f.loot.buy(buyer, { roomId: f.room.id, itemIndex: 0 });
    expect(item.purchased).toBe(false);
    expect(f.state.gold).toBe(item.cost - 1);
  });
});

describe("reward pedestals are free — gold is spent at shops and nowhere else", () => {
  it("grants a shrine pick with an empty purse", () => {
    const f = lootFloor("shrine");
    f.loot.spawnShrineOffers();
    const offer = f.state.offers.get(f.room.id)!;
    f.state.gold = 0;
    const picker = new Player(f.physics, offer.x, offer.y);
    f.loot.offerPick("s1", picker, { roomId: f.room.id, choiceIndex: 0 });
    expect(offer.consumed.length).toBe(1);
    expect(f.state.gold).toBe(0); // and takes nothing from the purse
  });

  it("grants a boss drop with an empty purse", () => {
    const f = lootFloor("boss");
    f.loot.dropBossOffer(f.room.centerCol * 32, f.room.centerRow * 32);
    const offer = f.state.offers.get(f.room.id)!;
    f.state.gold = 0;
    const picker = new Player(f.physics, offer.x, offer.y);
    f.loot.offerPick("s1", picker, { roomId: f.room.id, choiceIndex: 0 });
    expect(offer.consumed.length).toBe(1); // claimed despite an empty purse
  });
});
