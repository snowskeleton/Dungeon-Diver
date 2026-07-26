import { describe, it, expect } from "vitest";
import {
  WEAPON_REGISTRY,
  longFxVariant,
  DEFAULT_COMBO_WINDOW_MS,
  DEFAULT_CHARGE_HOLD_MS,
  SERVER_TICK_MS,
} from "shared";
import { Player } from "../../server/src/entities/Player";
import { GooGreen } from "../../server/src/entities/enemies/goos";
import { arena } from "../helpers/world";

// The melee combo: consecutive swings step through first → reverse → finisher and
// wrap; a pause past the grace window drops back to the first swing. Behaviour and
// relationships only — the shipping multiplier (1.25) is read from the registry,
// never typed as a literal, so a retune doesn't break these.

/** Drive the player through `n` accepted swings by toggling the attack button
 *  (melee fires on the rising edge), recording the comboStep of each accepted
 *  swing. `idleTicksBefore` inserts an attack-released gap first, to let the chain
 *  window lapse. */
function chain(
  a: ReturnType<typeof arena>,
  id: string,
  n: number,
  idleTicksBefore = 0,
): number[] {
  const p = a.players.get(id)!;
  const steps: number[] = [];
  let lastSeq = p.state.attackSeq;
  for (let t = 0; t < idleTicksBefore; t++) a.stepWithInput(id, 0, 0, false);
  // Toggle attack each tick: a press starts a wind-up and the very next tick
  // releases it — a hold of one tick (50ms), well under the hard threshold, so
  // every release is a regular swing that advances the combo. Cap the loop.
  for (let t = 0; steps.length < n && t < 400; t++) {
    a.stepWithInput(id, 0, 0, t % 2 === 0);
    if (p.state.attackSeq !== lastSeq) {
      lastSeq = p.state.attackSeq;
      steps.push(p.state.comboStep);
    }
  }
  return steps;
}

describe("the melee combo definition", () => {
  const combo = WEAPON_REGISTRY["broadsword"].comboSwings;

  it("is a three-hit chain: swing, reversed backswing, wider finisher", () => {
    expect(combo).toHaveLength(3);
    expect(combo[0].mirrored).toBe(false);
    expect(combo[1].mirrored).toBe(true); // the reverse
    expect(combo[2].fxType).toBe(longFxVariant(combo[0].fxType)); // wider reach
  });

  it("only the finisher scales damage and knockback up", () => {
    expect(combo[0].damageMult).toBe(1);
    expect(combo[1].damageMult).toBe(1);
    expect(combo[2].damageMult).toBeGreaterThan(1);
    expect(combo[2].knockbackMult).toBeGreaterThan(1);
  });

  it("the hard (charged) swing defaults to the finisher's shape", () => {
    const hard = WEAPON_REGISTRY["broadsword"].hardSwing;
    expect(hard.fxType).toBe(combo[2].fxType);
    expect(hard.damageMult).toBe(combo[2].damageMult);
    expect(hard.knockbackMult).toBe(combo[2].knockbackMult);
  });
});

describe("a player swinging in sequence", () => {
  it("advances first → reverse → finisher and wraps back", () => {
    const a = arena();
    a.addPlayer("p1", new Player(a.physics, 300, 300, "knight", "guy", "broadsword"));
    expect(chain(a, "p1", 4)).toEqual([0, 1, 2, 0]);
  });

  it("resets to the first swing after the grace window lapses", () => {
    const a = arena();
    const p = a.addPlayer("p1", new Player(a.physics, 300, 300, "knight", "guy", "broadsword"));
    expect(chain(a, "p1", 2)).toEqual([0, 1]);
    // Idle well past cooldown + window, then swing again: back to swing 0.
    const idleTicks =
      Math.ceil((p.weapon.attackCooldownMs + DEFAULT_COMBO_WINDOW_MS) / SERVER_TICK_MS) + 4;
    expect(chain(a, "p1", 1, idleTicks)).toEqual([0]);
  });

  it("a wider grace window keeps the chain alive across a pause a short one would drop", () => {
    // Same pause, two windows: with the short default it resets; a generous window
    // holds the chain. Proves the window actually governs the reset.
    const pauseTicks = Math.ceil(
      (WEAPON_REGISTRY["broadsword"].attackCooldownMs + DEFAULT_COMBO_WINDOW_MS) / SERVER_TICK_MS,
    ) + 2;

    const shortA = arena();
    shortA.addPlayer("p1", new Player(shortA.physics, 300, 300, "knight", "guy", "broadsword"));
    chain(shortA, "p1", 1);
    expect(chain(shortA, "p1", 1, pauseTicks)).toEqual([0]);

    const wideA = arena();
    const wideP = wideA.addPlayer("p1", new Player(wideA.physics, 300, 300, "knight", "guy", "broadsword"));
    wideP.setMeleeTuning(2000, DEFAULT_CHARGE_HOLD_MS);
    chain(wideA, "p1", 1);
    expect(chain(wideA, "p1", 1, pauseTicks)).toEqual([1]); // still chaining
  });

  it("ranged weapons don't combo — every shot is the first swing", () => {
    const a = arena();
    a.addPlayer("r1", new Player(a.physics, 300, 300, "ranger", "guy", "shortbow"));
    // A bow auto-fires while held; every accepted shot stays at step 0.
    const p = a.players.get("r1")!;
    const seen = new Set<number>();
    let lastSeq = p.state.attackSeq;
    for (let t = 0; t < 60; t++) {
      a.stepWithInput("r1", 0, 0, true);
      if (p.state.attackSeq !== lastSeq) {
        lastSeq = p.state.attackSeq;
        seen.add(p.state.comboStep);
      }
    }
    expect([...seen]).toEqual([0]);
  });
});

/** Hold the attack for `holdTicks`, then release for one tick; return the player. */
function holdRelease(a: ReturnType<typeof arena>, id: string, holdTicks: number) {
  for (let t = 0; t < holdTicks; t++) a.stepWithInput(id, 0, 0, true);
  a.stepWithInput(id, 0, 0, false); // release fires the swing
  return a.players.get(id)!;
}

describe("deferred melee: tap vs hold", () => {
  const holdTicksFor = (ms: number) => Math.ceil(ms / SERVER_TICK_MS) + 1;

  it("holding past the threshold releases a hard swing; a tap does not", () => {
    const a = arena();
    a.addPlayer("p1", new Player(a.physics, 300, 300, "knight", "guy", "broadsword"));

    // A one-tick tap: regular swing, not hard.
    const tapped = holdRelease(a, "p1", 1);
    expect(tapped.state.hardSwing).toBe(false);

    // Idle to drop the combo, then hold well past the threshold: hard swing.
    for (let t = 0; t < 20; t++) a.stepWithInput("p1", 0, 0, false);
    const held = holdRelease(a, "p1", holdTicksFor(DEFAULT_CHARGE_HOLD_MS));
    expect(held.state.hardSwing).toBe(true);
    expect(held.state.comboStep).toBe(0); // a heavy resets the tap combo
  });

  it("nothing fires until release — the wind-up just charges", () => {
    const a = arena();
    const p = a.addPlayer("p1", new Player(a.physics, 300, 300, "knight", "guy", "broadsword"));
    const seq0 = p.state.attackSeq;
    // Hold well past the hard threshold WITHOUT releasing: still charging, unfired.
    for (let t = 0; t < holdTicksFor(DEFAULT_CHARGE_HOLD_MS) + 3; t++) {
      a.stepWithInput("p1", 0, 0, true);
    }
    expect(p.state.charging).toBe(true);
    expect(p.state.chargeHard).toBe(true); // heavy is armed
    expect(p.state.attackSeq).toBe(seq0); // but nothing has fired
    // Release: now it fires exactly once.
    a.stepWithInput("p1", 0, 0, false);
    expect(p.state.attackSeq).not.toBe(seq0);
    expect(p.state.charging).toBe(false);
    expect(p.state.hardSwing).toBe(true);
  });

  it("the charge threshold is tunable per player", () => {
    const a = arena();
    const p = a.addPlayer("p1", new Player(a.physics, 300, 300, "knight", "guy", "broadsword"));
    p.setMeleeTuning(DEFAULT_COMBO_WINDOW_MS, 3000); // very long hold to go hard
    // A hold that would be hard by default is only a regular swing now.
    const held = holdRelease(a, "p1", holdTicksFor(DEFAULT_CHARGE_HOLD_MS));
    expect(held.state.hardSwing).toBe(false);
  });
});

describe("the finisher hits harder", () => {
  it("deals its multiplier more damage than the first swing", () => {
    const a = arena();
    const p = a.addPlayer("p1", new Player(a.physics, 300, 300, "knight", "guy", "broadsword"));
    p.state.facing = "right";
    // A durable, stationary dummy pinned in reach so every swing lands cleanly.
    const e = a.addEnemy("e1", new GooGreen(a.physics, 316, 300));
    e.state.health = 1_000_000;

    // Record the damage of the hit landed on each accepted swing, keeping the enemy
    // pinned so knockback can't carry it out of range.
    const damageByStep: number[] = [];
    let lastSeq = p.state.attackSeq;
    let stepOfSwing = 0;
    for (let t = 0; t < 200 && damageByStep.length < 3; t++) {
      e.teleport(316, 300);
      const hits = a.stepWithInput("p1", 0, 0, t % 2 === 0);
      if (p.state.attackSeq !== lastSeq) {
        lastSeq = p.state.attackSeq;
        stepOfSwing = p.state.comboStep;
      }
      const dmg = hits.find(h => h.targetId === "e1")?.damage;
      if (dmg !== undefined && damageByStep[stepOfSwing] === undefined) {
        damageByStep[stepOfSwing] = dmg;
      }
    }

    const mult = WEAPON_REGISTRY["broadsword"].comboSwings[2].damageMult;
    expect(damageByStep[0]).toBeGreaterThan(0);
    expect(damageByStep[2]).toBeCloseTo(damageByStep[0] * mult, 5);
  });
});
