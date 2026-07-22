import { Room, Client } from "colyseus";
import {
  InputMessage, SERVER_TICK_MS, MAX_CLIENTS, TILE,
  generateDungeon, DungeonResult, DungeonOptions, FloorChangeMessage,
  MAP_SEED, AMMO_REGISTRY, RoomType,
  TRAP_MIN_FLOORS, TRAP_MAX_FLOORS,
  DebugConfig, toDungeonOptions,
  Layer, PLAYER_ATTACK_AFFECTS, ENEMY_ATTACK_AFFECTS,
} from "shared";
import { GameState } from "../schema/GameState";
import { Player, resolveTemplate } from "../entities/Player";
import { upgradeById } from "../upgrades";
import { RoomChallengeState } from "../schema/RoomChallengeState";
import { RoomChallenge, ChallengeContext } from "./challenges/RoomChallenge";
import { WaveChallenge } from "./challenges/WaveChallenge";
import { TimedClearChallenge } from "./challenges/TimedClearChallenge";
import { LootDirector } from "./LootDirector";
import { SpawnDirector } from "./SpawnDirector";
import { Enemy, SpawnOpts } from "../entities/Enemy";
import { PendingEffect } from "../entities/Entity";
import { Boss } from "../entities/Boss";
import { Projectile } from "../entities/Projectile";
import { PlayerState } from "../schema/PlayerState";
import { CombatSystem, HitSource } from "../combat";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { FloorManager } from "../floor/FloorManager";

export class GameRoom extends Room<GameState> {
  maxClients = MAX_CLIENTS;

  private players = new Map<string, Player>();
  private enemies = new Map<string, Enemy>();
  private projectiles = new Map<string, Projectile>();
  private readonly combat = new CombatSystem();
  private spawnIndex = 0;
  private projectileCounter = 0;
  private tickInterval!: ReturnType<typeof setInterval>;
  private physics!: PhysicsWorld;
  private floorManager!: FloorManager;
  private loot!: LootDirector;
  private spawner!: SpawnDirector;
  // Active room objectives keyed by room id, mirrored to state.challenges.
  private challenges = new Map<string, RoomChallenge>();
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
    this.loot = new LootDirector(this.state);
    this.spawner = new SpawnDirector(
      this.state,
      this.enemies,
      this.players,
      this.debug,
      this.dungeonOpts,
    );
    this.initFloor(this.currentSeed);

    this.onMessage("input", (client, input: InputMessage) => {
      const player = this.players.get(client.sessionId);
      if (player) player.lastInput = input;
    });

    this.onMessage("switchWeapon", (client, msg: { delta: number }) => {
      this.players.get(client.sessionId)?.switchWeapon(msg?.delta ?? 0);
    });

    // The three loot interactions. Validation and granting live in LootDirector;
    // GameRoom only resolves the sender to a Player.
    this.onMessage("buy", (client, msg: { roomId: string; itemIndex: number }) => {
      const player = this.players.get(client.sessionId);
      if (player) this.loot.buy(player, msg);
    });

    this.onMessage("offerPick", (client, msg: { roomId: string; choiceIndex: number }) => {
      const player = this.players.get(client.sessionId);
      if (player) this.loot.offerPick(player, msg);
    });

    this.onMessage("chestOpen", (client, msg: { roomId: string }) => {
      const player = this.players.get(client.sessionId);
      if (player) this.loot.chestOpen(player, msg);
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

    this.loot.setFloor(this.currentDungeon, this.physics);
    this.spawner.setFloor(this.currentDungeon, this.physics, this.floorManager);

    this.loot.spawnShops();
    this.loot.spawnShrineOffers();
    this.loot.spawnChests();
    this.initChallenges();
  }

  // Build this floor's room objectives. Rooms whose type carries no challenge get
  // no entry — the map's emptiness is what "an ordinary room" means, so the tick
  // hooks below cost nothing on a normal floor.
  private initChallenges() {
    this.challenges.clear();
    this.state.challenges.clear();
    for (const room of this.currentDungeon.rooms) {
      const challenge = this.challengeFor(room.type);
      if (!challenge) continue;
      this.challenges.set(room.id, challenge);
      const st = new RoomChallengeState();
      st.roomId = room.id;
      this.state.challenges.set(room.id, st);
      this.syncChallenge(room.id);
    }
  }

  /** One exhaustive switch, not a lookup table — a new RoomType that needs a
   *  challenge is a compile error here rather than a silently ordinary room. */
  private challengeFor(type: RoomType): RoomChallenge | null {
    switch (type) {
      case "wave":
        return new WaveChallenge();
      case "timed":
        return new TimedClearChallenge();
      // A dark room is an ordinary fight the client renders differently — the
      // whole variant is a vision overlay, so there is nothing to run here.
      case "dark":
      case "combat":
      case "maze":
      case "boss":
      case "shop":
      case "shrine":
      case "chest":
        return null;
    }
  }

  private syncChallenge(roomId: string) {
    const challenge = this.challenges.get(roomId);
    const st = this.state.challenges.get(roomId);
    if (!challenge || !st) return;
    // Guarded assignment: a countdown recomputes its line every tick but only
    // changes it once a second, and an unguarded write would mark the field dirty
    // 20×/sec for every timed room on the floor.
    const text = challenge.bannerText;
    if (st.text !== text) st.text = text;
    if (st.complete !== challenge.isComplete) st.complete = challenge.isComplete;
  }

  private challengeContext(roomId: string): ChallengeContext {
    return {
      roomId,
      livingEnemyCount: (rid) => this.livingEnemyCount(rid),
      spawnEnemyInRoom: (rid, cls) => this.spawner.spawnEnemyInRoom(rid, cls),
      enemyPool: () => this.spawner.enemyPool(),
      enemiesPerRoom: () => this.spawner.enemiesPerRoom(),
      dropReward: (rid) => this.loot.dropChallengeReward(rid),
      playersInRoom: (rid) => this.playersInRoom(rid),
    };
  }

  private playersInRoom(roomId: string): boolean {
    for (const player of this.players.values()) {
      if (player.state.health <= 0) continue;
      if (this.floorManager.roomAt(player.state.x, player.state.y)?.id === roomId) return true;
    }
    return false;
  }

  /** Enemies homed to `roomId` that aren't already dying. */
  private livingEnemyCount(roomId: string): number {
    let n = 0;
    this.enemies.forEach((enemy, id) => {
      if (!enemy.isDying && this.floorManager.getEnemyRoom(id) === roomId) n++;
    });
    return n;
  }

  onJoin(client: Client, options?: { characterClass?: string; characterType?: string; weaponId?: string }) {
    const spawns = this.currentDungeon.playerSpawns;
    const spawn = spawns[this.spawnIndex % spawns.length];
    this.spawnIndex++;
    const characterClass = (options?.characterClass ?? "knight") as import("shared").CharacterClass;
    const characterType = (options?.characterType ?? "guy") as import("shared").CharacterType;
    // The weapon id comes from the client, so validate it rather than casting: it
    // now mints a real object, and an unknown id would leave the player weaponless.
    const weaponId = resolveTemplate(options?.weaponId)?.id as import("shared").WeaponId | undefined;
    const player = new Player(this.physics, spawn.x, spawn.y, characterClass, characterType, weaponId);
    // Debug-only: pre-grant upgrades so stat folding can be exercised (and balanced)
    // without walking to a shrine. Unknown ids are ignored rather than fatal.
    for (const id of this.debug?.startingUpgrades ?? []) {
      const upgrade = upgradeById(id);
      if (upgrade) player.addUpgrade(upgrade);
    }
    this.players.set(client.sessionId, player);
    this.state.players.set(client.sessionId, player.state);

    if (this.players.size === 1 && this.enemies.size === 0) {
      this.spawner.spawnFloorEnemies();
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

  /** How many floors a trap swallows. Inclusive of both bounds. */
  private rollTrapDepth(): number {
    const span = TRAP_MAX_FLOORS - TRAP_MIN_FLOORS + 1;
    return TRAP_MIN_FLOORS + Math.floor(Math.random() * span);
  }

  /** Descend `steps` floors. The stairs pass 1; a trap passes more. Advancing N
   *  floors means generating floor+N directly — the skipped floors are never
   *  built, which is exactly what "you missed them" should mean. */
  private advanceFloor(steps = 1) {
    if (this.stairsActive) return;
    this.stairsActive = true;

    const newSeed = this.currentSeed + steps;
    const newFloor = this.state.floor + steps;

    this.enemies.forEach((enemy) => this.physics.removeBody(enemy.body));
    this.enemies.clear();
    this.state.enemies.clear();
    this.projectiles.clear();
    this.state.projectiles.clear();

    this.initFloor(newSeed);
    this.state.floor = newFloor;

    this.respawnAll([...this.players.values()]);

    this.spawner.spawnFloorEnemies();
    const preCleared = this.floorManager.finalizeEmptyRooms();
    if (preCleared.length > 0) {
      this.broadcast("connections_parent_unlocked", { connectionIds: preCleared });
    }

    const spawn = this.currentDungeon.playerSpawns[0];
    const msg: FloorChangeMessage = { seed: newSeed, floor: newFloor, spawnX: spawn.x, spawnY: spawn.y };
    this.broadcast("floor_change", msg);
  }

  /** Put players back on the floor's spawn points at full health — what
   *  "respawning" means, in the one place that defines it. Used both by a floor
   *  change (everyone) and by the death check (only the dead), which had drifted
   *  into two copies of the same spawn-cycling loop. */
  private respawnAll(players: Player[]): void {
    const spawns = this.currentDungeon.playerSpawns;
    players.forEach((player, i) => {
      const spawn = spawns[i % spawns.length];
      player.teleport(spawn.x, spawn.y);
      player.state.health = player.maxHp;
    });
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
    const proj = new Projectile(
      this.physics, ammo, x, y, angle, ownerId, projAffects, opts?.lifetimeMs, opts?.attack,
    );
    // A shot fired by a player reports its damage back to that player, so lifesteal
    // works at range. The projectile itself stays ignorant of who owns it beyond
    // the session id it already carries for self-hit exclusion.
    const owner = this.players.get(ownerId);
    if (owner) proj.onDealt = (_, dmg) => owner.onDamageDealt(dmg);
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

    // 1a. Which rooms are awake this tick. An empty room simulates NOTHING —
    //     see `dormant` below — so the floor is only ever as busy as the party
    //     can see, and creatures can't drift out of a room nobody is watching.
    const playerPositions: Array<{ x: number; y: number }> = [];
    this.players.forEach((p) => playerPositions.push({ x: p.state.x, y: p.state.y }));
    const awakeRooms = this.floorManager.occupiedRoomIds(playerPositions);
    /** An enemy in a room with no player in it. Dormant enemies are skipped for
     *  AI (step 2) AND for contact damage (step 3) — "nothing ticks" is the whole
     *  point (playtest B14). Anything with no home room (spawned outside a room)
     *  is never dormant, so nothing can be stranded frozen. */
    const dormant = (id: string): boolean => {
      const roomId = this.floorManager.getEnemyRoom(id);
      return roomId !== undefined && !awakeRooms.has(roomId);
    };

    // 1b. One-way barriers (playtest B1/G1). A player inside a locked room is
    //     COMMITTED — their body starts colliding with that room's exit barrier —
    //     while a player still outside ignores it and can walk in late. This is
    //     re-evaluated every tick, so clearing the room releases everyone.
    this.players.forEach((player) => {
      this.physics.setPlayerCommitted(
        player.body,
        this.floorManager.isCommittedAt(player.state.x, player.state.y),
      );
    });

    // 2. Enemy AI — per-enemy visibility: a player is hidden only from enemies
    //    in rooms that don't touch the passageway the player is currently in.
    this.enemies.forEach((enemy, id) => {
      if (enemy.isDying) return;
      if (dormant(id)) return;

      const enemyRoomId = this.floorManager.getEnemyRoom(id);
      const visiblePlayers = new Map<string, PlayerState>();
      this.players.forEach((player, sid) => {
        if (!this.floorManager.isProtectedFromRoom(player.state.x, player.state.y, enemyRoomId)) {
          visiblePlayers.set(sid, player.state);
        }
      });

      enemy.tick(visiblePlayers, dtMs);
    });

    // 3. Combat resolution. Every entity (players' swings/shots, enemies' contact +
    //    boss abilities) queued its damage effects during its own tick; drain them
    //    into hit sources + newly-spawned projectiles, stamping team + owner here.
    //    Then advance all projectiles and hand every live hit source to the one
    //    resolver (see combat/CombatSystem).
    const sources: HitSource[] = [];
    // Summons are deferred out of the enemies.forEach below: spawning would mutate
    // the map mid-iteration. Collected here, then materialized after the loop.
    const summons: { ownerId: string; effect: Extract<PendingEffect, { kind: "summon" }> }[] = [];
    const drain = (ownerId: string, affects: number, effects: PendingEffect[]) => {
      for (const e of effects) {
        if (e.kind === "hit") sources.push(e.source);
        else if (e.kind === "summon") summons.push({ ownerId, effect: e });
        else this.spawnProjectile(e.ammoId, e.x, e.y, e.angle, ownerId, affects, e.opts);
      }
    };
    this.players.forEach((player, sid) => drain(sid, PLAYER_ATTACK_AFFECTS, player.drainEffects()));
    this.enemies.forEach((enemy, id) => {
      if (dormant(id)) return;
      const contact = enemy.contactHitSource(id);
      if (contact) sources.push(contact);
      drain(id, ENEMY_ATTACK_AFFECTS, enemy.drainEffects());
    });
    for (const s of summons) this.spawner.summonEnemy(s.ownerId, s.effect.enemy, s.effect.x, s.effect.y);

    // Advance all projectiles (including any just spawned above) and add the live
    // ones as hit sources, so a shot moves and can connect on its spawn tick.
    this.projectiles.forEach((proj) => proj.tick(dtMs));
    this.projectiles.forEach((proj) => {
      if (!proj.dead) sources.push(proj.hitSource());
    });

    const hits = this.combat.resolve(sources, [
      { layer: Layer.PLAYER, targets: this.players },
      { layer: Layer.ENEMY, targets: this.enemies },
    ]);

    // Impact feedback: tell clients where hits landed so they can play the spark.
    // Filtered to hits ON enemies, which is exactly "a player connected" — melee
    // sources carry no ownerId (they can't reach their own team, so the resolver
    // never needs one), and nothing but a player damages an enemy. One message per
    // tick rather than per hit; a cleave landing on four enemies is four points.
    if (hits.length > 0) {
      const impacts = hits
        .filter((h) => this.enemies.has(h.targetId))
        .map((h) => ({ x: Math.round(h.x), y: Math.round(h.y) }));
      if (impacts.length > 0) this.broadcast("hits", { impacts });
    }

    // Reap projectiles that hit a wall, aged out, or spent their pierce.
    this.projectiles.forEach((proj, id) => {
      if (proj.dead) {
        this.projectiles.delete(id);
        this.state.projectiles.delete(id);
      }
    });

    // 4. Check room clears after combat. Enemies stay dead — no respawn.
    //    Collected first rather than handled inside the forEach: a room challenge
    //    may spawn enemies below, which would mutate the map mid-iteration (the
    //    same reason summons are deferred in step 3).
    const newlyDown: string[] = [];
    this.enemies.forEach((enemy, id) => {
      if (enemy.isDying && !enemy.clearCheckDone) {
        enemy.clearCheckDone = true;
        newlyDown.push(id);
      }
    });
    for (const id of newlyDown) {
      const enemy = this.enemies.get(id);
      // A boss drops its reward where it fell. clearCheckDone gates this to the
      // single death tick, so it can't be farmed by a lingering corpse.
      if (enemy instanceof Boss) this.loot.dropBossOffer(enemy.state.x, enemy.state.y);

      // The room's challenge gets first refusal, BEFORE the clear check — that
      // ordering is the whole mechanism. A wave room answers the last kill of a
      // wave by putting the next wave in the room, so FloorManager's "everything
      // here is dying" test fails on its own and the door stays shut. Move this
      // after the check and the room opens for a frame on every wave break.
      const roomId = this.floorManager.getEnemyRoom(id);
      if (roomId) {
        const challenge = this.challenges.get(roomId);
        if (challenge) {
          challenge.onEnemyDown(this.challengeContext(roomId));
          this.syncChallenge(roomId);
        }
      }

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

    // 4a. Time-based challenges. Unused by waves, which are driven entirely by
    //     kills, but every challenge gets the tick so a timed one needs no new
    //     plumbing here.
    this.challenges.forEach((challenge, roomId) => {
      if (challenge.isComplete) return;
      challenge.tick(dtMs, this.challengeContext(roomId));
      this.syncChallenge(roomId);
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

    // 9. Stairs and trap detection. Both descend; a trap just skips further and
    //    isn't something the player chose. `stairsActive` gates both, so two
    //    players landing on tiles in the same tick still only advance once.
    if (!this.stairsActive) {
      this.players.forEach((player) => {
        const tile = this.physics.tileAt(player.state.x, player.state.y);
        if (tile === TILE.STAIRS) {
          this.advanceFloor();
        } else if (tile === TILE.TRAP) {
          this.advanceFloor(this.rollTrapDepth());
        }
      });
    }

    // 10. Dead players respawn.
    const dead: Player[] = [];
    this.players.forEach((player) => { if (player.isDead) dead.push(player); });
    if (dead.length > 0) this.respawnAll(dead);

    // 11. Softlock guard: unlock rooms that locked behind a player who is no longer
    //     inside (death respawn above, or disconnect). Runs after step 10 so dead
    //     players' positions are already back at spawn.
    // Recomputed rather than reusing step 1a's snapshot: respawn moved people.
    const settledPositions: Array<{ x: number; y: number }> = [];
    this.players.forEach((p) => settledPositions.push({ x: p.state.x, y: p.state.y }));
    const abandoned = this.floorManager.releaseAbandonedRooms(settledPositions);
    if (abandoned.length > 0) {
      this.broadcast("connections_child_unlocked", { connectionIds: abandoned });
    }
  }
}


/** In-place Fisher–Yates. Used for offer choices so a weapon isn't always slot 0. */
function shuffle<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}
