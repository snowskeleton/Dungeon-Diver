import {
  TILE, TILE_SIZE, TILE_PROPS, TileId, tileCenter,
  ROOM_W, ROOM_H,
  ENEMY_BASE_COUNT, ENEMY_FLOOR_BONUS_INTERVAL, ENEMY_PLAYER_SCALE,
  DungeonResult, DungeonOptions, RoomData, RoomType,
  DebugConfig, roomInteriorRect,
} from "shared";
import { GameState } from "../schema/GameState";
import { Enemy, EnemyClass } from "../entities/Enemy";
import { Player } from "../entities/Player";
import { REGULAR_ENEMIES } from "../entities/enemies";
import { BOSSES } from "../entities/bosses";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { FloorManager } from "../floor/FloorManager";

// Room types that never get rank-and-file enemies: the boss room has its boss, and
// the rest are reward rooms whose whole point is being safe to walk into. A debug
// `enemiesPerRoom` override still forces enemies into all of them.
const NO_RABBLE_ROOM_TYPES: RoomType[] = [
  "boss",
  "shop",
  "shrine",
  "chest",
];

/** Everything that puts a creature on the floor: the per-room rabble pass, the
 *  floor's one boss, and boss-summoned minions. Owns the enemy id counter, and
 *  registers each spawn with the physics world, the schema, and FloorManager. */
export class SpawnDirector {
  private enemyCounter = 0;
  private dungeon!: DungeonResult;
  private physics!: PhysicsWorld;
  private floorManager!: FloorManager;

  constructor(
    private readonly state: GameState,
    private readonly enemies: Map<string, Enemy>,
    private readonly players: Map<string, Player>,
    private readonly debug: DebugConfig | null,
    private readonly dungeonOpts: DungeonOptions,
  ) {}

  /** Point at the newly generated floor. Called from GameRoom.initFloor, after the
   *  physics world and FloorManager for that floor exist. */
  setFloor(dungeon: DungeonResult, physics: PhysicsWorld, floorManager: FloorManager) {
    this.dungeon = dungeon;
    this.physics = physics;
    this.floorManager = floorManager;
  }

  // ---- the floor pass ------------------------------------------------------

  spawnFloorEnemies() {
    const count = this.enemiesPerRoom();
    // Spawned before the `count <= 0` bail: "0 enemies per room" is a statement
    // about rank-and-file, and `includeBoss` is the separate control for whether a
    // boss room exists at all. Must also run before finalizeEmptyRooms (see spawnBoss).
    this.spawnBoss();
    if (count <= 0) return;
    // An explicit debug count means "put enemies here", even in rooms that normally
    // stay empty (see NO_RABBLE_ROOM_TYPES).
    const everyRoom = this.debug != null && this.debug.enemiesPerRoom >= 0;
    // Players spawn in the start room, so it stays clear — no getting jumped on
    // load. The lone exception is a one-room debug floor (start === exit), where
    // the start room is the only place enemies could go.
    const startId = this.dungeon.startRoomId;
    const exitId = this.dungeon.exitRoomId;
    const singleRoom = startId === exitId;
    // A showcase floor auto-adds plain start/exit combat rooms to frame the room
    // being shown off. Those framing rooms stay clean so a "boss" showcase is just
    // the boss (and a "combat" showcase is just its one populated room) — unless
    // you force enemies into every room.
    const isShowcase = this.dungeonOpts.showcaseRoomType != null;
    const pool = this.enemyPool();
    const roundRobin = this.hasCustomEnemyList();
    let filled = 0; // round-robin cursor, continuous across rooms
    for (const room of this.dungeon.rooms) {
      if (room.id === startId && !singleRoom) continue;
      if (isShowcase && !everyRoom && room.id === exitId) continue;
      if (!everyRoom && NO_RABBLE_ROOM_TYPES.includes(room.type)) continue;
      for (let i = 0; i < count; i++) {
        // Round-robin walks the listed creatures in order, wrapping to the start
        // when the quota outruns the list; with no list it's a random draw.
        const cls = roundRobin ? pool[filled++ % pool.length] : pool[Math.floor(Math.random() * pool.length)];
        this.spawnEnemyInRoom(room.id, cls);
      }
    }
  }

  // One boss per floor, in the room the generator marked "boss". Rotating by
  // floor number means consecutive floors never repeat a boss. Must run before
  // FloorManager.finalizeEmptyRooms() or the boss room gets pre-cleared and its
  // barriers removed — the boss would never lock the player in.
  private spawnBoss() {
    if (BOSSES.length === 0) return;
    const room = this.dungeon.rooms.find((r) => r.type === "boss");
    if (!room) return;

    const pos = this.bossPos(room.centerCol, room.centerRow, room);
    if (!pos) return;

    const BossClass = BOSSES[(this.state.floor - 1) % BOSSES.length];
    const boss = this.addEnemy(BossClass, pos.x, pos.y);
    // Confine the boss to its room's interior — it moves by setPosition and would
    // otherwise dash straight through doorways/barriers (see Boss.setArena).
    boss.setArena(
      (room.tileCol + 1) * TILE_SIZE,
      (room.tileRow + 1) * TILE_SIZE,
      (room.tileCol + 20) * TILE_SIZE,
      (room.tileRow + 15) * TILE_SIZE,
    );
  }

  spawnEnemyInRoom(roomId: string, Cls: EnemyClass) {
    const room = this.dungeon.rooms.find((r) => r.id === roomId);
    if (!room) return;
    const pos = this.randomPosInRoom(...this.roomInterior(room));
    if (!pos) return;
    this.addEnemy(Cls, pos.x, pos.y);
  }

  // Spawn a boss-summoned minion (the Tengu's Mirror Split). It joins its
  // summoner's room so the room-clear check counts it — the barrier stays until
  // both boss and adds are down. If the requested spot is a wall, it drops on the
  // summoner instead so it never lands inside geometry.
  summonEnemy(ownerId: string, Cls: EnemyClass, x: number, y: number): void {
    const owner = this.enemies.get(ownerId);
    const tile = this.physics.tileAt(x, y);
    if (tile === null || !TILE_PROPS[tile].walkable) {
      x = owner?.state.x ?? x;
      y = owner?.state.y ?? y;
    }
    this.addEnemy(Cls, x, y);
  }

  /** The one place an enemy comes into existence: mint an id, construct it, and
   *  register it with the three things that track enemies. */
  private addEnemy<C extends EnemyClass>(Cls: C, x: number, y: number): InstanceType<C> {
    const id = `enemy_${this.enemyCounter++}`;
    const enemy = new Cls(this.physics, x, y) as InstanceType<C>;
    this.enemies.set(id, enemy);
    this.state.enemies.set(id, enemy.state);
    this.floorManager.assignEnemy(id, x, y);
    // Creatures stay in the room they spawned in (playtest B6/B14) — no wandering
    // out through a doorway, and no chasing a player into the next room.
    const home = this.floorManager.roomAt(x, y);
    if (home) enemy.confineTo(roomInteriorRect(home));
    return enemy;
  }

  // ---- pool + count --------------------------------------------------------

  enemiesPerRoom(): number {
    if (this.debug && this.debug.enemiesPerRoom >= 0) return this.debug.enemiesPerRoom;
    const floor = this.state.floor;
    const players = Math.max(1, this.players.size);
    const base = ENEMY_BASE_COUNT + Math.floor(floor / ENEMY_FLOOR_BONUS_INTERVAL);
    return Math.ceil(base * (1 + ENEMY_PLAYER_SCALE * (players - 1)));
  }

  // Which enemy classes rabble is drawn from. If the debug menu names any regular
  // enemies, the pool is exactly those, in the order they were listed (so a
  // round-robin fill matches the menu). Bosses aren't in REGULAR_ENEMIES, so a
  // boss type in the selection is ignored here — bosses only spawn in the boss
  // room, never as plain contact enemies.
  enemyPool(): EnemyClass[] {
    const picked = this.debug?.enemyTypes;
    if (picked && picked.length > 0) {
      // Resolve against every class — regular AND boss — so a selected boss
      // spawns as its real Boss subclass wherever the floor gets populated. The
      // random pool (below) stays boss-free, so only an explicit pick spawns one.
      const all: EnemyClass[] = [...REGULAR_ENEMIES, ...BOSSES];
      const chosen = picked
        .map((t) => all.find((C) => C.type === t))
        .filter((C): C is EnemyClass => C !== undefined);
      if (chosen.length > 0) return chosen;
    }
    return REGULAR_ENEMIES;
  }

  /** True when the debug menu named a specific enemy list — then the pool is
   *  filled round-robin (deterministic) rather than by random draw. */
  private hasCustomEnemyList(): boolean {
    return (this.debug?.enemyTypes?.length ?? 0) > 0;
  }

  // ---- placement -----------------------------------------------------------

  // Centre of the boss room, unless that tile is the stairs (a boss room can be
  // the exit room) or unwalkable — then anywhere open in the room.
  private bossPos(col: number, row: number, room: RoomData) {
    const tile = this.dungeon.mapData[row]?.[col] as TileId | undefined;
    if (tile !== undefined && TILE_PROPS[tile].walkable && tile !== TILE.STAIRS) {
      return tileCenter(col, row);
    }
    return this.randomPosInRoom(...this.roomInterior(room));
  }

  // Inclusive tile bounds of a room's walkable interior — the border ring (local
  // col/row 0 and ROOM_W-1/ROOM_H-1) is excluded so enemies never spawn on the
  // doorway tiles that punch through it (a spawn there drifts into the neighbour
  // and escapes FloorManager.roomAt's room classification).
  private roomInterior(
    room: { tileCol: number; tileRow: number },
  ): [number, number, number, number] {
    return [
      room.tileCol + 1,
      room.tileRow + 1,
      room.tileCol + ROOM_W - 2,
      room.tileRow + ROOM_H - 2,
    ];
  }

  private randomPosInRoom(
    colMin: number, rowMin: number, colMax: number, rowMax: number,
  ): { x: number; y: number } | null {
    const { mapData } = this.dungeon;
    const candidates: { x: number; y: number }[] = [];
    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        if (mapData[row]?.[col] !== undefined) {
          const tile = mapData[row][col] as TileId;
          if (TILE_PROPS[tile].walkable && tile !== TILE.STAIRS) {
            candidates.push(tileCenter(col, row));
          }
        }
      }
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
}
