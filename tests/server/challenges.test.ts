import { describe, it, expect } from "vitest";
import { generateDungeon, RoomType, TILE_SIZE, RoomData } from "shared";
import { PhysicsWorld } from "../../server/src/physics/PhysicsWorld";
import { FloorManager } from "../../server/src/floor/FloorManager";
import { WaveChallenge } from "../../server/src/rooms/challenges/WaveChallenge";
import { TimedClearChallenge } from "../../server/src/rooms/challenges/TimedClearChallenge";
import { RoomChallenge, ChallengeContext } from "../../server/src/rooms/challenges/RoomChallenge";
import { EnemyClass } from "../../server/src/entities/Enemy";

// Room challenges are driven against the REAL FloorManager in GameRoom's exact
// step-4 order — challenge.onEnemyDown BEFORE floorManager.onEnemyMaybeCleared.
// That ordering is the whole reason FloorManager needed no special case, so a
// test that reorders them proves nothing.

const ENEMIES_PER_ROOM = 2;

/** A room of the given type, with a real FloorManager and stand-in enemies. */
function room(type: RoomType) {
  const dungeon = generateDungeon(1, { showcaseRoomType: type });
  const roomData = dungeon.rooms.find(r => r.type === type)!;
  const physics = new PhysicsWorld(dungeon.mapData, dungeon.cols, dungeon.rows);
  const floor = new FloorManager(dungeon.rooms, dungeon.connections, physics);

  const dying = new Map<string, boolean>();
  let counter = 0;
  const centre = { x: (roomData.centerCol + 1) * TILE_SIZE, y: (roomData.centerRow + 1) * TILE_SIZE };

  const spawn = () => {
    const id = `e${counter++}`;
    dying.set(id, false);
    floor.assignEnemy(id, centre.x, centre.y);
    return id;
  };

  let rewards = 0;
  let playersPresent = true;

  const ctx: ChallengeContext = {
    roomId: roomData.id,
    livingEnemyCount: () =>
      [...dying].filter(([id, d]) => !d && floor.getEnemyRoom(id) === roomData.id).length,
    spawnEnemyInRoom: () => { spawn(); },
    enemyPool: () => [null as unknown as EnemyClass], // only its length matters here
    enemiesPerRoom: () => ENEMIES_PER_ROOM,
    dropReward: () => { rewards++; },
    playersInRoom: () => playersPresent,
  };

  return {
    roomData,
    floor,
    centre,
    ctx,
    spawn,
    living: () => [...dying].filter(([, d]) => !d).map(([id]) => id),
    rewards: () => rewards,
    setPresent: (v: boolean) => { playersPresent = v; },
    /** One enemy dies, in GameRoom's exact order. Returns the unlocks. */
    kill(challenge: RoomChallenge, id: string) {
      dying.set(id, true);
      challenge.onEnemyDown(ctx);                        // challenge first...
      return floor.onEnemyMaybeCleared(id, e => dying.get(e) ?? true); // ...then the clear check
    },
    runMs(challenge: RoomChallenge, ms: number) {
      for (let t = 0; t < ms; t += 50) challenge.tick(50, ctx);
    },
  };
}

describe("wave rooms", () => {
  function waveRoom() {
    const r = room("wave");
    const challenge = new WaveChallenge();
    for (let i = 0; i < ENEMIES_PER_ROOM; i++) r.spawn(); // wave 1, from the normal pass
    r.floor.finalizeEmptyRooms();
    return { ...r, challenge };
  }

  it("is not pre-cleared, and locks on entry like a combat room", () => {
    const r = waveRoom();
    expect(r.floor.isRoomCleared(r.roomData.id)).toBe(false);
    expect(r.floor.checkPlayerEnteredRoom(r.centre.x, r.centre.y).length).toBeGreaterThan(0);
  });

  it("keeps the door shut across a wave break", () => {
    const r = waveRoom();
    r.floor.checkPlayerEnteredRoom(r.centre.x, r.centre.y);

    let unlocked = 0;
    for (const id of r.living()) unlocked += r.kill(r.challenge, id).parentUnlocked.length;

    expect(unlocked).toBe(0);
    expect(r.floor.isRoomCleared(r.roomData.id)).toBe(false);
    expect(r.challenge.isComplete).toBe(false);
  });

  it("feeds a fixed horde total, one replacement per kill, capped at the room size", () => {
    const r = waveRoom();
    r.floor.checkPlayerEnteredRoom(r.centre.x, r.centre.y);

    let killed = 0;
    let maxAlive = r.living().length;
    for (let guard = 0; guard < 100; guard++) {
      const alive = r.living();
      if (alive.length === 0) break;
      maxAlive = Math.max(maxAlive, alive.length);
      r.kill(r.challenge, alive[0]); // one at a time; a replacement refills behind it
      killed++;
    }

    // Total = ENEMIES_PER_ROOM × the horde multiplier (3), and never more alive at
    // once than a normal room holds.
    expect(killed).toBe(ENEMIES_PER_ROOM * 3);
    expect(maxAlive).toBeLessThanOrEqual(ENEMIES_PER_ROOM);
    expect(r.challenge.isComplete).toBe(true);
  });

  it("opens the door exactly once, after the final wave", () => {
    const r = waveRoom();
    r.floor.checkPlayerEnteredRoom(r.centre.x, r.centre.y);

    let openings = 0;
    for (let guard = 0; guard < 50; guard++) {
      const alive = r.living();
      if (alive.length === 0) break;
      for (const id of alive) openings += r.kill(r.challenge, id).parentUnlocked.length;
    }

    expect(openings).toBeGreaterThan(0);
    expect(r.floor.isRoomCleared(r.roomData.id)).toBe(true);
    expect(r.challenge.isComplete).toBe(true);
  });

  it("counts the horde down on its banner as it is slain", () => {
    const r = waveRoom();
    // Before the first tick/kill the total isn't fixed yet.
    expect(r.challenge.bannerText).toBe("Horde");
    r.kill(r.challenge, r.living()[0]);
    // total = ENEMIES_PER_ROOM × 3 = 6, one slain.
    expect(r.challenge.bannerText).toBe("Horde 1 / 6");
  });

  it("grants no pedestal of its own — the reward is getting out", () => {
    const r = waveRoom();
    for (let guard = 0; guard < 50 && r.living().length; guard++) {
      for (const id of r.living()) r.kill(r.challenge, id);
    }
    expect(r.rewards()).toBe(0);
  });

  it("does nothing more once complete", () => {
    const r = waveRoom();
    for (let guard = 0; guard < 50 && r.living().length; guard++) {
      for (const id of r.living()) r.kill(r.challenge, id);
    }
    const banner = r.challenge.bannerText;
    r.challenge.onEnemyDown(r.ctx);
    expect(r.challenge.bannerText).toBe(banner);
    expect(r.living()).toHaveLength(0);
  });

  it("spawns nothing when the enemy pool is empty", () => {
    const r = room("wave");
    const challenge = new WaveChallenge();
    r.spawn();
    const emptyPool: ChallengeContext = { ...r.ctx, enemyPool: () => [] };

    challenge.onEnemyDown(emptyPool); // no pool to draw from
    expect(r.living().length).toBeLessThanOrEqual(1);
  });
});

describe("timed-clear rooms", () => {
  function timedRoom() {
    const r = room("timed");
    const challenge = new TimedClearChallenge();
    for (let i = 0; i < ENEMIES_PER_ROOM; i++) r.spawn();
    r.floor.finalizeEmptyRooms();
    return { ...r, challenge };
  }

  it("is not pre-cleared", () => {
    const r = timedRoom();
    expect(r.floor.isRoomCleared(r.roomData.id)).toBe(false);
  });

  it("counts down while the party is in the room", () => {
    const r = timedRoom();
    expect(r.challenge.bannerText).toBe("Time 0:45");
    r.runMs(r.challenge, 10_000);
    expect(r.challenge.bannerText).toBe("Time 0:35");
  });

  it("waits for the party to arrive before starting the clock", () => {
    // Otherwise it drains while they are three rooms away and the reward is
    // gone before they ever see the door.
    const r = timedRoom();
    r.setPresent(false);
    r.runMs(r.challenge, 60_000);
    expect(r.challenge.bannerText).toBe("Time 0:45");

    r.setPresent(true);
    r.runMs(r.challenge, 5_000);
    expect(r.challenge.bannerText).toBe("Time 0:40");
  });

  it("drops a pedestal for beating the clock", () => {
    const r = timedRoom();
    r.runMs(r.challenge, 10_000);
    for (const id of r.living()) r.kill(r.challenge, id);

    expect(r.rewards()).toBe(1);
    expect(r.challenge.isComplete).toBe(true);
    expect(r.floor.isRoomCleared(r.roomData.id)).toBe(true);
  });

  it("says so when the clock runs out, and forfeits the pedestal", () => {
    const r = timedRoom();
    r.runMs(r.challenge, 50_000);

    expect(r.challenge.bannerText).toBe("Out of time");
    expect(r.challenge.isComplete).toBe(false); // running out is not completing

    for (const id of r.living()) r.kill(r.challenge, id);
    expect(r.rewards()).toBe(0);
  });

  it("STILL opens the door when the clock is missed — no failure state, no softlock", () => {
    // The design's hard rule: nothing in the dungeon may strand a party.
    const r = timedRoom();
    r.runMs(r.challenge, 50_000);
    for (const id of r.living()) r.kill(r.challenge, id);

    expect(r.floor.isRoomCleared(r.roomData.id)).toBe(true);
  });

  it("never grants twice, however many enemies die after the clear", () => {
    const r = timedRoom();
    for (const id of r.living()) r.kill(r.challenge, id);
    r.challenge.onEnemyDown(r.ctx);
    r.challenge.onEnemyDown(r.ctx);
    expect(r.rewards()).toBe(1);
  });

  it("stops counting down once the room is done", () => {
    const r = timedRoom();
    r.runMs(r.challenge, 5_000);
    for (const id of r.living()) r.kill(r.challenge, id);
    const banner = r.challenge.bannerText;
    r.runMs(r.challenge, 30_000);
    expect(r.challenge.bannerText).toBe(banner);
  });

  it("grants nothing while enemies are still alive", () => {
    const r = timedRoom();
    const [first] = r.living();
    r.kill(r.challenge, first);
    expect(r.rewards()).toBe(0);
    expect(r.challenge.isComplete).toBe(false);
  });
});

describe("dark rooms", () => {
  it("are an ordinary combat room server-side — the variant is a client overlay", () => {
    const r = room("dark");
    // There is no DarkChallenge, and there must not be one — the client decides
    // darkness alone, because it regenerates the same floor from the same seed.

    // Nothing special: rabble spawns, the room locks, killing everything clears it.
    r.spawn();
    r.floor.finalizeEmptyRooms();
    expect(r.floor.isRoomCleared(r.roomData.id)).toBe(false);
    expect(r.floor.checkPlayerEnteredRoom(r.centre.x, r.centre.y).length).toBeGreaterThan(0);

    for (const id of r.living()) {
      r.floor.onEnemyMaybeCleared(id, () => true);
    }
    expect(r.floor.isRoomCleared(r.roomData.id)).toBe(true);
  });
});

describe("the base RoomChallenge", () => {
  class Plain extends RoomChallenge {
    get bannerText() { return "plain"; }
  }

  it("is complete by default and does nothing on either hook", () => {
    const plain = new Plain();
    const r = room("combat");
    expect(plain.isComplete).toBe(true);
    expect(() => plain.onEnemyDown(r.ctx)).not.toThrow();
    expect(() => plain.tick(50, r.ctx)).not.toThrow();
  });
});

describe("reward rooms on a normal floor", () => {
  it("are pre-cleared and never lock the retreat path", () => {
    const d = generateDungeon(7);
    const physics = new PhysicsWorld(d.mapData, d.cols, d.rows);
    const floor = new FloorManager(d.rooms, d.connections, physics);

    // Rabble skipped for reward rooms, as NO_RABBLE_ROOM_TYPES produces.
    let n = 0;
    for (const r of d.rooms) {
      if (!["boss", "wave", "combat", "maze", "timed", "dark"].includes(r.type)) continue;
      floor.assignEnemy(`x${n++}`, (r.centerCol + 1) * TILE_SIZE, (r.centerRow + 1) * TILE_SIZE);
    }
    floor.finalizeEmptyRooms();

    const reward = d.rooms.filter((r: RoomData) => ["shop", "shrine", "chest"].includes(r.type));
    expect(reward.length).toBeGreaterThan(0);
    for (const r of reward) {
      expect(floor.isRoomCleared(r.id), r.id).toBe(true);
      expect(
        floor.checkPlayerEnteredRoom((r.centerCol + 1) * TILE_SIZE, (r.centerRow + 1) * TILE_SIZE),
        r.id,
      ).toHaveLength(0);
    }
  });

  it("still locks the boss room", () => {
    const d = generateDungeon(7);
    const physics = new PhysicsWorld(d.mapData, d.cols, d.rows);
    const floor = new FloorManager(d.rooms, d.connections, physics);
    const boss = d.rooms.find(r => r.type === "boss")!;
    floor.assignEnemy("boss", (boss.centerCol + 1) * TILE_SIZE, (boss.centerRow + 1) * TILE_SIZE);
    floor.finalizeEmptyRooms();

    expect(floor.isRoomCleared(boss.id)).toBe(false);
  });
});
