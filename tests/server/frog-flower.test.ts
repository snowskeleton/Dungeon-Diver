import { describe, it, expect } from "vitest";
import { SERVER_TICK_MS } from "shared";
import { PlayerState } from "../../server/src/schema/PlayerState";
import { Player } from "../../server/src/entities/Player";
import { flatWorld, arena, physicsTick } from "../helpers/world";
import { FrogFlower } from "../../server/src/entities/enemies";

// The frog-flower hops in and LEAPS, dealing damage only on the slam — no passive
// contact. Behaviour only.

describe("FrogFlower — leap slam, no passive contact", () => {
  it("deals NO passive contact damage", () => {
    const physics = flatWorld();
    const frog = new FrogFlower(physics, 300, 300);
    expect(frog.contactHitSource()).toBeNull();
  });

  it("crouches (telegraph) then leaps onto the player for slam damage", () => {
    const physics = flatWorld();
    const frog = new FrogFlower(physics, 300, 300);
    const player = new Player(physics, 300, 380, "knight", "guy"); // 80px away, in leap range
    const a = arena(physics);
    a.addPlayer("p", player);
    a.addEnemy("e", frog);
    const ps = new Map<string, PlayerState>([["p", player.state]]);
    const startHp = player.state.health;
    let telegraphed = false;
    let hit = false;
    for (let t = 0; t < 70; t++) {
      frog.tick(ps, SERVER_TICK_MS);
      if (frog.state.telegraph) telegraphed = true;
      physicsTick(physics, [frog, player]);
      a.step();
      if (player.state.health < startHp) hit = true;
    }
    expect(telegraphed).toBe(true);
    expect(hit).toBe(true);
  });
});
