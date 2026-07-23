import { describe, it, expect } from "vitest";
import {
  TILE,
  TILE_SIZE,
  SERVER_TICK_MS,
  KNOCKBACK_SCALE,
  KNOCKBACK_MIN_FRACTION,
  KNOCKBACK_STUN_MAX_MS,
  ENTITY_RADIUS,
  PLAYER_HURT_BOUNDS,
} from "shared";
import { Player } from "../../server/src/entities/Player";
import { GooGreen } from "../../server/src/entities/enemies/goos";
import { flatWorld, worldWithTile, physicsTick } from "../helpers/world";

// Entity is the shared substrate: movement intent, knockback, hitstun, tile
// effects, teleporting. Tested on a real Player/Enemy because the base class is
// abstract and its behaviour only means anything attached to a body.

const newPlayer = (x = 300, y = 300) => new Player(flatWorld(), x, y);

describe("movement intent", () => {
  it("normalizes diagonals so moving at 45° is not faster", () => {
    const world = flatWorld();
    const straight = new Player(world, 300, 300);
    const diagonal = new Player(world, 300, 500);

    straight.move(1, 0, 100);
    diagonal.move(1, 1, 100);
    physicsTick(world, [straight, diagonal]);

    const dStraight = straight.state.x - 300;
    const dDiagonal = Math.hypot(diagonal.state.x - 300, diagonal.state.y - 500);
    expect(dDiagonal).toBeCloseTo(dStraight, 5);
  });

  it("ignores a zero intent instead of zeroing an existing one", () => {
    const world = flatWorld();
    const p = new Player(world, 300, 300);
    p.move(1, 0, 100);
    p.move(0, 0, 100); // no-op, must not cancel the intent above
    physicsTick(world, [p]);
    expect(p.state.x).toBeGreaterThan(300);
  });

  it("scales movement by the speed multiplier that tiles set", () => {
    const world = flatWorld();
    const p = new Player(world, 300, 300);
    p.state.speedMultiplier = 0.5;
    p.move(1, 0, 100);
    physicsTick(world, [p]);
    const slowed = p.state.x - 300;

    const q = new Player(world, 300, 500);
    q.move(1, 0, 100);
    physicsTick(world, [q]);
    const full = q.state.x - 300;

    expect(slowed).toBeCloseTo(full / 2, 4);
  });

  it("clears intent each tick, so releasing the key stops the entity", () => {
    const world = flatWorld();
    const p = new Player(world, 300, 300);
    p.move(1, 0, 200);
    physicsTick(world, [p]);
    const afterMove = p.state.x;

    for (let i = 0; i < 5; i++) physicsTick(world, [p]); // no further intent
    expect(p.state.x - afterMove).toBeLessThan(1);
  });
});

describe("knockback", () => {
  it("pushes away from the blow's origin", () => {
    const p = newPlayer();
    p.applyKnockback(p.state.x - 50, p.state.y, 20); // struck from the left

    const world = flatWorld();
    const q = new Player(world, 300, 300);
    q.applyKnockback(250, 300, 20);
    for (let i = 0; i < 10; i++) physicsTick(world, [q]);

    expect(q.state.x).toBeGreaterThan(300);
  });

  it("snaps the push to a cardinal axis rather than a diagonal", () => {
    const world = flatWorld();
    const p = new Player(world, 300, 300);
    // Struck from down-left, but more left than down: the push is pure right.
    p.applyKnockback(250, 290, 20);
    for (let i = 0; i < 10; i++) physicsTick(world, [p]);

    expect(p.state.x).toBeGreaterThan(300);
    expect(p.state.y).toBeCloseTo(300, 0);
  });

  it("breaks a perfect diagonal tie toward the horizontal", () => {
    const world = flatWorld();
    const p = new Player(world, 300, 300);
    p.applyKnockback(250, 250, 20);
    for (let i = 0; i < 10; i++) physicsTick(world, [p]);

    expect(p.state.x).toBeGreaterThan(301);
    expect(p.state.y).toBeCloseTo(300, 0);
  });

  it("travels a distance proportional to how far the force cleared resistance", () => {
    const world = flatWorld();
    const soft = new Player(world, 300, 300); // resistance 0
    const push = 10;
    soft.applyKnockback(300 - 50, 300, push);
    for (let i = 0; i < 30; i++) physicsTick(world, [soft]);

    // The impulse is solved so the geometric series totals overage × SCALE.
    expect(soft.state.x - 300).toBeCloseTo(push * KNOCKBACK_SCALE, 0);
  });

  it("still nudges when the force falls short of resistance", () => {
    const world = flatWorld();
    const goo = new GooGreen(world, 300, 300); // knockbackResistance 3
    goo.applyKnockback(250, 300, 1);           // under the threshold
    for (let i = 0; i < 30; i++) physicsTick(world, [goo]);

    const moved = goo.state.x - 300;
    expect(moved).toBeGreaterThan(0);          // no weapon reads as doing nothing
    expect(moved).toBeCloseTo(1 * KNOCKBACK_MIN_FRACTION * KNOCKBACK_SCALE, 0);
  });

  it("staggers (stuns) only when the force clears resistance", () => {
    const world = flatWorld();
    const shrugged = new GooGreen(world, 300, 300);
    shrugged.applyKnockback(250, 300, 1); // resistance is 3
    expect(shrugged.isStunned).toBe(false);
    expect(shrugged.state.stunned).toBe(false);

    const staggered = new GooGreen(world, 300, 500);
    staggered.applyKnockback(250, 500, 10);
    expect(staggered.isStunned).toBe(true);
    expect(staggered.state.stunned).toBe(true);
  });

  it("does nothing at all for a zero-force source", () => {
    const p = newPlayer();
    p.applyKnockback(250, 300, 0);
    expect(p.isStunned).toBe(false);
  });

  it("does nothing when the blow lands exactly on the target's centre", () => {
    const p = newPlayer();
    p.applyKnockback(p.state.x, p.state.y, 50); // no direction to push in
    expect(p.isStunned).toBe(false);
  });

  it("never shoves a corpse", () => {
    const world = flatWorld();
    const goo = new GooGreen(world, 300, 300);
    goo.takeDamage(99999);
    goo.state.health = 0;
    goo.applyKnockback(250, 300, 50);
    for (let i = 0; i < 10; i++) physicsTick(world, [goo]);

    expect(goo.state.x).toBeCloseTo(300, 0);
  });

  it("caps stun duration however hard the hit is", () => {
    const p = newPlayer();
    p.applyKnockback(250, 300, 100000);
    let ticks = 0;
    while (p.updateStun(SERVER_TICK_MS) && ticks < 10000) ticks++;
    expect(ticks * SERVER_TICK_MS).toBeLessThanOrEqual(KNOCKBACK_STUN_MAX_MS + SERVER_TICK_MS);
  });
});

describe("hitstun", () => {
  it("reports stunned until the timer runs out, then clears the flag", () => {
    const p = newPlayer();
    p.applyKnockback(250, 300, 20);
    expect(p.state.stunned).toBe(true);

    for (let i = 0; i < 500 && p.isStunned; i++) p.updateStun(SERVER_TICK_MS);

    expect(p.isStunned).toBe(false);
    expect(p.state.stunned).toBe(false);
  });

  it("freezes player input while it lasts", () => {
    const p = newPlayer();
    p.state.facing = "down";
    p.applyKnockback(250, 300, 20);

    p.applyInput({ dx: 1, dy: 0, attack: false }, SERVER_TICK_MS);
    expect(p.state.facing).toBe("down"); // input ignored

    for (let i = 0; i < 500 && p.isStunned; i++) {
      p.applyInput({ dx: 0, dy: 0, attack: false }, SERVER_TICK_MS);
    }
    p.applyInput({ dx: 1, dy: 0, attack: false }, SERVER_TICK_MS);
    expect(p.state.facing).toBe("right"); // and control returns
  });

  it("freezes enemy AI while it lasts", () => {
    const world = flatWorld();
    const goo = new GooGreen(world, 300, 300);
    goo.applyKnockback(250, 300, 20);
    const players = new Map([["p1", new Player(world, 400, 300).state]]);

    goo.tick(players, SERVER_TICK_MS);
    expect(goo.state.aiState).not.toBe("chase"); // never got as far as the AI
  });
});

describe("tile effects", () => {
  it("slows an entity standing on slime and restores speed on leaving", () => {
    const col = 10, row = 10;
    const world = worldWithTile(col, row, TILE.SLIME);
    const p = new Player(world, col * TILE_SIZE + 16, row * TILE_SIZE + 16);

    p.applyTileEffects(SERVER_TICK_MS);
    expect(p.state.speedMultiplier).toBeCloseTo(0.35, 5);

    p.teleport((col + 3) * TILE_SIZE + 16, row * TILE_SIZE + 16);
    p.applyTileEffects(SERVER_TICK_MS);
    expect(p.state.speedMultiplier).toBe(1);
  });

  it("burns on fire at the configured rate, in interval pulses", () => {
    const col = 10, row = 10;
    const world = worldWithTile(col, row, TILE.FIRE);
    const p = new Player(world, col * TILE_SIZE + 16, row * TILE_SIZE + 16);
    const start = p.state.health;

    // One second of standing in fire = one second's worth of the tile's HP/sec.
    let elapsed = 0;
    while (elapsed < 1000) {
      p.applyTileEffects(SERVER_TICK_MS);
      elapsed += SERVER_TICK_MS;
    }

    const lost = start - p.state.health;
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeCloseTo(20, 0); // TILE_PROPS fire = 20 HP/sec
  });

  it("does not damage on a plain floor tile", () => {
    const p = newPlayer();
    const start = p.state.health;
    for (let i = 0; i < 100; i++) p.applyTileEffects(SERVER_TICK_MS);
    expect(p.state.health).toBe(start);
  });

  it("resets the burn timer on leaving fire, so damage doesn't carry over", () => {
    const world = worldWithTile(10, 10, TILE.FIRE);
    const p = new Player(world, 10 * TILE_SIZE + 16, 10 * TILE_SIZE + 16);
    p.applyTileEffects(SERVER_TICK_MS); // partial interval banked
    p.teleport(20 * TILE_SIZE + 16, 10 * TILE_SIZE + 16);
    p.applyTileEffects(SERVER_TICK_MS); // off fire — bank cleared
    p.teleport(10 * TILE_SIZE + 16, 10 * TILE_SIZE + 16);

    const hp = p.state.health;
    p.applyTileEffects(SERVER_TICK_MS); // fresh interval, must not fire immediately
    expect(p.state.health).toBe(hp);
  });
});

describe("teleport", () => {
  it("moves the state AND the physics body together", () => {
    const world = flatWorld();
    const p = new Player(world, 300, 300);
    p.teleport(500, 400);

    expect(p.state.x).toBe(500);
    expect(p.state.y).toBe(400);

    // If the body had not followed, the next sync would snap the state back.
    physicsTick(world, [p]);
    expect(p.state.x).toBeCloseTo(500, 0);
    expect(p.state.y).toBeCloseTo(400, 0);
  });

  it("cancels in-flight knockback so a warp isn't followed by a shove", () => {
    const world = flatWorld();
    const p = new Player(world, 300, 300);
    p.applyKnockback(250, 300, 50);
    p.teleport(600, 600);
    for (let i = 0; i < 10; i++) physicsTick(world, [p]);

    expect(p.state.x).toBeCloseTo(600, 0);
  });
});

describe("hurt bounds vs collision body", () => {
  it("keeps them separate: what you bump into is smaller than what you can hit", () => {
    const goo = new GooGreen(flatWorld(), 0, 0);
    expect(goo.hurtBounds.halfW).toBeGreaterThan(ENTITY_RADIUS);
    expect(goo.hurtBounds.halfH).toBeGreaterThan(ENTITY_RADIUS);
  });

  it("gives a player the same hurt box regardless of costume", () => {
    const world = flatWorld();
    const a = new Player(world, 0, 0, "knight", "guy");
    const b = new Player(world, 0, 100, "mage", "gal");
    expect(a.hurtBounds).toEqual(b.hurtBounds);
    expect(a.hurtBounds).toEqual(PLAYER_HURT_BOUNDS);
  });
});

describe("effect buffer", () => {
  it("hands over queued effects once and then empties", () => {
    const p = newPlayer();
    p.spawnProjectile("arrow", 1, 2, 0);
    expect(p.drainEffects()).toHaveLength(1);
    expect(p.drainEffects()).toHaveLength(0);
  });

  it("preserves the order effects were queued in", () => {
    const p = newPlayer();
    p.spawnProjectile("arrow", 1, 0, 0);
    p.emitHitSource({ shape: { kind: "circle", cx: 0, cy: 0, r: 1 }, affects: 0, attack: { damage: 0, knockback: 0, sourceX: 0, sourceY: 0 }, claim: () => true });
    p.spawnProjectile("arrow", 2, 0, 0);

    expect(p.drainEffects().map(e => e.kind)).toEqual(["projectile", "hit", "projectile"]);
  });
});
