import { describe, it, expect } from "vitest";
import { SERVER_TICK_MS } from "shared";
import { PlayerState } from "../../engine/src/schema/PlayerState";
import { Player } from "../../engine/src/entities/Player";
import { flatWorld, arena } from "../helpers/world";
import { Smushroom } from "../../engine/src/entities/enemies";

// The smushroom's only damage is a lingering cloud, released on walk-up AND on death
// (a parting gift), caster-anchored so the body stays put while it gasses. Mirror
// GameRoom's tick gating: a dying enemy runs deathTick instead of tick.
function stepEnemy(smush: Smushroom, ps: Map<string, PlayerState>) {
  if (smush.state.isDying) smush.deathTick(SERVER_TICK_MS);
  else smush.tick(ps, SERVER_TICK_MS);
}

describe("Smushroom — cloud only, on walk-up and on death", () => {
  it("deals NO passive contact damage", () => {
    const physics = flatWorld();
    const smush = new Smushroom(physics, 300, 300);
    expect(smush.contactHitSource()).toBeNull();
  });

  it("gasses a nearby player, re-hitting over time (not once)", () => {
    const physics = flatWorld();
    const smush = new Smushroom(physics, 300, 300);
    const player = new Player(physics, 330, 300, "knight", "guy"); // 30px — inside the cloud
    const a = arena(physics);
    a.addPlayer("p", player);
    a.addEnemy("e", smush);
    const ps = new Map<string, PlayerState>([["p", player.state]]);
    let ticksThatDamaged = 0;
    for (let t = 0; t < 60; t++) {
      const hp = player.state.health;
      stepEnemy(smush, ps);
      a.step();
      if (player.state.health < hp) ticksThatDamaged++;
    }
    // Re-hits on its 500ms gate over ~3s → several distinct damage ticks, not one.
    expect(ticksThatDamaged).toBeGreaterThan(1);
  });

  it("releases a parting cloud on death that still damages a nearby player", () => {
    const physics = flatWorld();
    const smush = new Smushroom(physics, 300, 300);
    const player = new Player(physics, 330, 300, "knight", "guy");
    const a = arena(physics);
    a.addPlayer("p", player);
    a.addEnemy("e", smush);
    const ps = new Map<string, PlayerState>([["p", player.state]]);
    // Kill it outright before it ever chose to gas on its own.
    smush.takeDamage(9999);
    expect(smush.state.isDying).toBe(true);
    const hp0 = player.state.health;
    for (let t = 0; t < 30; t++) {
      stepEnemy(smush, ps);
      a.step();
    }
    expect(player.state.health).toBeLessThan(hp0);
  });
});
