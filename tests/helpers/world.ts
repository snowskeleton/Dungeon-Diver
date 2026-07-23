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

/** Hold an attack until the enemy's health drops, returning how many ticks it
 *  took. Melee swings genuinely wind up (the FX strip's leading frames are
 *  empty), so "attack once and assert" is not a thing a test can do. */
export function swingUntilHit(a: Arena, playerId: string, enemyId: string, maxTicks = 25): number {
  const enemy = a.enemies.get(enemyId)!;
  const hp0 = enemy.state.health;
  for (let t = 1; t <= maxTicks; t++) {
    a.stepWithInput(playerId, 0, 0, true);
    if (enemy.state.health !== hp0) return t;
  }
  return -1;
}

export { SERVER_TICK_MS };
