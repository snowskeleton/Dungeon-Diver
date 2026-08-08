import { describe, it, expect } from "vitest";
import { EnemyFlock, FlockMember } from "../../engine/src/pathfinding/EnemyFlock";

// Crowd separation: the second half of the chase steer (the flow field is the
// first). Its job is to push same-room enemies apart so a pack surrounds a player
// instead of stacking on one path. These lock the geometry, not the tuning: the
// direction and monotonicity of the push, and the confinement to a shared room.

const at = (id: string, roomId: string, x: number, y: number): FlockMember => ({ id, roomId, x, y });

describe("EnemyFlock separation", () => {
  it("is zero when the enemy is alone in its room", () => {
    const flock = new EnemyFlock();
    flock.rebuild([at("a", "r", 100, 100)]);
    const push = flock.separation("a", "r", 100, 100, 30);
    expect(push).toEqual({ dx: 0, dy: 0 });
  });

  it("pushes away from a nearby neighbour", () => {
    const flock = new EnemyFlock();
    // Neighbour sits to the LEFT; the push on `a` must point RIGHT (+x).
    flock.rebuild([at("a", "r", 100, 100), at("b", "r", 90, 100)]);
    const push = flock.separation("a", "r", 100, 100, 30);
    expect(push.dx).toBeGreaterThan(0);
    expect(Math.abs(push.dy)).toBeLessThan(1e-9);
  });

  it("ignores neighbours beyond the radius", () => {
    const flock = new EnemyFlock();
    flock.rebuild([at("a", "r", 100, 100), at("b", "r", 100, 200)]);
    expect(flock.separation("a", "r", 100, 100, 30)).toEqual({ dx: 0, dy: 0 });
  });

  it("shoves harder the closer the neighbour (linear falloff)", () => {
    const flock = new EnemyFlock();
    const near = new EnemyFlock();
    flock.rebuild([at("a", "r", 100, 100), at("b", "r", 80, 100)]); // 20px away
    near.rebuild([at("a", "r", 100, 100), at("b", "r", 95, 100)]);  // 5px away
    const far = flock.separation("a", "r", 100, 100, 30).dx;
    const close = near.separation("a", "r", 100, 100, 30).dx;
    expect(close).toBeGreaterThan(far);
  });

  it("only feels neighbours in the same room", () => {
    const flock = new EnemyFlock();
    // b is right on top of a but homed to a DIFFERENT room — no push across rooms.
    flock.rebuild([at("a", "r1", 100, 100), at("b", "r2", 100, 100)]);
    expect(flock.separation("a", "r1", 100, 100, 30)).toEqual({ dx: 0, dy: 0 });
  });

  it("sums pressure from a crowd on opposite sides", () => {
    const flock = new EnemyFlock();
    // Two neighbours equidistant left and right cancel horizontally; one below
    // then dominates, pushing `a` upward (−y).
    flock.rebuild([
      at("a", "r", 100, 100),
      at("left", "r", 90, 100),
      at("right", "r", 110, 100),
      at("below", "r", 100, 110),
    ]);
    const push = flock.separation("a", "r", 100, 100, 30);
    expect(Math.abs(push.dx)).toBeLessThan(1e-9);
    expect(push.dy).toBeLessThan(0);
  });
});
