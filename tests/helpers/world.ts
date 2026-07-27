// Shared scaffolding for tests that need a real world: a flat map, a real
// PhysicsWorld, and the exact gather+resolve step GameRoom.tick runs.
//
// This is deliberately a faithful copy of GameRoom's combat step rather than a
// simplified stand-in — a test that resolves damage differently from the game
// proves nothing about the game.

import {
  TILE,
  TileId,
  Layer,
  SERVER_TICK_MS,
  AMMO_REGISTRY,
  WEAPON_REGISTRY,
  WeaponId,
  CharacterClass,
  CharacterType,
  PLAYER_ATTACK_AFFECTS,
  ENEMY_ATTACK_AFFECTS,
} from "shared";
import { PhysicsWorld } from "../../server/src/physics/PhysicsWorld";
import { Player } from "../../server/src/entities/Player";
import { Enemy } from "../../server/src/entities/Enemy";
import { Projectile } from "../../server/src/entities/Projectile";
import { CombatSystem } from "../../server/src/combat/CombatSystem";
import { HitSource } from "../../server/src/combat/HitSource";
import { HitEvent } from "../../server/src/combat/CombatSystem";

export const COLS = 60;
export const ROWS = 40;

/** An all-floor map big enough that nothing in a test touches a wall. */
export function flatMap(cols = COLS, rows = ROWS, tile: TileId = TILE.FLOOR): TileId[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => tile));
}

export function flatWorld(cols = COLS, rows = ROWS): PhysicsWorld {
  return new PhysicsWorld(flatMap(cols, rows), cols, rows);
}

/** A Player already holding a weapon. Players now spawn empty-handed (the first
 *  weapon comes from a supply pedestal), so any test that needs to attack must arm
 *  the player explicitly — this is the shared way to do it. */
export function armedPlayer(
  physics: PhysicsWorld,
  x: number,
  y: number,
  cls: CharacterClass,
  type: CharacterType,
  weaponId: WeaponId,
): Player {
  const p = new Player(physics, x, y, cls, type);
  p.addWeapon(WEAPON_REGISTRY[weaponId]);
  return p;
}

/** A world where a single tile has been swapped — for tile-effect tests. */
export function worldWithTile(col: number, row: number, tile: TileId): PhysicsWorld {
  const map = flatMap();
  map[row][col] = tile;
  return new PhysicsWorld(map, COLS, ROWS);
}

export interface Arena {
  physics: PhysicsWorld;
  players: Map<string, Player>;
  enemies: Map<string, Enemy>;
  projectiles: Projectile[];
  combat: CombatSystem;
  /** One full combat step, mirroring GameRoom.tick's drain → advance → resolve. */
  step(): HitEvent[];
  /** Run a player's input and then one combat step. */
  stepWithInput(id: string, dx: number, dy: number, attack: boolean): HitEvent[];
  addPlayer(id: string, p: Player): Player;
  addEnemy(id: string, e: Enemy): Enemy;
}

export function arena(physics: PhysicsWorld = flatWorld()): Arena {
  const players = new Map<string, Player>();
  const enemies = new Map<string, Enemy>();
  const projectiles: Projectile[] = [];
  const combat = new CombatSystem();

  const drain = (ownerId: string, affects: number, effects: ReturnType<Player["drainEffects"]>) => {
    for (const e of effects) {
      if (e.kind === "hit") {
        sources.push(e.source);
      } else if (e.kind === "projectile") {
        projectiles.push(new Projectile(
          physics,
          AMMO_REGISTRY[e.ammoId],
          e.x,
          e.y,
          e.angle,
          ownerId,
          e.opts?.inert ? 0 : affects,
          e.opts?.lifetimeMs,
          e.opts?.attack,
        ));
      }
    }
  };

  let sources: HitSource[] = [];

  const step = (): HitEvent[] => {
    sources = [];
    players.forEach((p, sid) => drain(sid, PLAYER_ATTACK_AFFECTS, p.drainEffects()));
    enemies.forEach((e, id) => {
      const c = e.contactHitSource(id);
      if (c) sources.push(c);
      drain(id, ENEMY_ATTACK_AFFECTS, e.drainEffects());
    });
    for (const p of projectiles) p.tick(SERVER_TICK_MS);
    for (const p of projectiles) if (!p.dead) sources.push(p.hitSource());
    return combat.resolve(sources, [
      { layer: Layer.PLAYER, targets: players as never },
      { layer: Layer.ENEMY, targets: enemies as never },
    ]);
  };

  return {
    physics,
    players,
    enemies,
    projectiles,
    combat,
    step,
    stepWithInput(id, dx, dy, attack) {
      players.get(id)!.applyInput({ dx, dy, attack }, SERVER_TICK_MS);
      return step();
    },
    addPlayer(id, p) {
      players.set(id, p);
      return p;
    },
    addEnemy(id, e) {
      enemies.set(id, e);
      return e;
    },
  };
}

/** Advance the physics for one tick the way GameRoom does: commit intent, step
 *  the engine, read positions back. */
export function physicsTick(physics: PhysicsWorld, bodies: Array<Player | Enemy>): void {
  for (const b of bodies) b.commitVelocity();
  physics.step();
  for (const b of bodies) b.syncFromBody();
}

/** Tap the attack once and let the swing play out until the enemy's health drops,
 *  returning how many ticks it took. Melee is DEFERRED (a press holds a wind-up
 *  that fires on release), so this presses for the first tick then releases — a
 *  short tap, i.e. a regular swing, not a charged one. And swings genuinely wind
 *  up (the FX strip's leading frames are empty), so a hit lands several ticks in,
 *  never on the release tick itself. */
export function swingUntilHit(a: Arena, playerId: string, enemyId: string, maxTicks = 25): number {
  const enemy = a.enemies.get(enemyId)!;
  const hp0 = enemy.state.health;
  for (let t = 1; t <= maxTicks; t++) {
    a.stepWithInput(playerId, 0, 0, t === 1); // tap: press once, then release
    if (enemy.state.health !== hp0) return t;
  }
  return -1;
}

/** Tap the attack once and step `ticks` times, letting the (regular) swing play
 *  through its window — for tests that assert on the world AFTER a full swing. */
export function tapSwing(a: Arena, playerId: string, ticks = 15): void {
  for (let t = 0; t < ticks; t++) a.stepWithInput(playerId, 0, 0, t === 0);
}

export { SERVER_TICK_MS };
