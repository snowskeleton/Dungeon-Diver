import { describe, it, expect } from "vitest";
import { SERVER_TICK_MS } from "shared";
import { PlayerState } from "../../server/src/schema/PlayerState";
import { Player } from "../../server/src/entities/Player";
import { flatWorld, arena, physicsTick } from "../helpers/world";
import { EyeBat } from "../../server/src/entities/enemies";

// The eye-bat spirals in and DIVES; all its damage is the dive (swoop), none from
// passive contact. Behaviour only.

describe("EyeBat — dive attack, no passive contact", () => {
  it("deals NO passive contact damage", () => {
    const physics = flatWorld();
    const bat = new EyeBat(physics, 300, 300);
    expect(bat.contactHitSource()).toBeNull();
  });

  it("telegraphs a coil then dives onto the player, dealing damage", () => {
    const physics = flatWorld();
    const bat = new EyeBat(physics, 300, 300);
    const player = new Player(physics, 300, 360, "knight", "guy"); // 60px away, in dive range
    const a = arena(physics);
    a.addPlayer("p", player);
    a.addEnemy("e", bat);
    const ps = new Map<string, PlayerState>([["p", player.state]]);
    const startHp = player.state.health;
    let telegraphed = false;
    let hit = false;
    // Mirror GameRoom.tick order: AI intent → physics (so the dive actually moves
    // the bat's dynamic body) → combat resolve.
    for (let t = 0; t < 60; t++) {
      bat.tick(ps, SERVER_TICK_MS);
      if (bat.state.telegraph) telegraphed = true;
      physicsTick(physics, [bat, player]);
      a.step();
      if (player.state.health < startHp) hit = true;
    }
    expect(telegraphed).toBe(true);
    expect(hit).toBe(true);
  });
});
