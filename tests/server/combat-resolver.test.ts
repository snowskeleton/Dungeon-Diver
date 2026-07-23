import { describe, it, expect } from "vitest";
import { Layer, Attack, HitShape, PLAYER_ATTACK_AFFECTS, ENEMY_ATTACK_AFFECTS } from "shared";
import { CombatSystem, CombatTarget } from "../../server/src/combat/CombatSystem";
import { HitSource } from "../../server/src/combat/HitSource";
import { RehitGate } from "../../server/src/combat/RehitGate";

// The resolver's four rules, each isolated. Real Players/Enemies are exercised
// end-to-end elsewhere; here the targets are stubs so a failure points at the
// resolver rather than at whatever the goo's stat block happens to be today.

class Dummy implements CombatTarget {
  state: { x: number; y: number };
  damageable = true;
  taken: Attack[] = [];
  /** Set to mitigate, so "damage actually dealt" can be told apart from asked. */
  mitigate = 0;

  constructor(x: number, y: number, public hurtBounds = { halfW: 8, halfH: 8, offsetX: 0, offsetY: 0 }) {
    this.state = { x, y };
  }

  takeHit(attack: Attack): number {
    this.taken.push(attack);
    return Math.max(0, attack.damage - this.mitigate);
  }
}

const attack = (damage = 10): Attack => ({ damage, knockback: 0, sourceX: 0, sourceY: 0 });

function source(over: Partial<HitSource> = {}): HitSource {
  return {
    shape: { kind: "circle", cx: 0, cy: 0, r: 20 } as HitShape,
    affects: PLAYER_ATTACK_AFFECTS,
    attack: attack(),
    claim: () => true,
    ...over,
  };
}

function groups(players: Map<string, CombatTarget>, enemies: Map<string, CombatTarget>) {
  return [
    { layer: Layer.PLAYER, targets: players },
    { layer: Layer.ENEMY, targets: enemies },
  ];
}

describe("CombatSystem.resolve", () => {
  it("lands a hit on an overlapping target of an affected layer", () => {
    const combat = new CombatSystem();
    const enemy = new Dummy(10, 0);
    const hits = combat.resolve([source()], groups(new Map(), new Map([["e1", enemy]])));

    expect(enemy.taken).toHaveLength(1);
    expect(hits).toEqual([{ x: 10, y: 0, targetId: "e1", ownerId: undefined, damage: 10 }]);
  });

  it("spares layers the source's affects mask does not reach", () => {
    const combat = new CombatSystem();
    const player = new Dummy(0, 0);
    const enemy = new Dummy(0, 0);
    combat.resolve([source({ affects: PLAYER_ATTACK_AFFECTS })], groups(
      new Map([["p1", player]]),
      new Map([["e1", enemy]]),
    ));

    expect(enemy.taken).toHaveLength(1);
    expect(player.taken).toHaveLength(0); // no friendly fire, by mask
  });

  it("reverses cleanly for an enemy source — players hurt, enemies spared", () => {
    const combat = new CombatSystem();
    const player = new Dummy(0, 0);
    const bystander = new Dummy(0, 0);
    combat.resolve([source({ affects: ENEMY_ATTACK_AFFECTS })], groups(
      new Map([["p1", player]]),
      new Map([["e2", bystander]]),
    ));

    expect(player.taken).toHaveLength(1);
    expect(bystander.taken).toHaveLength(0);
  });

  it("never hits the source's own owner", () => {
    const combat = new CombatSystem();
    const self = new Dummy(0, 0);
    const other = new Dummy(0, 0);
    combat.resolve(
      [source({ affects: Layer.ENEMY, ownerId: "e1" })],
      groups(new Map(), new Map([["e1", self], ["e2", other]])),
    );

    expect(self.taken).toHaveLength(0);
    expect(other.taken).toHaveLength(1);
  });

  it("skips targets that are not damageable", () => {
    const combat = new CombatSystem();
    const corpse = new Dummy(0, 0);
    corpse.damageable = false;
    combat.resolve([source()], groups(new Map(), new Map([["e1", corpse]])));

    expect(corpse.taken).toHaveLength(0);
  });

  it("skips targets whose hurt box does not overlap", () => {
    const combat = new CombatSystem();
    const near = new Dummy(27, 0);  // box reaches x=19, circle reaches x=20
    const far = new Dummy(29, 0);   // box reaches x=21 — outside
    combat.resolve([source()], groups(new Map(), new Map([["near", near], ["far", far]])));

    expect(near.taken).toHaveLength(1);
    expect(far.taken).toHaveLength(0);
  });

  it("respects the hurt box's offset from the sprite centre", () => {
    const combat = new CombatSystem();
    // Centre is well out of reach, but the box is offset back toward the source.
    const offset = new Dummy(40, 0, { halfW: 8, halfH: 8, offsetX: -20, offsetY: 0 });
    combat.resolve([source()], groups(new Map(), new Map([["e1", offset]])));

    expect(offset.taken).toHaveLength(1);
    // And the reported hit position is the BOX centre, not the sprite centre.
    expect(offset.state.x).toBe(40);
  });

  it("lets the source's claim veto a hit", () => {
    const combat = new CombatSystem();
    const enemy = new Dummy(0, 0);
    combat.resolve([source({ claim: () => false })], groups(new Map(), new Map([["e1", enemy]])));

    expect(enemy.taken).toHaveLength(0);
  });

  it("only consumes a claim for targets that actually overlap", () => {
    const combat = new CombatSystem();
    const claimed: string[] = [];
    const inRange = new Dummy(0, 0);
    const outOfRange = new Dummy(500, 500);
    combat.resolve(
      [source({ claim: (id) => { claimed.push(id); return true; } })],
      groups(new Map(), new Map([["in", inRange], ["out", outOfRange]])),
    );

    expect(claimed).toEqual(["in"]);
  });

  it("reports damage ACTUALLY dealt, not damage asked for", () => {
    const combat = new CombatSystem();
    const armored = new Dummy(0, 0);
    armored.mitigate = 7;
    const dealt: number[] = [];
    const hits = combat.resolve(
      [source({ attack: attack(10), onDealt: (_, d) => dealt.push(d) })],
      groups(new Map(), new Map([["e1", armored]])),
    );

    expect(hits[0].damage).toBe(3);
    expect(dealt).toEqual([3]); // lifesteal reads this, so it must be the real number
  });

  it("applies one source to every overlapping target (an AOE hits the crowd)", () => {
    const combat = new CombatSystem();
    const crowd = new Map<string, CombatTarget>([
      ["a", new Dummy(0, 0)],
      ["b", new Dummy(5, 5)],
      ["c", new Dummy(-5, -5)],
      ["far", new Dummy(400, 400)],
    ]);
    const hits = combat.resolve([source()], groups(new Map(), crowd));

    expect(hits.map(h => h.targetId).sort()).toEqual(["a", "b", "c"]);
  });

  it("applies every source in a tick, so two swings both land", () => {
    const combat = new CombatSystem();
    const enemy = new Dummy(0, 0);
    combat.resolve(
      [source({ ownerId: "p1" }), source({ ownerId: "p2" })],
      groups(new Map(), new Map([["e1", enemy]])),
    );

    expect(enemy.taken).toHaveLength(2);
  });

  it("carries the owner id through, so a caller can tell whose hit it was", () => {
    const combat = new CombatSystem();
    const hits = combat.resolve(
      [source({ ownerId: "p1" })],
      groups(new Map(), new Map([["e1", new Dummy(0, 0)]])),
    );

    expect(hits[0].ownerId).toBe("p1");
  });

  it("returns an empty list when nothing connects", () => {
    const combat = new CombatSystem();
    expect(combat.resolve([], groups(new Map(), new Map()))).toEqual([]);
    expect(combat.resolve([source()], groups(new Map(), new Map()))).toEqual([]);
  });
});

describe("RehitGate", () => {
  it("lets a target through once, then blocks it while cooling down", () => {
    const gate = new RehitGate(100);
    expect(gate.claim("a")).toBe(true);
    expect(gate.claim("a")).toBe(false);
  });

  it("tracks each target independently", () => {
    const gate = new RehitGate(100);
    expect(gate.claim("a")).toBe(true);
    expect(gate.claim("b")).toBe(true); // b is not blocked by a's cooldown
    expect(gate.claim("b")).toBe(false);
  });

  it("re-admits a target once its cooldown elapses", () => {
    const gate = new RehitGate(100);
    gate.claim("a");
    gate.tick(50);
    expect(gate.claim("a")).toBe(false);
    gate.tick(50); // 100 total
    expect(gate.claim("a")).toBe(true);
  });

  it("blocks forever at Infinity — the one-hit-per-activation policy", () => {
    const gate = new RehitGate(Infinity);
    expect(gate.claim("a")).toBe(true);
    for (let i = 0; i < 100; i++) gate.tick(1000);
    expect(gate.claim("a")).toBe(false);
  });

  it("reset clears every target, so the next cast starts fresh", () => {
    const gate = new RehitGate(Infinity);
    gate.claim("a");
    gate.claim("b");
    gate.reset();
    expect(gate.claim("a")).toBe(true);
    expect(gate.claim("b")).toBe(true);
  });
});
