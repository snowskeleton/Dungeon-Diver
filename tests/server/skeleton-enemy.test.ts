import { describe, it, expect } from "vitest";
import { SERVER_TICK_MS } from "shared";
import { PlayerState } from "../../server/src/schema/PlayerState";
import { Player } from "../../server/src/entities/Player";
import { flatWorld, arena } from "../helpers/world";
import { Skeleton, SkeletonMage } from "../../server/src/entities/enemies/skeletons";

// The humanoid enemies: skeleton swings a broadsword (an ArmedEnemy like the
// beasts), skeleton-mage is the first RANGED rabble — it fires bolts from afar.
// Behaviour only, no balance numbers.

function playerAt(physics: ReturnType<typeof flatWorld>, x: number, y: number): Player {
  return new Player(physics, x, y, "knight", "guy");
}

describe("humanoid enemies", () => {
  it("the skeleton swings its broadsword (no passive contact) and hits an adjacent player", () => {
    const physics = flatWorld();
    const skeleton = new Skeleton(physics, 300, 300);
    expect(skeleton.contactHitSource()).toBeNull(); // armed → the swing is the only hazard
    const player = playerAt(physics, 322, 300);
    const a = arena(physics);
    a.addPlayer("p", player);
    a.addEnemy("e", skeleton);
    const ps = new Map<string, PlayerState>([["p", player.state]]);
    const startHp = player.state.health;
    for (let t = 0; t < 80; t++) {
      skeleton.tick(ps, SERVER_TICK_MS);
      a.step();
    }
    expect(player.state.health).toBeLessThan(startHp);
  });

  it("the skeleton-mage fires a bolt at a player well out of melee range", () => {
    const physics = flatWorld();
    const mage = new SkeletonMage(physics, 300, 300);
    const player = playerAt(physics, 460, 300); // 160px away: no melee could reach
    const a = arena(physics);
    a.addPlayer("p", player);
    a.addEnemy("e", mage);
    const ps = new Map<string, PlayerState>([["p", player.state]]);
    let firedFromRange = false;
    for (let t = 0; t < 60; t++) {
      mage.tick(ps, SERVER_TICK_MS);
      a.step();
      // A projectile appeared while the mage was still far from the player.
      if (a.projectiles.length > 0 && Math.hypot(mage.state.x - player.state.x, mage.state.y - player.state.y) > 80) {
        firedFromRange = true;
      }
    }
    expect(firedFromRange).toBe(true);
  });
});
