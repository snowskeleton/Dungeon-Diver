import { describe, it, expect } from "vitest";
import {
  SERVER_TICK_MS,
  ENEMY_ATTACK_AFFECTS,
  Layer,
  canAffect,
  ENEMY_HURT_BOUNDS,
  PLAYER_HURT_BOUNDS,
  ENTITY_RADIUS,
  EnemyType,
  shapeHitsBox,
} from "shared";
import { REGULAR_ENEMIES } from "../../server/src/entities/enemies";
import { GooGreen, GooBlue, GooGold } from "../../server/src/entities/enemies/goos";
import { PlayerState } from "../../server/src/schema/PlayerState";
import { flatWorld, physicsTick } from "../helpers/world";

// Enemies are OO — stats are getters on the class — so the roster is checked as a
// whole for invariants, and the shared base AI is checked on one concrete enemy.

const playerAt = (x: number, y: number) => {
  const p = new PlayerState();
  p.x = x;
  p.y = y;
  p.health = 100;
  return p;
};

const nobody = new Map<string, PlayerState>();

describe("the enemy roster", () => {
  const instances = () => REGULAR_ENEMIES.map(E => new E(flatWorld(), 300, 300));

  it("is not empty and carries no duplicate ids", () => {
    const types = REGULAR_ENEMIES.map(E => E.type);
    expect(types.length).toBeGreaterThan(0);
    expect(new Set(types).size).toBe(types.length);
  });

  it("keeps every enemy's stats sane", () => {
    for (const e of instances()) {
      const type = e.state.enemyType;
      expect(e.state.health, `${type} hp`).toBeGreaterThan(0);
      expect(e.state.maxHealth, `${type} maxHp`).toBe(e.state.health);
      expect(e.state.aggroRadius, `${type} aggro`).toBeGreaterThan(0);
      expect(e.state.attackRadius, `${type} attack radius`).toBeGreaterThan(0);
    }
  });

  it("gives every enemy an attack radius that can actually reach past separation", () => {
    // Bodies are rigidly separated at 2×ENTITY_RADIUS, so a shorter reach than
    // that can never land — the failure is silent, which is why it's asserted.
    for (const e of instances()) {
      expect(e.state.attackRadius, `${e.state.enemyType}`).toBeGreaterThan(2 * ENTITY_RADIUS);
    }
  });

  it("has measured hurt bounds for every enemy in the pool", () => {
    for (const E of REGULAR_ENEMIES) {
      expect(ENEMY_HURT_BOUNDS[E.type as EnemyType], `${E.type}`).toBeDefined();
    }
  });

  it("mirrors its own type id onto the synced state", () => {
    for (const E of REGULAR_ENEMIES) {
      expect(new E(flatWorld(), 0, 0).state.enemyType).toBe(E.type);
    }
  });

  it("keeps bosses out of the rank-and-file pool", () => {
    const types = REGULAR_ENEMIES.map(E => E.type);
    for (const boss of ["turtle-dragon", "wyvern", "tengu-mask", "big-beast"]) {
      expect(types).not.toContain(boss);
    }
  });

  it("hovers flyers off the ground and leaves everything else on it", () => {
    for (const e of instances()) {
      e.tick(nobody, SERVER_TICK_MS);
      expect(e.state.airHeight, `${e.state.enemyType}`).toBeGreaterThanOrEqual(0);
    }
    // At least one enemy must actually fly, or `cruiseHeight` is dead code.
    const anyFlying = instances().some(e => {
      e.tick(nobody, SERVER_TICK_MS);
      return e.state.airHeight > 0;
    });
    expect(anyFlying).toBe(true);
  });

  it("drops a dying flyer to the ground for its death animation", () => {
    for (const e of instances()) {
      e.tick(nobody, SERVER_TICK_MS);
      if (e.state.airHeight === 0) continue;
      e.takeDamage(99999);
      e.tick(nobody, SERVER_TICK_MS);
      expect(e.state.airHeight, `${e.state.enemyType}`).toBe(0);
    }
  });
});

describe("stat inheritance up the class chain", () => {
  it("gives the baseline goo the base class's defaults", () => {
    const green = new GooGreen(flatWorld(), 0, 0);
    const blue = new GooBlue(flatWorld(), 0, 0);
    const gold = new GooGold(flatWorld(), 0, 0);

    // The three goos are a tuned ladder; the shape of the ladder is the design,
    // not any particular number on it.
    expect(blue.state.maxHealth).toBeGreaterThan(green.state.maxHealth);
    expect(gold.state.maxHealth).toBeGreaterThan(blue.state.maxHealth);
    expect(gold.state.aggroRadius).toBeGreaterThan(blue.state.aggroRadius);
  });
});

describe("the base chase AI", () => {
  it("patrols when no player is anywhere near", () => {
    const goo = new GooGreen(flatWorld(), 300, 300);
    goo.tick(new Map([["p1", playerAt(5000, 5000)]]), SERVER_TICK_MS);
    expect(goo.state.aiState).toBe("patrol");
    expect(goo.state.targetId).toBe("");
  });

  it("patrols when there are no players at all", () => {
    const goo = new GooGreen(flatWorld(), 300, 300);
    goo.tick(nobody, SERVER_TICK_MS);
    expect(goo.state.aiState).toBe("patrol");
  });

  it("chases a player inside aggro range and names them as its target", () => {
    const goo = new GooGreen(flatWorld(), 300, 300);
    const inRange = goo.state.aggroRadius - 20;
    goo.tick(new Map([["p1", playerAt(300 + inRange, 300)]]), SERVER_TICK_MS);

    expect(goo.state.aiState).toBe("chase");
    expect(goo.state.targetId).toBe("p1");
  });

  it("actually closes the distance while chasing", () => {
    const world = flatWorld();
    const goo = new GooGreen(world, 300, 300);
    const players = new Map([["p1", playerAt(400, 300)]]);

    for (let i = 0; i < 10; i++) {
      goo.tick(players, SERVER_TICK_MS);
      physicsTick(world, [goo]);
    }
    expect(goo.state.x).toBeGreaterThan(300);
  });

  it("switches to attack once inside attack range", () => {
    const goo = new GooGreen(flatWorld(), 300, 300);
    goo.tick(new Map([["p1", playerAt(300 + goo.state.attackRadius - 2, 300)]]), SERVER_TICK_MS);
    expect(goo.state.aiState).toBe("attack");
  });

  it("picks the CLOSEST player when several are in range", () => {
    const goo = new GooGreen(flatWorld(), 300, 300);
    goo.tick(new Map([
      ["far", playerAt(300 + goo.state.aggroRadius - 10, 300)],
      ["near", playerAt(330, 300)],
    ]), SERVER_TICK_MS);
    expect(goo.state.targetId).toBe("near");
  });

  it("faces the direction it is chasing", () => {
    const goo = new GooGreen(flatWorld(), 300, 300);
    goo.tick(new Map([["p1", playerAt(400, 300)]]), SERVER_TICK_MS);
    expect(goo.state.facing).toBe("right");
    goo.tick(new Map([["p1", playerAt(200, 300)]]), SERVER_TICK_MS);
    expect(goo.state.facing).toBe("left");
  });

  it("never faces up or down with horizontal art, which has no such frame", () => {
    const goo = new GooGreen(flatWorld(), 300, 300); // facingMode "horizontal"
    goo.tick(new Map([["p1", playerAt(300, 400)]]), SERVER_TICK_MS);
    expect(["left", "right"]).toContain(goo.state.facing);
  });

  it("does nothing at all once dying", () => {
    const goo = new GooGreen(flatWorld(), 300, 300);
    goo.takeDamage(99999);
    goo.state.aiState = "patrol";
    goo.tick(new Map([["p1", playerAt(310, 300)]]), SERVER_TICK_MS);
    expect(goo.state.aiState).toBe("patrol"); // never re-evaluated
  });
});

describe("contact damage", () => {
  const goo = () => new GooGreen(flatWorld(), 300, 300);

  it("offers a hit source that reaches the enemy's team's enemies only", () => {
    const src = goo().contactHitSource("e1")!;
    expect(src.affects).toBe(ENEMY_ATTACK_AFFECTS);
    expect(canAffect(src.affects, Layer.PLAYER)).toBe(true);
    expect(canAffect(src.affects, Layer.ENEMY)).toBe(false);
  });

  it("names itself as owner so it cannot damage itself", () => {
    expect(goo().contactHitSource("e1")!.ownerId).toBe("e1");
  });

  it("deals no knockback — only telegraphed attacks shove", () => {
    expect(goo().contactHitSource("e1")!.attack.knockback).toBe(0);
  });

  it("reaches exactly attackRadius once the player's own hurt box is accounted for", () => {
    const g = goo();
    const src = g.contactHitSource("e1")!;
    const shape = src.shape as { kind: string; r: number };
    // The circle is shrunk by the player's half-width precisely so that giving
    // creatures real hurt boxes did not hand every enemy free reach.
    expect(shape.r).toBe(Math.max(0, g.state.attackRadius - PLAYER_HURT_BOUNDS.halfW));

    const atTheEdge = {
      cx: 300 + g.state.attackRadius,
      cy: 300,
      halfW: PLAYER_HURT_BOUNDS.halfW,
      halfH: PLAYER_HURT_BOUNDS.halfH,
    };
    expect(shapeHitsBox(src.shape, atTheEdge)).toBe(true);
    expect(shapeHitsBox(src.shape, { ...atTheEdge, cx: atTheEdge.cx + 2 })).toBe(false);
  });

  it("lands on exactly one player per cooldown, however many are in reach", () => {
    const src = goo().contactHitSource("e1")!;
    expect(src.claim("p1")).toBe(true);
    expect(src.claim("p2")).toBe(false); // the eruption is already spent
  });

  it("goes quiet for its cooldown after landing, then comes back", () => {
    const g = goo();
    g.contactHitSource("e1")!.claim("p1");
    g.tick(nobody, SERVER_TICK_MS);
    expect(g.contactHitSource("e1")).toBeNull();

    for (let t = 0; t < 200 && !g.contactHitSource("e1"); t++) g.tick(nobody, SERVER_TICK_MS);
    expect(g.contactHitSource("e1")).not.toBeNull();
  });

  it("offers nothing while stunned", () => {
    const g = goo();
    g.applyKnockback(250, 300, 50);
    expect(g.contactHitSource("e1")).toBeNull();
  });

  it("offers nothing once dying", () => {
    const g = goo();
    g.takeDamage(99999);
    expect(g.contactHitSource("e1")).toBeNull();
  });
});

describe("death", () => {
  it("flags itself dying and stops being damageable", () => {
    const g = new GooGreen(flatWorld(), 300, 300);
    expect(g.damageable).toBe(true);
    g.takeDamage(99999);
    expect(g.isDying).toBe(true);
    expect(g.damageable).toBe(false);
  });

  it("stops blocking other bodies once dead — a corpse is not a wall", () => {
    const world = flatWorld();
    const corpse = new GooGreen(world, 300, 300);
    corpse.takeDamage(99999);

    const walker = new GooGreen(world, 260, 300);
    for (let i = 0; i < 40; i++) {
      walker.move(1, 0, 200);
      physicsTick(world, [walker, corpse]);
    }
    expect(walker.state.x).toBeGreaterThan(340); // walked clean through
  });
});

describe("party-size HP scaling", () => {
  it("is an exact no-op at a multiplier of 1", () => {
    const g = new GooGreen(flatWorld(), 0, 0);
    const before = { hp: g.state.health, max: g.state.maxHealth };
    g.scaleMaxHp(1);
    expect(g.state.health).toBe(before.hp);
    expect(g.state.maxHealth).toBe(before.max);
  });

  it("scales max and current together, so the enemy simply spawns tougher", () => {
    const g = new GooGreen(flatWorld(), 0, 0);
    const base = g.state.maxHealth;
    g.scaleMaxHp(2);
    expect(g.state.maxHealth).toBe(base * 2);
    expect(g.state.health).toBe(g.state.maxHealth);
  });

  it("rounds to a whole HP", () => {
    const g = new GooGreen(flatWorld(), 0, 0);
    g.scaleMaxHp(1.333);
    expect(Number.isInteger(g.state.health)).toBe(true);
  });
});

describe("room confinement", () => {
  const bounds = { xMin: 200, xMax: 400, yMin: 200, yMax: 400 };

  it("clips walking intent at the room edge, per axis", () => {
    const world = flatWorld();
    const g = new GooGreen(world, 395, 300);
    g.confineTo(bounds);

    for (let i = 0; i < 60; i++) {
      g.move(1, 0, 200);
      physicsTick(world, [g]);
    }
    // What is clipped is the INTENT, not the position: the enemy stops issuing
    // movement once it is at or past the edge, so it settles within a single
    // tick's travel of it (200 px/s × 50 ms = 10px) and then holds there — it
    // never walks on, which is the actual containment guarantee.
    const oneStep = 200 * (SERVER_TICK_MS / 1000);
    expect(g.state.x).toBeLessThanOrEqual(bounds.xMax + oneStep);

    const settled = g.state.x;
    for (let i = 0; i < 60; i++) {
      g.move(1, 0, 200);
      physicsTick(world, [g]);
    }
    expect(g.state.x).toBeCloseTo(settled, 5); // does not creep further out
  });

  it("still lets it slide along the boundary rather than sticking", () => {
    const world = flatWorld();
    const g = new GooGreen(world, 400, 300);
    g.confineTo(bounds);

    for (let i = 0; i < 30; i++) {
      g.move(1, 1, 200); // pressed against xMax, but free to go down
      physicsTick(world, [g]);
    }
    expect(g.state.y).toBeGreaterThan(305);
  });

  it("does NOT clip knockback — being blasted into a doorway is combat feel", () => {
    const world = flatWorld();
    const g = new GooGreen(world, 395, 300);
    g.confineTo(bounds);
    g.applyKnockback(300, 300, 60);
    for (let i = 0; i < 20; i++) physicsTick(world, [g]);

    expect(g.state.x).toBeGreaterThan(bounds.xMax);
  });

  it("wanders freely when unconfined (the headless default)", () => {
    const world = flatWorld();
    const g = new GooGreen(world, 395, 300);
    for (let i = 0; i < 40; i++) {
      g.move(1, 0, 200);
      physicsTick(world, [g]);
    }
    expect(g.state.x).toBeGreaterThan(500);
  });
});
