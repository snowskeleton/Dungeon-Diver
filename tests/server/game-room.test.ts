import { describe, it, expect } from "vitest";
import {
  DEFAULT_DEBUG_CONFIG,
  DebugConfig,
  TILE,
  TILE_SIZE,
  SERVER_TICK_MS,
  WEAPON_REGISTRY,
  CHARACTER_REGISTRY,
  CHARACTER_TYPES,
  RoomMetadata,
  isRoomCode,
  MAX_ROOM_NAME_LEN,
  MAX_PLAYER_NAME_LEN,
  TRAP_MIN_FLOORS,
  TRAP_MAX_FLOORS,
  roomInteriorRect,
  RoomType,
} from "shared";
import { createRoom, startedRoom, RoomHarness, FakeClient } from "../helpers/gameRoom";
import { Player } from "../../server/src/entities/Player";
import { Enemy } from "../../server/src/entities/Enemy";

// GameRoom is where every system meets. These drive the REAL room — real
// physics, real directors, real tick order — with only Colyseus's transport
// stubbed, because the wiring is exactly what unit tests of the pieces miss.

const debug = (over: Partial<DebugConfig>): DebugConfig => ({
  ...DEFAULT_DEBUG_CONFIG,
  enabled: true,
  ...over,
});

/** The room's internal maps, for assertions that need the entities themselves. */
const guts = (h: RoomHarness) => h.room as unknown as {
  players: Map<string, Player>;
  enemies: Map<string, Enemy>;
  projectiles: Map<string, unknown>;
  currentDungeon: { playerSpawns: Array<{ x: number; y: number }>; rooms: Array<{ id: string; type: string; centerCol: number; centerRow: number; tileCol: number; tileRow: number }>; stairsTile: { col: number; row: number }; startRoomId: string };
  physics: { tileAt(x: number, y: number): number | null };
};

/** Stand a player exactly on a tile centre. */
function place(h: RoomHarness, sessionId: string, col: number, row: number) {
  guts(h).players.get(sessionId)!.teleport(col * TILE_SIZE + 16, row * TILE_SIZE + 16);
}

describe("creating a room", () => {
  it("opens in its lobby phase with nothing simulating", async () => {
    const h = await createRoom();
    expect(h.state.phase).toBe("lobby");
    expect(h.state.enemies.size).toBe(0);

    h.tick(20);
    expect(h.state.enemies.size).toBe(0); // the lobby costs the server a boolean
    h.dispose();
  });

  it("allocates a well-formed join code", async () => {
    const h = await createRoom();
    expect(isRoomCode(h.state.roomCode)).toBe(true);
    h.dispose();
  });

  it("publishes what a room browser reads without joining", async () => {
    const h = await createRoom({ roomName: "Snow's run" });
    const meta = h.metadata() as RoomMetadata;
    expect(meta.roomName).toBe("Snow's run");
    expect(meta.code).toBe(h.state.roomCode);
    expect(meta.phase).toBe("lobby");
    h.dispose();
  });

  it("names an unnamed room rather than listing a blank one", async () => {
    const h = await createRoom({ roomName: "   " });
    expect(h.state.roomName.length).toBeGreaterThan(0);
    h.dispose();
  });

  it("clamps an oversized room name", async () => {
    const h = await createRoom({ roomName: "x".repeat(500) });
    expect(h.state.roomName).toHaveLength(MAX_ROOM_NAME_LEN);
    h.dispose();
  });

  it("carries the private flag", async () => {
    const priv = await createRoom({ isPrivate: true });
    expect(priv.state.isPrivate).toBe(true);
    const pub = await createRoom({});
    expect(pub.state.isPrivate).toBe(false);
    priv.dispose();
    pub.dispose();
  });

  it("generates the floor up front and tells clients how to rebuild it", async () => {
    const h = await createRoom();
    expect(h.state.seed).toBeGreaterThan(0);
    expect(() => JSON.parse(h.state.dungeonOpts)).not.toThrow();
    h.dispose();
  });

  it("applies a debug config to the floor it builds", async () => {
    const h = await createRoom({ debug: debug({ seed: 4242, roomType: "maze", gridCols: 2, gridRows: 2 }) });
    expect(h.state.seed).toBe(4242);
    expect(JSON.parse(h.state.dungeonOpts).forceRoomType).toBe("maze");
    // Every room but the boss room, which `includeBoss` still reserves.
    const rooms = guts(h).currentDungeon.rooms;
    expect(rooms.filter(r => r.type !== "boss").every(r => r.type === "maze")).toBe(true);
    h.dispose();
  });

  it("ignores a debug config that is switched off", async () => {
    const h = await createRoom({ debug: { ...DEFAULT_DEBUG_CONFIG, seed: 4242 } });
    expect(h.state.seed).not.toBe(4242);
    h.dispose();
  });
});

describe("the lobby", () => {
  it("makes the first player in the host", async () => {
    const h = await createRoom();
    const a = h.join("s0");
    h.join("s1");
    expect(h.state.hostSessionId).toBe(a.sessionId);
    h.dispose();
  });

  it("gives a joining player a spawn point, a name, and a character", async () => {
    const h = await createRoom();
    h.join("s0", { playerName: "Snow", characterClass: "mage", characterType: "gal", weaponId: "longbow" });
    const p = h.state.players.get("s0")!;

    expect(p.name).toBe("Snow");
    expect(p.characterClass).toBe("mage");
    expect(p.characterType).toBe("gal");
    expect(p.weaponId).toBe("longbow");
    h.dispose();
  });

  it("falls back to defaults for a junk name or weapon id sent at join", async () => {
    const h = await createRoom();
    h.join("s0", { playerName: "  ", weaponId: "not-a-weapon" });
    const p = h.state.players.get("s0")!;

    expect(p.name.length).toBeGreaterThan(0);
    expect(WEAPON_REGISTRY[p.weaponId]).toBeDefined();
    h.dispose();
  });

  it("falls back to the knight for an unknown characterClass", async () => {
    // This used to throw: the class id was CAST rather than resolved, so an
    // unknown one produced an undefined CharacterConfig and the Player
    // constructor died on `charConfig.maxHp` — taking the whole join with it.
    const h = await createRoom();

    expect(() => h.join("s0", { characterClass: "wizard" })).not.toThrow();

    const p = h.state.players.get("s0")!;
    expect(p.characterClass).toBe("knight");
    expect(p.maxHp).toBe(CHARACTER_REGISTRY.knight.maxHp);
    h.dispose();
  });

  it("falls back to the default skin for an unknown characterType", async () => {
    const h = await createRoom();
    h.join("s0", { characterType: "not-a-skin" });
    expect(CHARACTER_TYPES).toContain(h.state.players.get("s0")!.characterType);
    h.dispose();
  });

  it("refuses a junk class through setLoadout too, not just at join", async () => {
    // The same path is reachable from the lobby, so the guard has to cover both.
    const h = await createRoom();
    const c = h.join("s0", { characterClass: "mage" });

    expect(() => h.send(c, "setLoadout", {
      characterClass: "necromancer",
      characterType: "eldritch-horror",
      weaponId: "not-a-weapon",
    })).not.toThrow();

    const p = h.state.players.get("s0")!;
    expect(p.characterClass).toBe("knight");
    expect(CHARACTER_TYPES).toContain(p.characterType);
    expect(WEAPON_REGISTRY[p.weaponId]).toBeDefined();
    h.dispose();
  });

  it("clamps an oversized player name", async () => {
    const h = await createRoom();
    h.join("s0", { playerName: "y".repeat(500) });
    expect(h.state.players.get("s0")!.name).toHaveLength(MAX_PLAYER_NAME_LEN);
    h.dispose();
  });

  it("spreads the party across distinct spawn points", async () => {
    const h = await createRoom();
    for (let i = 0; i < 4; i++) h.join(`s${i}`);
    const spots = new Set([...h.state.players.values()].map(p => `${p.x},${p.y}`));
    expect(spots.size).toBeGreaterThan(1);
    h.dispose();
  });

  it("renames a player on request", async () => {
    const h = await createRoom();
    const c = h.join("s0");
    h.send(c, "setName", { name: "Renamed" });
    expect(h.state.players.get("s0")!.name).toBe("Renamed");
    h.dispose();
  });

  it("rebuilds a player around a new class, with its new stats", async () => {
    // Stats come from the CharacterConfig at construction, so a class change is
    // a new Player rather than a mutated one.
    const h = await createRoom();
    const c = h.join("s0", { characterClass: "knight" });
    const knightHp = h.state.players.get("s0")!.maxHp;

    h.send(c, "setLoadout", { characterClass: "mage", characterType: "guy", weaponId: "oak-staff" });

    const after = h.state.players.get("s0")!;
    expect(after.characterClass).toBe("mage");
    expect(after.weaponId).toBe("oak-staff");
    expect(after.maxHp).not.toBe(knightHp);
    h.dispose();
  });

  it("keeps a player's name and ready state across a loadout change", async () => {
    const h = await createRoom();
    const host = h.join("s0");
    const c = h.join("s1", { playerName: "Keep" });
    h.send(c, "setReady", { ready: true });
    h.send(c, "setLoadout", { characterClass: "rogue", characterType: "guy", weaponId: "kris" });

    const after = h.state.players.get("s1")!;
    expect(after.name).toBe("Keep");
    expect(after.ready).toBe(true);
    void host;
    h.dispose();
  });

  it("marks couch players ready on arrival — they share a screen with the host", async () => {
    const h = await createRoom();
    h.join("s0");
    h.join("s1", { couch: true });
    expect(h.state.players.get("s1")!.ready).toBe(true);
    h.dispose();
  });

  it("refuses to start while anyone is still not ready, and says who", async () => {
    const h = await createRoom();
    const host = h.join("s0");
    h.join("s1", { playerName: "Slowpoke" });

    h.send(host, "startRun", {});

    expect(h.state.phase).toBe("lobby");
    expect(host.sent.at(-1)!.type).toBe("lobby_error");
    expect((host.sent.at(-1)!.payload as { reason: string }).reason).toContain("Slowpoke");
    h.dispose();
  });

  it("refuses a start from anyone but the host", async () => {
    const h = await createRoom();
    h.join("s0");
    const other = h.join("s1");
    h.send(other, "setReady", { ready: true });

    h.send(other, "startRun", {});

    expect(h.state.phase).toBe("lobby");
    expect((other.sent.at(-1)!.payload as { reason: string }).reason).toMatch(/host/i);
    h.dispose();
  });

  it("treats the host as implicitly ready — they are the one pressing Start", async () => {
    const h = await createRoom();
    const host = h.join("s0");
    h.send(host, "startRun", {});
    expect(h.state.phase).toBe("run");
    h.dispose();
  });

  it("hands the host role on when the host leaves", async () => {
    const h = await createRoom();
    const host = h.join("s0");
    h.join("s1");

    h.leave(host);

    expect(h.state.hostSessionId).toBe("s1");
    h.dispose();
  });

  it("leaves no host behind when the last player leaves", async () => {
    const h = await createRoom();
    const only = h.join("s0");
    h.leave(only);
    expect(h.state.hostSessionId).toBe("");
    h.dispose();
  });
});

describe("starting the run", () => {
  it("flips to the run phase and locks the room", async () => {
    const h = await startedRoom(2);
    expect(h.state.phase).toBe("run");
    expect(h.isLocked()).toBe(true); // D12: no dropping into a run in progress
    expect((h.metadata() as RoomMetadata).phase).toBe("run");
    h.dispose();
  });

  it("populates the floor only now, not at the first join", async () => {
    const h = await createRoom();
    const host = h.join("s0");
    expect(h.state.enemies.size).toBe(0);

    h.send(host, "startRun", {});

    expect(h.state.enemies.size).toBeGreaterThan(0);
    h.dispose();
  });

  it("re-lands everyone on a known-good spawn tile", async () => {
    const h = await createRoom();
    const host = h.join("s0");
    guts(h).players.get("s0")!.teleport(4, 4); // somewhere absurd

    h.send(host, "startRun", {});

    const spawns = guts(h).currentDungeon.playerSpawns;
    const p = h.state.players.get("s0")!;
    expect(spawns.some(s => s.x === p.x && s.y === p.y)).toBe(true);
    h.dispose();
  });

  it("opens the doors of every room that has no enemies", async () => {
    const h = await startedRoom(1);
    expect(h.of("connections_parent_unlocked").length).toBeGreaterThan(0);
    h.dispose();
  });

  it("refuses every lobby message once running, with a reason", async () => {
    const h = await startedRoom(1);
    const c = h.clients[0];
    c.sent.length = 0;

    for (const msg of ["setName", "setLoadout", "setReady", "startRun"]) {
      h.send(c, msg, {});
    }

    expect(c.sent).toHaveLength(4);
    for (const m of c.sent) expect(m.type).toBe("lobby_error");
    h.dispose();
  });
});

describe("the tick", () => {
  it("simulates nothing until the run starts", async () => {
    const h = await createRoom();
    h.join("s0");
    const before = { ...h.state.players.get("s0")! };
    h.tick(20);
    expect(h.state.players.get("s0")!.x).toBe(before.x);
    h.dispose();
  });

  it("applies a player's input and moves them", async () => {
    const h = await startedRoom(1);
    const p = guts(h).players.get("s0")!;
    p.lastInput = { dx: 1, dy: 0, attack: false };
    const x0 = p.state.x;

    h.tick(5);

    expect(p.state.x).toBeGreaterThan(x0);
    expect(p.state.facing).toBe("right");
    h.dispose();
  });

  it("freezes everything while a player has the inventory open", async () => {
    const h = await startedRoom(1);
    const p = guts(h).players.get("s0")!;
    p.lastInput = { dx: 1, dy: 0, attack: false };

    h.send(h.clients[0], "setPause", { paused: true });
    expect(h.state.paused).toBe(true);
    const frozenAt = p.state.x;
    h.tick(10);
    expect(p.state.x).toBe(frozenAt);

    h.send(h.clients[0], "setPause", { paused: false });
    h.tick(5);
    expect(p.state.x).toBeGreaterThan(frozenAt);
    h.dispose();
  });

  it("stays paused while ANY player still has it open", async () => {
    const h = await startedRoom(2);
    h.send(h.clients[0], "setPause", { paused: true });
    h.send(h.clients[1], "setPause", { paused: true });

    h.send(h.clients[0], "setPause", { paused: false });
    expect(h.state.paused).toBe(true);

    h.send(h.clients[1], "setPause", { paused: false });
    expect(h.state.paused).toBe(false);
    h.dispose();
  });

  it("never lets a disconnect while paused freeze the room forever", async () => {
    const h = await startedRoom(2);
    h.send(h.clients[1], "setPause", { paused: true });
    expect(h.state.paused).toBe(true);

    h.leave(h.clients[1]);

    expect(h.state.paused).toBe(false);
    h.dispose();
  });

  it("runs enemy AI only in rooms a player is standing in", async () => {
    // Nothing ticks in a room with no player in it (playtest B14).
    const h = await startedRoom(1, { debug: debug({ enemiesPerRoom: 2, gridCols: 3, gridRows: 3 }) });
    const g = guts(h);
    const far = [...g.enemies.values()].filter(e => {
      const p = g.players.get("s0")!;
      return Math.hypot(e.state.x - p.state.x, e.state.y - p.state.y) > 800;
    });
    expect(far.length).toBeGreaterThan(0);
    const before = far.map(e => ({ x: e.state.x, y: e.state.y }));

    h.tick(20);

    for (let i = 0; i < far.length; i++) {
      expect(far[i].state.x).toBe(before[i].x);
      expect(far[i].state.y).toBe(before[i].y);
    }
    h.dispose();
  });

  it("broadcasts where hits landed so clients can spark them", async () => {
    const h = await startedRoom(1, { debug: debug({ enemiesPerRoom: 3, enemyTypes: ["goo-green"] }) });
    const g = guts(h);
    const p = g.players.get("s0")!;
    // Park an enemy right in front of the player and swing.
    const enemy = [...g.enemies.values()][0];
    enemy.teleport(p.state.x + 12, p.state.y);
    p.state.facing = "right";
    p.lastInput = { dx: 0, dy: 0, attack: true };
    h.clearBroadcasts();

    h.tick(15);

    const impacts = h.of("hits") as Array<{ impacts: Array<{ x: number; y: number }> }>;
    expect(impacts.length).toBeGreaterThan(0);
    expect(impacts[0].impacts.length).toBeGreaterThan(0);
    h.dispose();
  });

  it("locks a room behind a player who walks into it, then opens it on clear", async () => {
    const h = await startedRoom(1, { debug: debug({ enemiesPerRoom: 1, gridCols: 2, gridRows: 1 }) });
    const g = guts(h);
    const occupied = [...g.enemies.values()][0];
    g.players.get("s0")!.teleport(occupied.state.x, occupied.state.y);
    h.clearBroadcasts();

    h.tick(2);
    expect(h.of("connections_child_locked").length).toBeGreaterThan(0);

    // Kill everything in the room and the barriers come down.
    for (const e of g.enemies.values()) e.takeDamage(99999);
    h.tick(3);
    expect(
      h.of("connections_child_unlocked").length + h.of("connections_parent_unlocked").length,
    ).toBeGreaterThan(0);
    h.dispose();
  });

  it("releases a room the party has abandoned, so nobody is stranded", async () => {
    const h = await startedRoom(1, { debug: debug({ enemiesPerRoom: 1, gridCols: 2, gridRows: 1 }) });
    const g = guts(h);
    const enemy = [...g.enemies.values()][0];
    g.players.get("s0")!.teleport(enemy.state.x, enemy.state.y);
    h.tick(2);
    h.clearBroadcasts();

    // The player leaves the room entirely without clearing it.
    const start = g.currentDungeon.rooms.find(r => r.id === g.currentDungeon.startRoomId)!;
    const rect = roomInteriorRect(start as never);
    g.players.get("s0")!.teleport((rect.xMin + rect.xMax) / 2, (rect.yMin + rect.yMax) / 2);
    h.tick(3);

    expect(h.of("connections_child_unlocked").length).toBeGreaterThan(0);
    h.dispose();
  });

  it("answers a client asking for the whole barrier picture", async () => {
    const h = await startedRoom(1);
    const c = h.clients[0];
    c.sent.length = 0;

    h.send(c, "requestBarrierState", {});

    const msg = c.sent.find(m => m.type === "barrier_state")!;
    expect(msg).toBeDefined();
    expect(msg.payload).toHaveProperty("parentStanding");
    expect(msg.payload).toHaveProperty("childStanding");
    h.dispose();
  });
});

describe("descending", () => {
  /** Put the whole party on the stairs. */
  function standOnStairs(h: RoomHarness) {
    const g = guts(h);
    const { col, row } = g.currentDungeon.stairsTile;
    for (const sid of g.players.keys()) place(h, sid, col, row);
  }

  it("does not descend until the WHOLE party is on the stairs", async () => {
    const h = await startedRoom(2, { debug: debug({ enemiesPerRoom: 0 }) });
    const g = guts(h);
    const { col, row } = g.currentDungeon.stairsTile;
    place(h, "s0", col, row); // only one of the two

    h.tick(3);

    expect(h.state.floor).toBe(1);
    expect(h.state.playersOnStairs).toBe(1);
    expect(h.state.stairsPartySize).toBe(2);
    h.dispose();
  });

  it("descends once everyone is standing on them", async () => {
    const h = await startedRoom(2, { debug: debug({ enemiesPerRoom: 0 }) });
    standOnStairs(h);

    h.tick(2);

    expect(h.state.floor).toBe(2);
    expect(h.of("floor_change")).toHaveLength(1);
    h.dispose();
  });

  it("descends immediately when solo", async () => {
    const h = await startedRoom(1, { debug: debug({ enemiesPerRoom: 0 }) });
    standOnStairs(h);
    h.tick(2);
    expect(h.state.floor).toBe(2);
    h.dispose();
  });

  it("advances only once when two players land in the same tick", async () => {
    const h = await startedRoom(2, { debug: debug({ enemiesPerRoom: 0 }) });
    standOnStairs(h);
    h.tick(10);
    expect(h.state.floor).toBe(2);
    expect(h.of("floor_change")).toHaveLength(1);
    h.dispose();
  });

  it("leaves a downed teammate out of the required count, so nobody is stranded", async () => {
    const h = await startedRoom(2, { debug: debug({ enemiesPerRoom: 0 }) });
    const g = guts(h);
    g.players.get("s1")!.state.health = 0;
    const { col, row } = g.currentDungeon.stairsTile;
    place(h, "s0", col, row);

    h.tick(2);

    expect(h.state.floor).toBe(2);
    h.dispose();
  });

  it("builds a fresh floor and moves everyone to it", async () => {
    const h = await startedRoom(1, { debug: debug({ enemiesPerRoom: 1 }) });
    const seed0 = h.state.seed;
    const enemies0 = [...guts(h).enemies.keys()];
    standOnStairs(h);

    h.tick(2);

    expect(h.state.seed).toBe(seed0 + 1);
    // The old floor's creatures are gone, and new ones exist.
    const enemies1 = [...guts(h).enemies.keys()];
    expect(enemies1.some(id => enemies0.includes(id))).toBe(false);
    expect(enemies1.length).toBeGreaterThan(0);

    const msg = h.of("floor_change")[0] as { seed: number; floor: number; spawnX: number; spawnY: number };
    expect(msg.seed).toBe(h.state.seed);
    expect(msg.floor).toBe(2);
    h.dispose();
  });

  it("heals the party on arrival", async () => {
    const h = await startedRoom(1, { debug: debug({ enemiesPerRoom: 0 }) });
    const p = guts(h).players.get("s0")!;
    p.state.health = 1;
    standOnStairs(h);

    h.tick(2);

    expect(p.state.health).toBe(p.maxHp);
    h.dispose();
  });

  it("clears the previous floor's projectiles", async () => {
    const h = await startedRoom(1, { debug: debug({ enemiesPerRoom: 0 }) });
    const p = guts(h).players.get("s0")!;
    // Fired downward: the spawn tile has walls close to either side, and a shot
    // into one dies on its first tick.
    p.spawnProjectile("arrow", p.state.x, p.state.y, Math.PI / 2);
    h.tick(1);
    expect(guts(h).projectiles.size).toBeGreaterThan(0);
    expect(h.state.projectiles.size).toBeGreaterThan(0);

    standOnStairs(h);
    h.tick(2);

    expect(guts(h).projectiles.size).toBe(0);
    expect(h.state.projectiles.size).toBe(0);
    h.dispose();
  });
});

describe("traps", () => {
  it("swallow several floors the instant one player steps on one", async () => {
    // A trap is not a party decision like the stairs — it fires on contact.
    const h = await startedRoom(2, { debug: debug({ enemiesPerRoom: 0 }) });
    const g = guts(h);
    // Plant a trap under one player rather than hunting a seed that rolls one:
    // what is under test is GameRoom's reaction, not the generator's placement.
    const p = g.players.get("s0")!;
    const col = Math.floor(p.state.x / TILE_SIZE);
    const row = Math.floor(p.state.y / TILE_SIZE);
    (g.currentDungeon as unknown as { mapData: number[][] }).mapData[row][col] = TILE.TRAP;

    h.tick(2);

    expect(h.state.floor).toBeGreaterThanOrEqual(1 + TRAP_MIN_FLOORS);
    expect(h.state.floor).toBeLessThanOrEqual(1 + TRAP_MAX_FLOORS);
    h.dispose();
  });

  it("skips the floors it swallowed rather than generating them", async () => {
    const h = await startedRoom(1, { debug: debug({ enemiesPerRoom: 0 }) });
    const g = guts(h);
    const seed0 = h.state.seed;
    const p = g.players.get("s0")!;
    const col = Math.floor(p.state.x / TILE_SIZE);
    const row = Math.floor(p.state.y / TILE_SIZE);
    (g.currentDungeon as unknown as { mapData: number[][] }).mapData[row][col] = TILE.TRAP;

    h.tick(2);

    // Seed and floor advance by the same number of steps — one generation, not N.
    expect(h.state.seed - seed0).toBe(h.state.floor - 1);
    expect(h.of("floor_change")).toHaveLength(1);
    h.dispose();
  });
});

describe("death and respawn", () => {
  it("puts a dead player back at a spawn point, at full health", async () => {
    const h = await startedRoom(1, { debug: debug({ enemiesPerRoom: 0 }) });
    const p = guts(h).players.get("s0")!;
    p.teleport(2000, 2000);
    p.state.health = 0;

    h.tick(2);

    expect(p.state.health).toBe(p.maxHp);
    // Back on a spawn tile (within a hair — the physics step runs after the
    // respawn and the solver settles the body by a fraction of a pixel).
    const spawns = guts(h).currentDungeon.playerSpawns;
    expect(spawns.some(s => Math.hypot(s.x - p.state.x, s.y - p.state.y) < 1)).toBe(true);
    h.dispose();
  });

  it("leaves living players where they are", async () => {
    const h = await startedRoom(2, { debug: debug({ enemiesPerRoom: 0 }) });
    const alive = guts(h).players.get("s1")!;
    guts(h).players.get("s0")!.state.health = 0;
    const where = { x: alive.state.x, y: alive.state.y };

    h.tick(2);

    expect(alive.state.x).toBe(where.x);
    expect(alive.state.y).toBe(where.y);
    h.dispose();
  });
});

describe("leaving", () => {
  it("removes the player from the world and the wire", async () => {
    const h = await startedRoom(2, { debug: debug({ enemiesPerRoom: 0 }) });
    h.leave(h.clients[1]);

    expect(h.state.players.has("s1")).toBe(false);
    expect(guts(h).players.has("s1")).toBe(false);
    expect(() => h.tick(5)).not.toThrow();
    h.dispose();
  });
});

describe("room challenges on a live floor", () => {
  it("mirrors a wave room's banner onto the wire", async () => {
    const h = await startedRoom(1, { debug: debug({ gridCols: 1, gridRows: 1, roomType: "wave", enemiesPerRoom: 1 }) });
    const waveRoom = guts(h).currentDungeon.rooms.find(r => r.type === "wave")!;

    h.tick(1);

    const st = h.state.challenges.get(waveRoom.id)!;
    expect(st).toBeDefined();
    expect(st.text).toBe("Wave 1 / 3");
    expect(st.complete).toBe(false);
    h.dispose();
  });

  it("counts a timed room's clock down on the wire once the party arrives", async () => {
    const h = await startedRoom(1, { debug: debug({ gridCols: 1, gridRows: 1, roomType: "timed", enemiesPerRoom: 1 }) });
    const g = guts(h);
    const timed = g.currentDungeon.rooms.find(r => r.type === "timed")!;
    const rect = roomInteriorRect(timed as never);
    g.players.get("s0")!.teleport((rect.xMin + rect.xMax) / 2, (rect.yMin + rect.yMax) / 2);

    h.tick(1);
    expect(h.state.challenges.get(timed.id)!.text).toBe("Time 0:45");

    h.tick(Math.ceil(2000 / SERVER_TICK_MS));
    expect(h.state.challenges.get(timed.id)!.text).toBe("Time 0:43");
    h.dispose();
  });

  it("gives an ordinary room no challenge entry at all", async () => {
    const h = await startedRoom(1, { debug: debug({ gridCols: 2, gridRows: 2, roomType: "combat" }) });
    expect(h.state.challenges.size).toBe(0);
    h.dispose();
  });

  it("rebuilds the challenge set on the next floor", async () => {
    const h = await startedRoom(1, { debug: debug({ gridCols: 1, gridRows: 1, roomType: "wave", enemiesPerRoom: 0 }) });
    const first = [...h.state.challenges.keys()];
    const g = guts(h);
    const { col, row } = g.currentDungeon.stairsTile;
    place(h, "s0", col, row);

    h.tick(2);

    expect(h.state.floor).toBe(2);
    expect(h.state.challenges.size).toBe(first.length); // same showcase, rebuilt
    h.dispose();
  });
});

describe("loot messages reach the directors", () => {
  it("buys from a shop pedestal the player is standing at", async () => {
    const h = await startedRoom(1, { debug: debug({ gridCols: 1, gridRows: 1, roomType: "shop", enemiesPerRoom: 0 }) });
    const g = guts(h);
    const shopRoom = g.currentDungeon.rooms.find(r => r.type === "shop")!;
    const shop = h.state.shops.get(shopRoom.id)!;
    const item = shop.items[0];
    g.players.get("s0")!.teleport(item!.x, item!.y);

    h.send(h.clients[0], "buy", { roomId: shopRoom.id, itemIndex: 0 });

    expect(item!.purchased).toBe(true);
    expect(h.state.players.get("s0")!.weapons).toHaveLength(2);
    h.dispose();
  });

  it("claims a shrine card", async () => {
    const h = await startedRoom(1, { debug: debug({ gridCols: 1, gridRows: 1, roomType: "shrine", enemiesPerRoom: 0 }) });
    const g = guts(h);
    const shrine = g.currentDungeon.rooms.find(r => r.type === "shrine")!;
    const offer = h.state.offers.get(shrine.id)!;
    g.players.get("s0")!.teleport(offer.x, offer.y);

    h.send(h.clients[0], "offerPick", { roomId: shrine.id, choiceIndex: 0 });

    expect([...offer.consumed]).toEqual([0]);
    h.dispose();
  });

  it("opens a chest", async () => {
    const h = await startedRoom(1, { debug: debug({ gridCols: 1, gridRows: 1, roomType: "chest", enemiesPerRoom: 0 }) });
    const g = guts(h);
    const chestRoom = g.currentDungeon.rooms.find(r => r.type === "chest")!;
    const chest = h.state.chests.get(chestRoom.id)!;
    g.players.get("s0")!.teleport(chest.x, chest.y);

    h.send(h.clients[0], "chestOpen", { roomId: chestRoom.id });

    expect(chest.opened).toBe(true);
    expect(h.state.players.get("s0")!.weapons).toHaveLength(2);
    h.dispose();
  });

  it("switches the active weapon", async () => {
    const h = await startedRoom(1, { debug: debug({ enemiesPerRoom: 0 }) });
    const p = guts(h).players.get("s0")!;
    p.addWeapon(WEAPON_REGISTRY["longbow"]);

    h.send(h.clients[0], "switchWeapon", { delta: 1 });

    expect(p.weapon.id).toBe("longbow");
    h.dispose();
  });

  it("ignores loot messages from a session with no player", async () => {
    const h = await startedRoom(1, { debug: debug({ enemiesPerRoom: 0 }) });
    const ghost: FakeClient = { sessionId: "nobody", sent: [], send() {} };
    expect(() => {
      h.send(ghost, "buy", { roomId: "0,0", itemIndex: 0 });
      h.send(ghost, "offerPick", { roomId: "0,0", choiceIndex: 0 });
      h.send(ghost, "chestOpen", { roomId: "0,0" });
      h.send(ghost, "switchWeapon", { delta: 1 });
      h.send(ghost, "input", { dx: 1, dy: 0, attack: false });
    }).not.toThrow();
    h.dispose();
  });
});

describe("a boss floor, end to end", () => {
  it("drops a reward pedestal exactly once where the boss falls", async () => {
    const h = await startedRoom(1, { debug: debug({ gridCols: 1, gridRows: 1, roomType: "boss", enemiesPerRoom: 0 }) });
    const g = guts(h);
    const bossRoom = g.currentDungeon.rooms.find(r => r.type === "boss")!;
    expect(g.enemies.size).toBe(1);

    const boss = [...g.enemies.values()][0];
    boss.takeDamage(999_999);
    h.tick(3);

    const offer = h.state.offers.get(bossRoom.id);
    expect(offer).toBeDefined();
    expect(offer!.choices.length).toBeGreaterThan(0);

    // A lingering corpse must not keep dropping loot.
    const first = h.state.offers.get(bossRoom.id);
    h.tick(10);
    expect(h.state.offers.get(bossRoom.id)).toBe(first);
    h.dispose();
  });

  it("survives a long fight without throwing", async () => {
    const h = await startedRoom(2, { debug: debug({ gridCols: 1, gridRows: 1, roomType: "boss", enemiesPerRoom: 0 }) });
    const g = guts(h);
    const boss = [...g.enemies.values()][0];
    for (const p of g.players.values()) {
      p.teleport(boss.state.x + 120, boss.state.y);
      p.lastInput = { dx: 0, dy: 0, attack: true };
      p.state.health = 100_000;
    }

    expect(() => h.tick(300)).not.toThrow();
    h.dispose();
  });
});

describe("a whole floor, ticked hard", () => {
  it("runs hundreds of ticks with a full party and every room type without throwing", async () => {
    for (const roomType of ["combat", "maze", "wave", "timed", "dark", "shop", "shrine", "chest"] as RoomType[]) {
      const h = await startedRoom(4, { debug: debug({ gridCols: 2, gridRows: 2, roomType, enemiesPerRoom: 2 }) });
      const g = guts(h);
      let i = 0;
      for (const p of g.players.values()) {
        p.lastInput = { dx: i % 2 ? 1 : -1, dy: i % 3 ? 1 : -1, attack: true };
        i++;
      }

      expect(() => h.tick(200), roomType).not.toThrow();
      // And the world is still coherent.
      expect(h.state.players.size).toBe(4);
      expect(g.enemies.size).toBe(h.state.enemies.size);
      h.dispose();
    }
  });
});
