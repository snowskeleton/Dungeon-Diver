import { describe, it, expect } from "vitest";
import { SERVER_TICK_MS } from "shared";
import { PlayerState } from "../../server/src/schema/PlayerState";
import { Player } from "../../server/src/entities/Player";
import { flatWorld, arena } from "../helpers/world";
import { SwordBeast, ArmorLancer, Fang } from "../../server/src/entities/enemies";

// An ArmedEnemy swings a real weapon with a wind-up telegraph instead of dealing
// passive touch damage. These pin the behaviour, not any balance number.

function playerAt(physics: ReturnType<typeof flatWorld>, x: number, y: number): Player {
  return new Player(physics, x, y, "knight", "guy");
}

/** Tick the enemy AI then run one combat step, up to `maxTicks`. Returns the tick
 *  the player first took damage on (or -1), and whether a wind-up telegraph was
 *  ever seen before that hit. */
function fight(enemy: SwordBeast | ArmorLancer | Fang, player: Player, maxTicks = 80) {
  const a = arena(player.physics);
  a.addPlayer("p", player);
  a.addEnemy("e", enemy);
  const ps = new Map<string, PlayerState>([["p", player.state]]);
  const startHp = player.state.health;
  let hitTick = -1;
  let telegraphedBeforeHit = false;
  for (let t = 0; t < maxTicks; t++) {
    enemy.tick(ps, SERVER_TICK_MS);
    if (hitTick < 0 && enemy.state.telegraph) telegraphedBeforeHit = true;
    a.step();
    if (hitTick < 0 && player.state.health < startHp) hitTick = t;
  }
  return { hitTick, telegraphedBeforeHit, dealt: startHp - player.state.health };
}

describe("ArmedEnemy — wields a weapon, swings with a wind-up", () => {
  it("a sword-beast lands its swing on an adjacent player", () => {
    const physics = flatWorld();
    const beast = new SwordBeast(physics, 300, 300);
    const player = playerAt(physics, 324, 300); // 24px right, inside attackRange
    const { hitTick, dealt } = fight(beast, player);
    expect(hitTick).toBeGreaterThanOrEqual(0);
    expect(dealt).toBeGreaterThan(0);
  });

  it("telegraphs its wind-up before the blow lands", () => {
    const physics = flatWorld();
    const beast = new SwordBeast(physics, 300, 300);
    const player = playerAt(physics, 324, 300);
    const { telegraphedBeforeHit } = fight(beast, player);
    expect(telegraphedBeforeHit).toBe(true);
  });

  it("deals NO passive contact damage (the swing is the only hazard)", () => {
    const physics = flatWorld();
    const beast = new SwordBeast(physics, 300, 300);
    // contactHitSource is the passive touch hazard — an armed enemy has none.
    expect(beast.contactHitSource("e")).toBeNull();
  });

  it("the armor-lancer's lance reaches a player a sword-beast's swing would miss", () => {
    const physics = flatWorld();
    // 50px away: beyond the sword-beast's 34px commit range, inside the lancer's 58px.
    const lancer = new ArmorLancer(physics, 300, 300);
    const player = playerAt(physics, 350, 300);
    const { dealt } = fight(lancer, player);
    expect(dealt).toBeGreaterThan(0);
  });

  it("Fang lunges instead of dealing passive contact damage", () => {
    const physics = flatWorld();
    const fang = new Fang(physics, 300, 300);
    // No passive touch — its damage is the lunge dash (see directional.ts).
    expect(fang.contactHitSource()).toBeNull();
  });

  it("a shove mid-wind-up interrupts the swing (telegraph clears)", () => {
    const physics = flatWorld();
    const beast = new SwordBeast(physics, 300, 300);
    const player = playerAt(physics, 324, 300);
    const ps = new Map<string, PlayerState>([["p", player.state]]);

    // Tick until the beast is mid-wind-up (telegraph up, blow not yet struck).
    let woundUp = false;
    for (let t = 0; t < 40 && !woundUp; t++) {
      beast.tick(ps, SERVER_TICK_MS);
      woundUp = beast.state.telegraph;
    }
    expect(woundUp).toBe(true);

    // A hard shove from the left staggers it; the next AI tick must cancel the cast.
    beast.applyKnockback(beast.state.x - 40, beast.state.y, 999);
    beast.tick(ps, SERVER_TICK_MS);
    expect(beast.state.telegraph).toBe(false);
  });
});
