// Room variants: drives the REAL FloorManager and the REAL RoomChallenge classes
// in GameRoom's step-4 order, with a stand-in enemy set.
//
// Covers wave rooms (locked across wave breaks, opening exactly once after the
// final wave), timed-clear rooms (all three outcomes, including that missing the
// clock still opens the door), and that dark rooms stayed ordinary server-side.
import { generateDungeon, TILE, RoomType } from "shared";
import { TimedClearChallenge } from "./rooms/challenges/TimedClearChallenge";

// Mirrors GameRoom's NO_RABBLE_ROOM_TYPES. Duplicated rather than exported: the
// point of the assertion below is to catch someone quietly adding "dark" to it.
const NO_RABBLE: RoomType[] = ["boss", "shop", "shrine", "chest"];
import { FloorManager } from "./floor/FloorManager";
import { PhysicsWorld } from "./physics/PhysicsWorld";
import { WaveChallenge } from "./rooms/challenges/WaveChallenge";
import { ChallengeContext } from "./rooms/challenges/RoomChallenge";

let pass = 0, fail = 0;
const check = (ok: boolean, label: string, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  " + extra : ""}`);
  ok ? pass++ : fail++;
};

const dungeon = generateDungeon(1, { showcaseRoomType: "wave" });
const waveRoom = dungeon.rooms.find(r => r.type === "wave")!;
check(!!waveRoom, "showcase floor builds a wave room", waveRoom?.id);

const physics = new PhysicsWorld(dungeon.mapData, dungeon.cols, dungeon.rows);
const fm = new FloorManager(dungeon.rooms, dungeon.connections, physics);

// Stand-in enemies: id -> isDying. Homed via the real assignEnemy.
const dying = new Map<string, boolean>();
let counter = 0;
const cx = (waveRoom.centerCol + 1) * 32;
const cy = (waveRoom.centerRow + 1) * 32;
const spawn = () => {
  const id = `e${counter++}`;
  dying.set(id, false);
  fm.assignEnemy(id, cx, cy);
  return id;
};

const PER_ROOM = 2;
const challenge = new WaveChallenge();
const ctx: ChallengeContext = {
  roomId: waveRoom.id,
  livingEnemyCount: () => [...dying].filter(([id, d]) => !d && fm.getEnemyRoom(id) === waveRoom.id).length,
  spawnEnemyInRoom: () => { spawn(); },
  enemyPool: () => [null as any], // only length matters here
  enemiesPerRoom: () => PER_ROOM,
  dropReward: () => { rewards++; },
  playersInRoom: () => playersPresent,
};
let rewards = 0;
let playersPresent = true;

// Wave 1, as GameRoom's ordinary rank-and-file pass would place it.
for (let i = 0; i < PER_ROOM; i++) spawn();
fm.finalizeEmptyRooms();
check(!fm.isRoomCleared(waveRoom.id), "wave room is not pre-cleared by finalizeEmptyRooms");
check(fm.checkPlayerEnteredRoom(cx, cy).length > 0, "entering the wave room locks the entry barrier");

// GameRoom step 4, faithfully: flag dying → challenge first → then the clear check.
const kill = (id: string) => {
  dying.set(id, true);
  challenge.onEnemyDown(ctx);
  return fm.onEnemyMaybeCleared(id, (eid) => dying.get(eid) ?? true);
};

const waveSizes: number[] = [];
let cleared = false;
for (let guard = 0; guard < 50 && !cleared; guard++) {
  const alive = [...dying].filter(([, d]) => !d).map(([id]) => id);
  if (alive.length === 0) break;
  waveSizes.push(alive.length);
  let unlocked = 0;
  for (const id of alive) {
    const r = kill(id);
    unlocked += r.parentUnlocked.length;
  }
  const last = challenge.isComplete;
  if (!last) {
    check(unlocked === 0 && !fm.isRoomCleared(waveRoom.id),
      `wave break: room stayed locked  (${challenge.bannerText})`);
  } else {
    cleared = fm.isRoomCleared(waveRoom.id);
    check(unlocked > 0 && cleared, "final wave cleared: barrier opened", `conns=${unlocked}`);
  }
}

check(waveSizes.length === 3, "three waves ran", `sizes=${waveSizes.join(",")}`);
check(waveSizes[1] > waveSizes[0] && waveSizes[2] > waveSizes[1],
  "each wave is larger than the last", waveSizes.join(" → "));
check(challenge.bannerText === "Wave 3 / 3", "banner reads 3 / 3 at the end", challenge.bannerText);
check(challenge.isComplete, "challenge reports complete only after the last wave died");
check(rewards === 0, "a wave room grants no pedestal of its own");

// ── Timed clear ─────────────────────────────────────────────────────────────
// Three runs of the same room: beat the clock, miss the clock, and arrive late.
{
  const build = () => {
    const d = generateDungeon(1, { showcaseRoomType: "timed" });
    const room = d.rooms.find(r => r.type === "timed")!;
    const p = new PhysicsWorld(d.mapData, d.cols, d.rows);
    const m = new FloorManager(d.rooms, d.connections, p);
    const alive = new Set<string>();
    const down = new Set<string>();
    const rx = (room.centerCol + 1) * 32;
    const ry = (room.centerRow + 1) * 32;
    for (let i = 0; i < 2; i++) {
      const id = `t${i}`;
      alive.add(id);
      m.assignEnemy(id, rx, ry);
    }
    m.finalizeEmptyRooms();
    let granted = 0;
    let present = true;
    const c = new TimedClearChallenge();
    const cx2: ChallengeContext = {
      roomId: room.id,
      livingEnemyCount: () => alive.size,
      spawnEnemyInRoom: () => {},
      enemyPool: () => [],
      enemiesPerRoom: () => 2,
      dropReward: () => { granted++; },
      playersInRoom: () => present,
    };
    return {
      room, m, c, ctx: cx2, alive, down,
      grants: () => granted,
      setPresent: (v: boolean) => { present = v; },
      runMs: (ms: number) => { for (let t = 0; t < ms; t += 50) c.tick(50, cx2); },
      killAll: () => {
        for (const id of [...alive]) {
          alive.delete(id);
          down.add(id);
          c.onEnemyDown(cx2);
          m.onEnemyMaybeCleared(id, (e) => !alive.has(e));
        }
      },
    };
  };

  const fast = build();
  check(!fast.m.isRoomCleared(fast.room.id), "timed room is not pre-cleared");
  fast.runMs(10_000);
  check(fast.c.bannerText === "Time 0:35", "clock counts down", fast.c.bannerText);
  fast.killAll();
  check(fast.grants() === 1, "beating the clock drops a reward pedestal");
  check(fast.m.isRoomCleared(fast.room.id), "beating the clock clears the room");
  check(fast.c.isComplete, "challenge completes on clear");

  const slow = build();
  slow.runMs(50_000);
  check(slow.c.bannerText === "Out of time", "missing the clock says so", slow.c.bannerText);
  check(!slow.c.isComplete, "missing the clock is NOT a completion");
  slow.killAll();
  check(slow.grants() === 0, "missing the clock forfeits the pedestal");
  check(slow.m.isRoomCleared(slow.room.id),
    "missing the clock STILL opens the door — no failure state, no softlock");

  // The party is elsewhere on the floor: the clock must not drain in absentia.
  const away = build();
  away.setPresent(false);
  away.runMs(60_000);
  check(away.c.bannerText === "Time 0:45", "clock waits for the party to arrive", away.c.bannerText);
  away.setPresent(true);
  away.runMs(5_000);
  check(away.c.bannerText === "Time 0:40", "clock starts on arrival", away.c.bannerText);
}

// ── Dark rooms ──────────────────────────────────────────────────────────────
// Server-side, a dark room must be an ORDINARY combat room: the variant is a
// client overlay, so anything special here would be a bug.
{
  const d = generateDungeon(1, { showcaseRoomType: "dark" });
  const room = d.rooms.find(r => r.type === "dark")!;
  check(!!room, "showcase floor builds a dark room", room?.id);
  check(!NO_RABBLE.includes("dark"), "dark rooms still get enemies");
  // No cover: you can't see it, so it would only be something to snag on.
  const interior = d.mapData[room.centerRow].slice(room.tileCol + 1, room.tileCol + 20);
  check(interior.every((t: number) => t !== TILE.WALL), "dark rooms carve without cover blocks");
}

// ── Regression: a normal floor's other room types are unaffected ────────────
// finalizeEmptyRooms is untouched by wave rooms, but the tick-order change sits
// right next to it, so pin the behaviour that reward rooms stay walk-through.
{
  const d = generateDungeon(7);
  const p = new PhysicsWorld(d.mapData, d.cols, d.rows);
  const m = new FloorManager(d.rooms, d.connections, p);
  // Only the boss room and a wave room get enemies here; rabble is skipped, which
  // is exactly what NO_RABBLE_ROOM_TYPES produces for the reward rooms.
  let n = 0;
  for (const r of d.rooms) {
    if (r.type !== "boss" && r.type !== "wave" && r.type !== "combat" && r.type !== "maze") continue;
    m.assignEnemy(`x${n++}`, (r.centerCol + 1) * 32, (r.centerRow + 1) * 32);
  }
  m.finalizeEmptyRooms();
  const reward = d.rooms.filter(r => r.type === "shop" || r.type === "shrine" || r.type === "chest");
  check(reward.every(r => m.isRoomCleared(r.id)), "reward rooms are still pre-cleared", `n=${reward.length}`);
  const boss = d.rooms.find(r => r.type === "boss");
  check(!boss || !m.isRoomCleared(boss.id), "boss room still locks");
  check(reward.every(r => m.checkPlayerEnteredRoom((r.centerCol + 1) * 32, (r.centerRow + 1) * 32).length === 0),
    "reward rooms never lock the retreat path");
  const types = new Set(d.rooms.map(r => r.type));
  check(types.size >= 4, "a normal floor still mixes room types", [...types].join(","));
}

console.log(`\n${fail === 0 ? "✅ ROOM VARIANTS OK" : `❌ ${fail} FAILED`}  (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
