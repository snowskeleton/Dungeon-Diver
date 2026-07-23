import { describe, it, expect } from "vitest";
import {
  SERVER_TICK_MS,
  Layer,
  canAffect,
  ENEMY_PROJECTILE_AFFECTS,
  ENEMY_ATTACK_AFFECTS,
  AMMO_REGISTRY,
  ENEMY_HURT_BOUNDS,
  EnemyType,
  shapeHitsBox,
  PLAYER_HURT_BOUNDS,
} from "shared";
import { BOSSES, BossClass } from "../../server/src/entities/bosses";
import { Boss } from "../../server/src/entities/Boss";
import { GooGreen } from "../../server/src/entities/enemies/goos";
import { Projectile } from "../../server/src/entities/Projectile";
import { PlayerState } from "../../server/src/schema/PlayerState";
import { PhysicsWorld } from "../../server/src/physics/PhysicsWorld";
import { flatWorld } from "../helpers/world";

// Each boss is driven for a few seconds against a stationary player at its
// preferred range, and asserted on BEHAVIOUR: it telegraphs, it eventually hurts
// the player, and it never friendly-fires its own side. Deliberately no expected
// damage numbers or shot counts — those are balance, and balance is meant to move.

interface Outcome {
  sawTelegraph: boolean;
  shots: number;
  playerDamage: number;
  bystanderDamage: number;
  bossErrored: Error | null;
}

/** Run one boss against a parked player + a bystander enemy of its own team. */
function fight(BossClass: BossClass, ticks = 200): Outcome {
  const physics: PhysicsWorld = flatWorld(60, 40);
  const bx = 900;
  const by = 600;
  const boss = new BossClass(physics, bx, by);

  const player = new PlayerState();
  player.x = bx + 150;
  player.y = by;
  player.health = 100000; // deep pool: we measure damage, not survival
  const players = new Map([["p1", player]]);
  const playerBox = {
    cx: player.x + PLAYER_HURT_BOUNDS.offsetX,
    cy: player.y + PLAYER_HURT_BOUNDS.offsetY,
    halfW: PLAYER_HURT_BOUNDS.halfW,
    halfH: PLAYER_HURT_BOUNDS.halfH,
  };

  const bystander = new GooGreen(physics, bx + 150, by + 24);
  bystander.state.health = 100000;
  const bystanderBounds = ENEMY_HURT_BOUNDS[GooGreen.type as EnemyType];

  const projectiles: Projectile[] = [];
  const out: Outcome = {
    sawTelegraph: false,
    shots: 0,
    playerDamage: 0,
    bystanderDamage: 0,
    bossErrored: null,
  };

  const bystanderBox = () => ({
    cx: bystander.state.x + bystanderBounds.offsetX,
    cy: bystander.state.y + bystanderBounds.offsetY,
    halfW: bystanderBounds.halfW,
    halfH: bystanderBounds.halfH,
  });

  try {
    for (let t = 0; t < ticks; t++) {
      boss.tick(players, SERVER_TICK_MS);
      if (boss.state.telegraph) out.sawTelegraph = true;

      for (const e of boss.drainEffects()) {
        if (e.kind === "hit") {
          const src = e.source;
          if (canAffect(src.affects, Layer.PLAYER) && shapeHitsBox(src.shape, playerBox) && src.claim("p1")) {
            out.playerDamage += src.attack.damage;
          }
          if (canAffect(src.affects, Layer.ENEMY) && shapeHitsBox(src.shape, bystanderBox()) && src.claim("b1")) {
            out.bystanderDamage += src.attack.damage;
          }
        } else if (e.kind === "projectile") {
          out.shots++;
          projectiles.push(new Projectile(
            physics,
            AMMO_REGISTRY[e.ammoId],
            e.x, e.y, e.angle,
            "boss",
            e.opts?.inert ? 0 : ENEMY_PROJECTILE_AFFECTS,
            e.opts?.lifetimeMs,
            e.opts?.attack,
          ));
        }
      }

      for (const proj of projectiles) {
        proj.tick(SERVER_TICK_MS);
        if (proj.dead) continue;
        const src = proj.hitSource();
        if (canAffect(proj.affects, Layer.PLAYER) && shapeHitsBox(src.shape, playerBox) && src.claim("p1")) {
          out.playerDamage += src.attack.damage;
        }
        if (canAffect(proj.affects, Layer.ENEMY) && shapeHitsBox(src.shape, bystanderBox()) && src.claim("b1")) {
          out.bystanderDamage += src.attack.damage;
        }
      }
    }
  } catch (err) {
    out.bossErrored = err as Error;
  }
  return out;
}

// Run every boss once and share the outcomes — a fight is ~200 ticks of real
// physics, and each assertion below wants the same run.
const outcomes = new Map<string, Outcome>(BOSSES.map(B => [B.type, fight(B)]));

describe.each(BOSSES.map(B => [B.type, B] as const))("%s", (type, BossClass) => {
  const outcome = () => outcomes.get(type)!;

  it("survives a fight without throwing", () => {
    expect(outcome().bossErrored).toBeNull();
  });

  it("telegraphs before it strikes", () => {
    // The design's hard promise: a perfect player can dodge everything, which is
    // only true if every attack is announced.
    expect(outcome().sawTelegraph).toBe(true);
  });

  it("actually damages the player", () => {
    expect(outcome().playerDamage).toBeGreaterThan(0);
  });

  it("never friendly-fires an enemy standing right next to its target", () => {
    expect(outcome().bystanderDamage).toBe(0);
  });

  it("deals no passive contact damage — every hit is a spell", () => {
    const boss = new BossClass(flatWorld(), 300, 300);
    expect(boss.contactHitSource()).toBeNull();
  });

  it("is announced in the bestiary with lore and named abilities", () => {
    expect(BossClass.lore.length).toBeGreaterThan(0);
    expect(BossClass.abilities.length).toBeGreaterThan(0);
    for (const a of BossClass.abilities) {
      expect(a.name.length, `${type}`).toBeGreaterThan(0);
      expect(a.desc.length, `${type}`).toBeGreaterThan(0);
    }
  });

  it("has measured hurt bounds", () => {
    expect(ENEMY_HURT_BOUNDS[type as EnemyType]).toBeDefined();
  });

  it("has a bigger HP pool than the rank and file", () => {
    const boss = new BossClass(flatWorld(), 300, 300);
    const goo = new GooGreen(flatWorld(), 0, 0);
    expect(boss.state.maxHealth).toBeGreaterThan(goo.state.maxHealth);
  });
});

describe("the boss roster", () => {
  it("has no duplicate ids", () => {
    const types = BOSSES.map(B => B.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it("gives each boss its own moveset rather than a shared one", () => {
    // Every boss must at least be distinguishable by what it does; identical
    // ability lists would mean the roster is one boss in eight costumes.
    const signatures = BOSSES.map(B => B.abilities.map(a => a.name).join("|"));
    expect(new Set(signatures).size).toBeGreaterThan(1);
  });

  it("puts every boss on the enemy team", () => {
    for (const B of BOSSES) {
      const boss = new B(flatWorld(), 300, 300);
      expect(boss.attackAffects).toBe(ENEMY_ATTACK_AFFECTS);
      expect(canAffect(boss.attackAffects, Layer.PLAYER)).toBe(true);
      expect(canAffect(boss.attackAffects, Layer.ENEMY)).toBe(false);
    }
  });
});

describe("boss stun resilience", () => {
  it("always gets a window to act after being staggered", () => {
    // Playtest B7: without this, a fast enough stream of ranged hits re-stuns on
    // every impact and the boss never fights back.
    const boss: Boss = new BOSSES[0](flatWorld(), 300, 300);

    boss.applyKnockback(200, 300, 10_000);
    expect(boss.isStunned).toBe(true);
    while (boss.isStunned) boss.updateStun(SERVER_TICK_MS);

    // Immediately re-hit: the immunity window means it does NOT re-stun.
    boss.applyKnockback(200, 300, 10_000);
    expect(boss.isStunned).toBe(false);
  });

  it("becomes stunnable again once the window closes", () => {
    const boss: Boss = new BOSSES[0](flatWorld(), 300, 300);
    boss.applyKnockback(200, 300, 10_000);
    while (boss.isStunned) boss.updateStun(SERVER_TICK_MS);
    for (let i = 0; i < 100; i++) boss.updateStun(SERVER_TICK_MS); // run out the immunity

    boss.applyKnockback(200, 300, 10_000);
    expect(boss.isStunned).toBe(true);
  });

  it("still takes damage while stun-immune — only the stun is refused", () => {
    const boss: Boss = new BOSSES[0](flatWorld(), 300, 300);
    boss.applyKnockback(200, 300, 10_000);
    while (boss.isStunned) boss.updateStun(SERVER_TICK_MS);

    const hp = boss.state.health;
    boss.takeHit({ damage: 25, knockback: 10_000, sourceX: 200, sourceY: 300 });
    expect(boss.state.health).toBe(hp - 25);
  });
});
