import { describe, it, expect } from "vitest";
import { SERVER_TICK_MS } from "shared";
import { PlayerState } from "../../engine/src/schema/PlayerState";
import { Player } from "../../engine/src/entities/Player";
import { flatWorld, arena, physicsTick } from "../helpers/world";
import { Fang } from "../../engine/src/entities/enemies";

// Fang coils then LUNGES (a fast contact dash) — its only damage. Placeholder art.
describe("Fang — lunge, no passive contact", () => {
  it("coils (telegraph) then lunges into the player for damage", () => {
    const physics = flatWorld();
    const fang = new Fang(physics, 300, 300);
    const player = new Player(physics, 360, 300, "knight", "guy"); // 60px — in lunge range
    const a = arena(physics);
    a.addPlayer("p", player);
    a.addEnemy("e", fang);
    const ps = new Map<string, PlayerState>([["p", player.state]]);
    const startHp = player.state.health;
    let telegraphed = false;
    let hit = false;
    for (let t = 0; t < 60; t++) {
      fang.tick(ps, SERVER_TICK_MS);
      if (fang.state.telegraph) telegraphed = true;
      physicsTick(physics, [fang, player]);
      a.step();
      if (player.state.health < startHp) hit = true;
    }
    expect(telegraphed).toBe(true);
    expect(hit).toBe(true);
  });
});
