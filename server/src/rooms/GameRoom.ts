import { Room, Client } from "colyseus";
import {
  InputMessage, TILE_SIZE, SERVER_TICK_MS, MAX_CLIENTS,
  TILE_PROPS, TileId, TILE,
  ENEMY_BASE_COUNT, ENEMY_FLOOR_BONUS_INTERVAL, ENEMY_PLAYER_SCALE,
  generateDungeon, DungeonResult, DungeonOptions, FloorChangeMessage,
  MAP_SEED, EnemyType, AMMO_REGISTRY, WEAPON_REGISTRY,
  DebugConfig, toDungeonOptions,
  Layer, canAffect, PLAYER_PROJECTILE_AFFECTS, ENEMY_PROJECTILE_AFFECTS,
} from "shared";
import { GameState } from "../schema/GameState";
import { ShopState, ShopItemState } from "../schema/ShopState";
import { Player } from "../entities/Player";
import { Enemy, EnemyClass, SpawnOpts } from "../entities/Enemy";
import { REGULAR_ENEMIES } from "../entities/enemies";
import { BOSSES } from "../entities/bosses";
import { Projectile } from "../entities/Projectile";
import { PlayerState } from "../schema/PlayerState";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { FloorManager } from "../floor/FloorManager";
const SHOP_ITEM_COUNT = 3;
// How close (px) a player must stand to a pedestal to buy it.
const BUY_RADIUS = 40;

export class GameRoom extends Room<GameState> {
  maxClients = MAX_CLIENTS;

  private players = new Map<string, Player>();
  private enemies = new Map<string, Enemy>();
  private projectiles = new Map<string, Projectile>();
  private spawnIndex = 0;
  private enemyCounter = 0;
  private projectileCounter = 0;
  private tickInterval!: ReturnType<typeof setInterval>;
  private physics!: PhysicsWorld;
  private floorManager!: FloorManager;
  private currentDungeon!: DungeonResult;
  private currentSeed = MAP_SEED;
  private stairsActive = false;
  // Non-null only for rooms created from the client's Debug menu.
  private debug: DebugConfig | null = null;
  private dungeonOpts: DungeonOptions = {};
  // Session ids with the inventory/stats menu open. While non-empty the tick
  // freezes all simulation for everyone (co-op pause).
  private pausedBy = new Set<string>();

  onCreate(options?: { debug?: DebugConfig }) {
    if (options?.debug?.enabled) {
      this.debug = options.debug;
      this.dungeonOpts = toDungeonOptions(this.debug);
      if (this.debug.seed > 0) this.currentSeed = this.debug.seed;
    }

    this.setState(new GameState());
    this.initFloor(this.currentSeed);

    this.onMessage("input", (client, input: InputMessage) => {
      const player = this.players.get(client.sessionId);
      if (player) player.lastInput = input;
    });

    this.onMessage("switchWeapon", (client, msg: { delta: number }) => {
      this.players.get(client.sessionId)?.switchWeapon(msg?.delta ?? 0);
    });

    // Buy a shop pedestal (spend HP, shared team pool). Validated server-side:
    // buyer must stand near the pedestal, item unsold, and HP > cost (never lethal).
    this.onMessage("buy", (client, msg: { roomId: string; itemIndex: number }) => {
      const player = this.players.get(client.sessionId);
      const shop = this.state.shops.get(msg?.roomId);
      const item = shop?.items[msg?.itemIndex];
      if (!player || !item || item.purchased) return;
      const dx = player.state.x - item.x;
      const dy = player.state.y - item.y;
      if (dx * dx + dy * dy > BUY_RADIUS * BUY_RADIUS) return;
      if (player.state.health <= item.cost) return;
      // Already own it? Don't charge or consume the pedestal — a teammate who
      // lacks it may still want it (shared pool).
      if (!player.addWeapon(item.weaponId)) return;
      player.spendHp(item.cost);
      item.purchased = true;
    });

    // Inventory/stats menu pause. Handlers still run while paused, so the menu
    // can be closed and weapons switched; only tick() simulation is frozen.
    this.onMessage("setPause", (client, msg: { paused: boolean }) => {
      if (msg?.paused) this.pausedBy.add(client.sessionId);
      else this.pausedBy.delete(client.sessionId);
      this.state.paused = this.pausedBy.size > 0;
    });

    this.tickInterval = setInterval(() => this.tick(), SERVER_TICK_MS);
  }

  private initFloor(seed: number) {
    this.currentSeed = seed;
    this.state.seed = seed;
    this.state.dungeonOpts = JSON.stringify(this.dungeonOpts);
    this.currentDungeon = generateDungeon(seed, this.dungeonOpts);
    const { mapData, cols, rows, rooms, connections } = this.currentDungeon;

    if (this.physics) {
      this.physics.rebuildWalls(mapData, cols, rows);
    } else {
      this.physics = new PhysicsWorld(mapData, cols, rows);
    }

    if (this.floorManager) this.floorManager.dispose();
    this.floorManager = new FloorManager(rooms, connections, this.physics);
    this.stairsActive = false;

    this.spawnShops();
  }

  // Populate each shop room with weapon pedestals (shared team pool). Rebuilt
  // per floor; the previous floor's shops are cleared here.
  private spawnShops() {
    this.state.shops.clear();
    for (const room of this.currentDungeon.rooms) {
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
        item.x = cols[i] * TILE_SIZE + TILE_SIZE / 2;
        item.y = room.centerRow * TILE_SIZE + TILE_SIZE / 2;
        shop.items.push(item);
      });
      this.state.shops.set(room.id, shop);
    }
  }

  // Nearest column to `col` on `row` whose tile isn't the stairs, so a pedestal
  // never hides the way down. Shop rooms are fully carved, so a ±2 search always
  // finds open floor.
  private freeShopCol(col: number, row: number): number {
    const { mapData } = this.currentDungeon;
    for (const offset of [0, -1, 1, -2, 2]) {
      if (mapData[row]?.[col + offset] === TILE.FLOOR) return col + offset;
    }
    return col;
  }

  // Pick N distinct weapon ids uniformly (partial Fisher–Yates from the front).
  private rollShopWeapons(n: number): string[] {
    const all = Object.keys(WEAPON_REGISTRY);
    const count = Math.min(n, all.length);
    for (let i = 0; i < count; i++) {
      const j = i + Math.floor(Math.random() * (all.length - i));
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all.slice(0, count);
  }

  private enemiesPerRoom(): number {
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
  private enemyPool(): EnemyClass[] {
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

  private spawnFloorEnemies() {
    const count = this.enemiesPerRoom();
    if (count <= 0) return;
    // An explicit debug count means "put enemies here", even in rooms that normally
    // stay empty (boss/shop/shrine).
    const everyRoom = this.debug != null && this.debug.enemiesPerRoom >= 0;
    // Players spawn in the start room, so it stays clear — no getting jumped on
    // load. The lone exception is a one-room debug floor (start === exit), where
    // the start room is the only place enemies could go.
    const startId = this.currentDungeon.startRoomId;
    const exitId = this.currentDungeon.exitRoomId;
    const singleRoom = startId === exitId;
    // A showcase floor auto-adds plain start/exit combat rooms to frame the room
    // being shown off. Those framing rooms stay clean so a "boss" showcase is just
    // the boss (and a "combat" showcase is just its one populated room) — unless
    // you force enemies into every room.
    const isShowcase = this.dungeonOpts.showcaseRoomType != null;
    const pool = this.enemyPool();
    const roundRobin = this.hasCustomEnemyList();
    let filled = 0; // round-robin cursor, continuous across rooms
    for (const room of this.currentDungeon.rooms) {
      if (room.id === startId && !singleRoom) continue;
      if (isShowcase && !everyRoom && room.id === exitId) continue;
      if (!everyRoom && (room.type === "boss" || room.type === "shop" || room.type === "shrine")) continue;
      for (let i = 0; i < count; i++) {
        // Round-robin walks the listed creatures in order, wrapping to the start
        // when the quota outruns the list; with no list it's a random draw.
        const cls = roundRobin ? pool[filled++ % pool.length] : pool[Math.floor(Math.random() * pool.length)];
        this.spawnEnemyInRoom(room.id, cls);
      }
    }
    this.spawnBoss();
  }

  // One boss per floor, in the room the generator marked "boss". Rotating by
  // floor number means consecutive floors never repeat a boss. Must run before
  // FloorManager.finalizeEmptyRooms() or the boss room gets pre-cleared and its
  // barriers removed — the boss would never lock the player in.
  private spawnBoss() {
    if (BOSSES.length === 0) return;
    const room = this.currentDungeon.rooms.find((r) => r.type === "boss");
    if (!room) return;

    const pos = this.bossPos(room.centerCol, room.centerRow, room);
    if (!pos) return;

    const BossClass = BOSSES[(this.state.floor - 1) % BOSSES.length];
    const id = `enemy_${this.enemyCounter++}`;
    const boss = new BossClass(this.physics, pos.x, pos.y);
    // Confine the boss to its room's interior — it moves by setPosition and would
    // otherwise dash straight through doorways/barriers (see Boss.setArena).
    boss.setArena(
      (room.tileCol + 1) * TILE_SIZE,
      (room.tileRow + 1) * TILE_SIZE,
      (room.tileCol + 20) * TILE_SIZE,
      (room.tileRow + 15) * TILE_SIZE,
    );
    this.enemies.set(id, boss);
    this.state.enemies.set(id, boss.state);
    this.floorManager.assignEnemy(id, pos.x, pos.y);
  }

  // Centre of the boss room, unless that tile is the stairs (a boss room can be
  // the exit room) or unwalkable — then anywhere open in the room.
  private bossPos(col: number, row: number, room: { tileCol: number; tileRow: number }) {
    const tile = this.currentDungeon.mapData[row]?.[col] as TileId | undefined;
    if (tile !== undefined && TILE_PROPS[tile].walkable && tile !== TILE.STAIRS) {
      return { x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 };
    }
    return this.randomPosInRoom(room.tileCol + 1, room.tileRow + 1, room.tileCol + 20, room.tileRow + 15);
  }

  private spawnEnemyInRoom(roomId: string, Cls: EnemyClass) {
    const room = this.currentDungeon.rooms.find(r => r.id === roomId);
    if (!room) return;
    const pos = this.randomPosInRoom(room.tileCol + 1, room.tileRow + 1, room.tileCol + 20, room.tileRow + 15);
    if (!pos) return;
    const id = `enemy_${this.enemyCounter++}`;
    const enemy = new Cls(this.physics, pos.x, pos.y);
    this.enemies.set(id, enemy);
    this.state.enemies.set(id, enemy.state);
    this.floorManager.assignEnemy(id, pos.x, pos.y);
  }

  private randomPosInRoom(
    colMin: number, rowMin: number, colMax: number, rowMax: number,
  ): { x: number; y: number } | null {
    const { mapData } = this.currentDungeon;
    const candidates: { x: number; y: number }[] = [];
    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        if (mapData[row]?.[col] !== undefined) {
          const tile = mapData[row][col] as TileId;
          if (TILE_PROPS[tile].walkable && tile !== TILE.STAIRS) {
            candidates.push({ x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 });
          }
        }
      }
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  onJoin(client: Client, options?: { characterClass?: string; characterType?: string; weaponId?: string }) {
    const spawns = this.currentDungeon.playerSpawns;
    const spawn = spawns[this.spawnIndex % spawns.length];
    this.spawnIndex++;
    const characterClass = (options?.characterClass ?? "knight") as import("shared").CharacterClass;
    const characterType = (options?.characterType ?? "guy") as import("shared").CharacterType;
    const weaponId = (options?.weaponId ?? undefined) as import("shared").WeaponId | undefined;
    const player = new Player(this.physics, spawn.x, spawn.y, characterClass, characterType, weaponId);
    this.players.set(client.sessionId, player);
    this.state.players.set(client.sessionId, player.state);

    if (this.players.size === 1 && this.enemies.size === 0) {
      this.spawnFloorEnemies();
      const parentUnlocked = this.floorManager.finalizeEmptyRooms();
      if (parentUnlocked.length > 0) {
        this.broadcast("connections_parent_unlocked", { connectionIds: parentUnlocked });
      }
    }
  }

  onLeave(client: Client) {
    const player = this.players.get(client.sessionId);
    if (player) this.physics.removeBody(player.body);
    this.players.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    // Don't let a disconnect while paused freeze the room forever.
    this.pausedBy.delete(client.sessionId);
    this.state.paused = this.pausedBy.size > 0;
  }

  onDispose() {
    clearInterval(this.tickInterval);
  }

  private advanceFloor() {
    if (this.stairsActive) return;
    this.stairsActive = true;

    const newSeed = this.currentSeed + 1;
    const newFloor = this.state.floor + 1;

    this.enemies.forEach((enemy) => this.physics.removeBody(enemy.body));
    this.enemies.clear();
    this.state.enemies.clear();
    this.projectiles.clear();
    this.state.projectiles.clear();

    this.initFloor(newSeed);
    this.state.floor = newFloor;

    const spawns = this.currentDungeon.playerSpawns;
    let i = 0;
    this.players.forEach((player) => {
      const spawn = spawns[i++ % spawns.length];
      player.teleport(spawn.x, spawn.y);
      player.state.health = player.maxHp;
    });

    this.spawnFloorEnemies();
    const preCleared = this.floorManager.finalizeEmptyRooms();
    if (preCleared.length > 0) {
      this.broadcast("connections_parent_unlocked", { connectionIds: preCleared });
    }

    const spawn = spawns[0];
    const msg: FloorChangeMessage = { seed: newSeed, floor: newFloor, spawnX: spawn.x, spawnY: spawn.y };
    this.broadcast("floor_change", msg);
  }

  // Spawns a projectile and registers it for sync. `affects` (a Layer mask)
  // decides which team its hits reach; `ownerId` is a player session id (player
  // shots) or an enemy id (boss shots), used for self-hit exclusion.
  private spawnProjectile(
    ammoId: string, x: number, y: number, angle: number, ownerId: string, affects: number,
    opts?: SpawnOpts,
  ): void {
    const ammo = AMMO_REGISTRY[ammoId];
    if (!ammo) return;
    const id = `proj_${this.projectileCounter++}`;
    // An inert marker carries no team mask, so the hit loop's canAffect checks
    // skip it entirely — it only renders and expires (its ability owns the damage).
    const projAffects = opts?.inert ? 0 : affects;
    const proj = new Projectile(this.physics, ammo, x, y, angle, ownerId, projAffects, opts?.lifetimeMs);
    this.projectiles.set(id, proj);
    this.state.projectiles.set(id, proj.state);
  }

  private tick() {
    // Frozen while any player has the inventory/stats menu open. Message handlers
    // (switch/close) keep running; only the world simulation halts.
    if (this.state.paused) return;

    const dtMs = SERVER_TICK_MS;

    // 1. Player inputs.
    this.players.forEach((player) => player.applyInput(player.lastInput, dtMs));

    // 2. Enemy AI — per-enemy visibility: a player is hidden only from enemies
    //    in rooms that don't touch the passageway the player is currently in.
    this.enemies.forEach((enemy, id) => {
      if (enemy.isDying) return;

      const enemyRoomId = this.floorManager.getEnemyRoom(id);
      const visiblePlayers = new Map<string, PlayerState>();
      this.players.forEach((player, sid) => {
        if (!this.floorManager.isProtectedFromRoom(player.state.x, player.state.y, enemyRoomId)) {
          visiblePlayers.set(sid, player.state);
        }
      });

      enemy.tick(
        visiblePlayers as unknown as Map<string, PlayerState>,
        dtMs,
        (targetSessionId, damage) => { this.players.get(targetSessionId)?.takeDamage(damage); },
        // Bosses fire projectiles through this hook; stamped with the enemy team
        // mask so the shot damages players, not other enemies (docs/layers.md).
        (ammoId, x, y, angle, opts) => this.spawnProjectile(ammoId, x, y, angle, id, ENEMY_PROJECTILE_AFFECTS, opts),
      );
    });

    // 3. Player melee attacks. (Ranged weapons have a null hurtbox → no hits here.)
    this.players.forEach((player) => {
      this.enemies.forEach((enemy, enemyId) => {
        if (enemy.isDying) return;
        if (player.tryHitEnemy(enemyId, enemy.state.x, enemy.state.y)) {
          enemy.takeDamage(player.weapon.damage);
          enemy.applyKnockback(player.state.x, player.state.y, player.weapon.attackForce);
        }
      });
    });

    // 3b. Ranged weapons: spawn a projectile on the tick a shot starts. Player
    //     shots damage enemies (and props); never other players (docs/layers.md).
    this.players.forEach((player, sid) => {
      if (!player.justAttacked) return;
      player.justAttacked = false;
      const ammoId = player.weapon.ammoId;
      if (!player.weapon.isRanged || !ammoId) return;
      this.spawnProjectile(ammoId, player.state.x, player.state.y, player.getShotAngle(), sid, PLAYER_PROJECTILE_AFFECTS);
    });

    // 3c. Move projectiles and resolve hits against whichever team the shot's
    //     `affects` mask reaches. One loop serves player and enemy projectiles.
    this.projectiles.forEach((proj, id) => {
      proj.tick(dtMs);
      if (!proj.dead) {
        if (canAffect(proj.affects, Layer.ENEMY)) {
          this.enemies.forEach((enemy, eid) => {
            if (enemy.isDying) return;
            if (proj.tryHit(eid, enemy.state.x, enemy.state.y)) {
              enemy.takeDamage(proj.cfg.damage);
              enemy.applyKnockback(proj.prevX, proj.prevY, proj.cfg.knockback);
            }
          });
        }
        if (canAffect(proj.affects, Layer.PLAYER)) {
          this.players.forEach((player, pid) => {
            if (pid === proj.ownerSessionId || player.isDead) return; // no self-hit
            if (proj.tryHit(pid, player.state.x, player.state.y)) {
              player.takeDamage(proj.cfg.damage);
            }
          });
        }
      }
      if (proj.dead) {
        this.projectiles.delete(id);
        this.state.projectiles.delete(id);
      }
    });

    // 4. Check room clears after combat. Enemies stay dead — no respawn.
    this.enemies.forEach((enemy, id) => {
      if (enemy.isDying && !enemy.clearCheckDone) {
        enemy.clearCheckDone = true;
        const { parentUnlocked, childUnlocked } = this.floorManager.onEnemyMaybeCleared(
          id, (eid) => this.enemies.get(eid)?.isDying ?? true,
        );
        if (parentUnlocked.length > 0) {
          this.broadcast("connections_parent_unlocked", { connectionIds: parentUnlocked });
        }
        if (childUnlocked.length > 0) {
          this.broadcast("connections_child_unlocked", { connectionIds: childUnlocked });
        }
      }
    });

    // 4b. Detect players entering child rooms for the first time → lock the entry barrier.
    this.players.forEach((player) => {
      const activated = this.floorManager.checkPlayerEnteredRoom(player.state.x, player.state.y);
      if (activated.length > 0) {
        this.broadcast("connections_child_locked", { connectionIds: activated });
      }
    });

    // 5–7. Physics step.
    this.players.forEach((p) => p.commitVelocity());
    this.enemies.forEach((e) => e.commitVelocity());
    this.physics.step();
    this.players.forEach((p) => p.syncFromBody());
    this.enemies.forEach((e) => e.syncFromBody());

    // 8. Tile effects.
    this.players.forEach((p) => p.applyTileEffects(dtMs));
    this.enemies.forEach((e) => { if (!e.isDying) e.applyTileEffects(dtMs); });

    // 9. Stairs detection.
    if (!this.stairsActive) {
      this.players.forEach((player) => {
        if (this.physics.tileAt(player.state.x, player.state.y) === TILE.STAIRS) {
          this.advanceFloor();
        }
      });
    }

    // 10. Dead players respawn.
    const spawns = this.currentDungeon.playerSpawns;
    let si = 0;
    this.players.forEach((player) => {
      if (player.isDead) {
        const spawn = spawns[si++ % spawns.length];
        player.teleport(spawn.x, spawn.y);
        player.state.health = player.maxHp;
      }
    });

    // 11. Softlock guard: unlock rooms that locked behind a player who is no longer
    //     inside (death respawn above, or disconnect). Runs after step 10 so dead
    //     players' positions are already back at spawn.
    const playerPositions: Array<{ x: number; y: number }> = [];
    this.players.forEach((p) => playerPositions.push({ x: p.state.x, y: p.state.y }));
    const abandoned = this.floorManager.releaseAbandonedRooms(playerPositions);
    if (abandoned.length > 0) {
      this.broadcast("connections_child_unlocked", { connectionIds: abandoned });
    }
  }
}
