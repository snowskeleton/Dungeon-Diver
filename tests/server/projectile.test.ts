import { describe, it, expect } from "vitest";
import {
  TILE,
  TILE_SIZE,
  SERVER_TICK_MS,
  AMMO_REGISTRY,
  PLAYER_PROJECTILE_AFFECTS,
  Ammo,
  AmmoId,
  AMMO_CLASSES,
} from "shared";
import { Projectile } from "../../server/src/entities/Projectile";
import { PhysicsWorld } from "../../server/src/physics/PhysicsWorld";
import { flatWorld, flatMap, COLS, ROWS } from "../helpers/world";

// Projectiles are the one kinematic thing in the game — not a matter body — so
// their integration, despawn rules, and pierce bookkeeping are all their own.

const arrow = AMMO_REGISTRY["arrow"];

/** A test ammo with exactly the properties a case needs. Ammo is OO, so this is
 *  just a subclass rather than a config object handed to a generic projectile. */
class TestAmmo extends Ammo {
  readonly id = "test-ammo" as AmmoId;
  readonly name = "Test Ammo";
  constructor(private readonly over: Partial<Record<string, unknown>> = {}) { super(); }
  override get damage() { return (this.over.damage as number) ?? 10; }
  override get speed() { return (this.over.speed as number) ?? 300; }
  override get pierce() { return (this.over.pierce as number) ?? 1; }
  override get knockback() { return (this.over.knockback as number) ?? 5; }
  override get lifetimeMs() { return (this.over.lifetimeMs as number) ?? 1000; }
  override get ignoresWalls() { return (this.over.ignoresWalls as boolean) ?? false; }
  override get returnsAtMs() { return this.over.returnsAtMs as number | undefined; }
}

const shoot = (
  physics: PhysicsWorld,
  ammo = arrow,
  x = 300,
  y = 300,
  angle = 0,
  opts: { lifetime?: number; attack?: { damage: number; knockback: number } } = {},
) => new Projectile(physics, ammo, x, y, angle, "p1", PLAYER_PROJECTILE_AFFECTS, opts.lifetime, opts.attack);

describe("flight", () => {
  it("travels along its angle at the ammo's speed", () => {
    const p = shoot(flatWorld(), new TestAmmo({ speed: 300 }));
    p.tick(1000); // one full second

    expect(p.state.x).toBeCloseTo(600, 5); // 300 px/sec × 1s
    expect(p.state.y).toBeCloseTo(300, 5);
  });

  it("flies in whatever direction it was fired", () => {
    const cases: Array<[number, number, number]> = [
      [0, 1, 0],
      [Math.PI / 2, 0, 1],
      [Math.PI, -1, 0],
      [-Math.PI / 2, 0, -1],
    ];
    for (const [angle, ux, uy] of cases) {
      const p = shoot(flatWorld(), new TestAmmo({ speed: 100 }), 300, 300, angle);
      p.tick(1000);
      expect(p.state.x - 300).toBeCloseTo(100 * ux, 5);
      expect(p.state.y - 300).toBeCloseTo(100 * uy, 5);
    }
  });

  it("records its previous position so the swept hitbox covers the whole step", () => {
    const p = shoot(flatWorld(), new TestAmmo({ speed: 1000 }));
    p.tick(SERVER_TICK_MS);
    const from = { x: p.prevX, y: p.prevY };
    p.tick(SERVER_TICK_MS);

    expect(p.prevX).not.toBe(from.x);
    const shape = p.hitSource().shape as { x0: number; x1: number };
    expect(shape.x0).toBe(p.prevX);
    expect(shape.x1).toBe(p.state.x);
  });

  it("stops integrating once dead", () => {
    const p = shoot(flatWorld());
    p.dead = true;
    const x = p.state.x;
    p.tick(SERVER_TICK_MS);
    expect(p.state.x).toBe(x);
  });
});

describe("despawn rules", () => {
  it("expires at its lifetime", () => {
    const p = shoot(flatWorld(), new TestAmmo({ lifetimeMs: 500, speed: 10 }));
    p.tick(499);
    expect(p.dead).toBe(false);
    p.tick(1);
    expect(p.dead).toBe(true);
  });

  it("honours a per-spawn lifetime override, so a batch can clear together", () => {
    const p = shoot(flatWorld(), new TestAmmo({ lifetimeMs: 10_000, speed: 10 }), 300, 300, 0, { lifetime: 100 });
    p.tick(100);
    expect(p.dead).toBe(true);
  });

  it("dies on a wall tile", () => {
    const map = flatMap();
    map[10][15] = TILE.WALL;
    const physics = new PhysicsWorld(map, COLS, ROWS);
    // Start a couple of tiles left of the wall, flying right.
    const p = shoot(physics, new TestAmmo({ speed: 300 }), 13 * TILE_SIZE + 16, 10 * TILE_SIZE + 16);

    for (let i = 0; i < 50 && !p.dead; i++) p.tick(SERVER_TICK_MS);
    expect(p.dead).toBe(true);
    expect(p.state.x).toBeGreaterThan(14 * TILE_SIZE);
  });

  it("dies leaving the map entirely", () => {
    const p = shoot(flatWorld(), new TestAmmo({ speed: 3000, lifetimeMs: 60_000 }), 32, 300, Math.PI);
    for (let i = 0; i < 100 && !p.dead; i++) p.tick(SERVER_TICK_MS);
    expect(p.dead).toBe(true);
  });

  it("is stopped by a raised barrier, even though the doorway tile is walkable", () => {
    const physics = flatWorld();
    physics.addBarrier("b1", 15 * TILE_SIZE, 10 * TILE_SIZE, TILE_SIZE, TILE_SIZE * 3);
    const p = shoot(physics, new TestAmmo({ speed: 300 }), 13 * TILE_SIZE, 10 * TILE_SIZE);

    for (let i = 0; i < 50 && !p.dead; i++) p.tick(SERVER_TICK_MS);
    expect(p.dead).toBe(true);
  });

  it("passes over walls when the ammo ignores them", () => {
    const map = flatMap();
    map[10][15] = TILE.WALL;
    const physics = new PhysicsWorld(map, COLS, ROWS);
    const p = shoot(physics, new TestAmmo({ speed: 300, ignoresWalls: true, lifetimeMs: 5000 }),
      13 * TILE_SIZE + 16, 10 * TILE_SIZE + 16);

    for (let i = 0; i < 20; i++) p.tick(SERVER_TICK_MS);
    expect(p.dead).toBe(false);
    expect(p.state.x).toBeGreaterThan(16 * TILE_SIZE);
  });
});

describe("pierce and dedupe", () => {
  it("hits a given target only once", () => {
    const p = shoot(flatWorld(), new TestAmmo({ pierce: 5 }));
    const src = p.hitSource();
    expect(src.claim("e1")).toBe(true);
    expect(src.claim("e1")).toBe(false);
  });

  it("dies after its first hit at pierce 1", () => {
    const p = shoot(flatWorld(), new TestAmmo({ pierce: 1 }));
    expect(p.hitSource().claim("e1")).toBe(true);
    expect(p.dead).toBe(true);
  });

  it("passes through exactly `pierce` targets", () => {
    const p = shoot(flatWorld(), new TestAmmo({ pierce: 3 }));
    expect(p.hitSource().claim("a")).toBe(true);
    expect(p.dead).toBe(false);
    expect(p.hitSource().claim("b")).toBe(true);
    expect(p.dead).toBe(false);
    expect(p.hitSource().claim("c")).toBe(true);
    expect(p.dead).toBe(true);
    expect(p.hitSource().claim("d")).toBe(false);
  });

  it("claims nothing once dead", () => {
    const p = shoot(flatWorld());
    p.dead = true;
    expect(p.hitSource().claim("e1")).toBe(false);
  });
});

describe("boomerang return", () => {
  const boomerang = () => new TestAmmo({
    speed: 300,
    returnsAtMs: 300,
    lifetimeMs: 5000,
    ignoresWalls: true,
    pierce: 99,
  });

  it("flies out, then reverses exactly once", () => {
    const p = shoot(flatWorld(), boomerang(), 300, 300);
    for (let i = 0; i < 6; i++) p.tick(50); // 300ms out
    const furthest = p.state.x;
    expect(furthest).toBeGreaterThan(300);

    for (let i = 0; i < 6; i++) p.tick(50);
    expect(p.state.x).toBeLessThan(furthest);
  });

  it("comes back roughly to where it was thrown", () => {
    const p = shoot(flatWorld(), boomerang(), 300, 300);
    for (let i = 0; i < 12; i++) p.tick(50); // out 300ms, back 300ms
    expect(p.state.x).toBeCloseTo(300, 0);
  });

  it("can strike the same target again on the return leg", () => {
    const p = shoot(flatWorld(), boomerang(), 300, 300);
    expect(p.hitSource().claim("e1")).toBe(true);
    p.tick(50);
    expect(p.hitSource().claim("e1")).toBe(false); // still the outbound leg

    for (let i = 0; i < 6; i++) p.tick(50); // crosses the reversal
    expect(p.hitSource().claim("e1")).toBe(true);
  });
});

describe("the attack a shot carries", () => {
  it("uses the ammo's own numbers by default (an enemy shot)", () => {
    const p = shoot(flatWorld(), new TestAmmo({ damage: 7, knockback: 3 }));
    const attack = p.hitSource().attack;
    expect(attack.damage).toBe(7);
    expect(attack.knockback).toBe(3);
  });

  it("delivers exactly its ammo's damage and knockback, for EVERY ammo", () => {
    // The whole registry, with no carve-outs. Sweeping it this way is what makes
    // the tremor shard honest rather than special-cased: it declares damage 0
    // because it is an inert telegraph marker whose damage lives on the ability's
    // own consolidated hitbox, and the rule "a shot delivers what its ammo says"
    // holds for it exactly as it does for an arrow.
    for (const A of AMMO_CLASSES) {
      const cfg = new A();
      const p = shoot(flatWorld(), cfg);
      const attack = p.hitSource().attack;
      expect(attack.damage, `${cfg.id} damage`).toBe(cfg.damage);
      expect(attack.knockback, `${cfg.id} knockback`).toBe(cfg.knockback);
    }
  });

  it("carries a pre-resolved attack from the muzzle when given one", () => {
    // A player's shot has the bow's modifiers and the shooter's upgrades already
    // folded in — a projectile in flight has no way back to either.
    const p = shoot(flatWorld(), new TestAmmo({ damage: 7 }), 300, 300, 0, {
      attack: { damage: 42, knockback: 9 },
    });
    expect(p.hitSource().attack.damage).toBe(42);
    expect(p.hitSource().attack.knockback).toBe(9);
  });

  it("pushes targets along its travel direction, from where it came from", () => {
    const p = shoot(flatWorld(), new TestAmmo({ speed: 300 }), 300, 300, 0);
    p.tick(SERVER_TICK_MS);
    const attack = p.hitSource().attack;

    expect(attack.sourceX).toBe(p.prevX);
    expect(attack.sourceX).toBeLessThan(p.state.x); // behind it, so the shove is forward
  });

  it("shapes its hitbox as an ellipse aligned to travel", () => {
    const ammo = new TestAmmo({ speed: 300 });
    const p = shoot(flatWorld(), ammo, 300, 300, 0);
    p.tick(SERVER_TICK_MS);
    const shape = p.hitSource().shape as { kind: string; ux: number; uy: number; forward: number; side: number };

    expect(shape.kind).toBe("sweptEllipse");
    expect(shape.ux).toBeCloseTo(1, 6);
    expect(shape.uy).toBeCloseTo(0, 6);
    expect(shape.forward).toBe(ammo.hitRadiusForward);
    expect(shape.side).toBe(ammo.hitRadiusSide);
  });

  it("mirrors its identity onto the synced state for the client to render", () => {
    const p = shoot(flatWorld(), arrow, 300, 300, 1.25);
    expect(p.state.ammoId).toBe(arrow.id);
    expect(p.state.angle).toBe(1.25);
    expect(p.state.ownerSessionId).toBe("p1");
  });
});
