import { describe, it, expect } from "vitest";
import { UPGRADE_IDS, UpgradeId, WEAPON_REGISTRY, WeaponInstance } from "shared";
import {
  UPGRADES,
  Upgrade,
  upgradePool,
  upgradeById,
  assertUpgradesCoverAllIds,
  rollWeaponMod,
  SharpMod,
  SavageMod,
  SwiftMod,
  HeavyMod,
} from "../../server/src/upgrades";
import { Player } from "../../server/src/entities/Player";
import { flatWorld } from "../helpers/world";

describe("the upgrade set", () => {
  const instances = () => UPGRADES.map(U => new U());

  it("has no duplicate ids", () => {
    const ids = instances().map(u => u.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("agrees with the shared id union in both directions", () => {
    expect(() => assertUpgradesCoverAllIds()).not.toThrow();

    const built = instances().map(u => u.id).sort();
    expect(built).toEqual([...UPGRADE_IDS].sort());
  });

  it("gives every upgrade a name and a description for its card", () => {
    for (const u of instances()) {
      expect(u.name.length, u.id).toBeGreaterThan(0);
      expect(u.description.length, u.id).toBeGreaterThan(0);
    }
  });

  it("actually contributes something — no upgrade is a no-op", () => {
    for (const u of instances()) {
      const total = Math.abs(u.maxHpFlat) + Math.abs(u.maxHpPct)
        + Math.abs(u.speedFlat) + Math.abs(u.speedPct)
        + Math.abs(u.damageFlat) + Math.abs(u.damagePct)
        + Math.abs(u.armorFlat) + Math.abs(u.armorPct)
        + Math.abs(u.lifestealPct);
      expect(total, `${u.id} contributes nothing`).toBeGreaterThan(0);
    }
  });

  it("defaults every contribution it does not override to zero", () => {
    class Bare extends Upgrade {
      readonly id = "test-bare" as UpgradeId;
      readonly name = "Bare";
      readonly description = "";
    }
    const bare = new Bare();
    expect(bare.maxHpFlat).toBe(0);
    expect(bare.damagePct).toBe(0);
    expect(bare.armorFlat).toBe(0);
    expect(bare.lifestealPct).toBe(0);
    expect(bare.minFloor).toBe(1);
    expect(bare.spell()).toBeNull(); // passive by default
  });

  it("gates percent-scaling upgrades behind the floor where they matter", () => {
    // Percent tiers are dead weight on floor 1, so at least one must be gated —
    // otherwise minFloor is decoration.
    expect(instances().some(u => u.minFloor > 1)).toBe(true);
  });
});

describe("the offer pool", () => {
  it("offers only upgrades legal on the floor", () => {
    for (const floor of [1, 2, 3, 5, 10]) {
      for (const u of upgradePool(floor)) {
        expect(u.minFloor, `${u.id} on floor ${floor}`).toBeLessThanOrEqual(floor);
      }
    }
  });

  it("grows as the run goes deeper, and is never empty", () => {
    expect(upgradePool(1).length).toBeGreaterThan(0);
    expect(upgradePool(10).length).toBeGreaterThanOrEqual(upgradePool(1).length);
    expect(upgradePool(10)).toHaveLength(UPGRADES.length);
  });

  it("hands out FRESH instances, so two players never share one object", () => {
    const a = upgradePool(10);
    const b = upgradePool(10);
    expect(a[0]).not.toBe(b[0]);
    expect(a[0].id).toBe(b[0].id);
  });
});

describe("upgradeById", () => {
  it("finds every upgrade the set declares", () => {
    for (const id of UPGRADE_IDS) {
      expect(upgradeById(id)?.id, id).toBe(id);
    }
  });

  it("returns nothing for an id that isn't one", () => {
    expect(upgradeById("not-an-upgrade")).toBeUndefined();
  });
});

describe("upgrades folded into a player", () => {
  const player = () => new Player(flatWorld(), 300, 300);

  it("leaves a player with none exactly at their class's stats", () => {
    const p = player();
    expect(p.maxHp).toBe(p.charConfig.maxHp);
    expect(p.speed).toBe(p.charConfig.speed);
  });

  it("mirrors each held upgrade onto the wire, descriptively", () => {
    const p = player();
    const u = new (UPGRADES[0])();
    p.addUpgrade(u);

    expect(p.upgrades).toHaveLength(1);
    expect(p.state.upgrades).toHaveLength(1);
    expect(p.state.upgrades[0]!.id).toBe(u.id);
    expect(p.state.upgrades[0]!.name).toBe(u.name);
    expect(p.state.upgrades[0]!.description).toBe(u.description);
  });

  it("survives holding every upgrade at once without producing a nonsense stat", () => {
    const p = player();
    for (const U of UPGRADES) p.addUpgrade(new U());

    expect(p.maxHp).toBeGreaterThan(0);
    expect(Number.isFinite(p.maxHp)).toBe(true);
    expect(p.speed).toBeGreaterThan(0);
    expect(p.state.health).toBeLessThanOrEqual(p.maxHp);
    expect(p.takeHit({ damage: 50, knockback: 0, sourceX: 0, sourceY: 0 })).toBeGreaterThanOrEqual(1);
  });

  it("stacks duplicates of the same upgrade", () => {
    const p = player();
    const base = p.scaleAttack({ damage: 100, knockback: 0 }).damage;
    const U = UPGRADES.find(U => new U().damageFlat > 0)!;
    p.addUpgrade(new U());
    const once = p.scaleAttack({ damage: 100, knockback: 0 }).damage;
    p.addUpgrade(new U());
    const twice = p.scaleAttack({ damage: 100, knockback: 0 }).damage;

    expect(once).toBeGreaterThan(base);
    expect(twice - once).toBeCloseTo(once - base, 6);
  });
});

// ── Weapon modifiers ─────────────────────────────────────────────────────────

describe("weapon modifiers", () => {
  const template = WEAPON_REGISTRY["broadsword"];
  const withMod = (m: InstanceType<typeof SharpMod>) => new WeaponInstance(template, "x", [m]);

  it("SharpMod adds flat damage and labels itself", () => {
    const m = new SharpMod(4);
    expect(m.damageFlat).toBe(4);
    expect(m.label).toBe("+4 damage");
    expect(withMod(m).damage).toBe(template.damage + 4);
  });

  it("SavageMod adds percent damage and labels itself as a percentage", () => {
    const m = new SavageMod(0.25);
    expect(m.damagePct).toBe(0.25);
    expect(m.label).toBe("+25% damage");
  });

  it("SwiftMod adds attack speed, which divides the cooldown", () => {
    const m = new SwiftMod(1);
    expect(m.attackSpeedPct).toBe(1);
    expect(new WeaponInstance(template, "x", [m]).attackCooldownMs)
      .toBeCloseTo(template.attackCooldownMs / 2, 9);
  });

  it("HeavyMod adds knockback force", () => {
    const m = new HeavyMod(3);
    expect(m.attackForceFlat).toBe(3);
    expect(new WeaponInstance(template, "x", [m]).attackForce).toBe(template.attackForce + 3);
  });

  it("leaves every stat it does not touch alone", () => {
    const inst = new WeaponInstance(template, "x", [new SharpMod(4)]);
    expect(inst.attackCooldownMs).toBe(template.attackCooldownMs);
    expect(inst.attackForce).toBe(template.attackForce);
  });
});

describe("rolling a weapon modifier", () => {
  it("always produces a labelled modifier that changes something", () => {
    for (let i = 0; i < 200; i++) {
      const m = rollWeaponMod(1 + (i % 8));
      expect(m.label.length).toBeGreaterThan(0);
      const total = Math.abs(m.damageFlat) + Math.abs(m.damagePct)
        + Math.abs(m.attackForceFlat) + Math.abs(m.attackForcePct)
        + Math.abs(m.attackSpeedPct);
      expect(total).toBeGreaterThan(0);
    }
  });

  it("scales magnitude with depth, so a deep reward beats a shallow one", () => {
    const mean = (floor: number, pick: (m: ReturnType<typeof rollWeaponMod>) => number) => {
      let total = 0;
      let n = 0;
      for (let i = 0; i < 4000; i++) {
        const v = pick(rollWeaponMod(floor));
        if (v > 0) { total += v; n++; }
      }
      return n ? total / n : 0;
    };
    expect(mean(8, m => m.damageFlat)).toBeGreaterThan(mean(1, m => m.damageFlat));
    expect(mean(8, m => m.damagePct)).toBeGreaterThan(mean(1, m => m.damagePct));
  });

  it("keeps rolled percentages to two decimals, so stat panels stay readable", () => {
    for (let floor = 1; floor <= 10; floor++) {
      for (let i = 0; i < 200; i++) {
        const m = rollWeaponMod(floor);
        for (const pct of [m.damagePct, m.attackSpeedPct, m.attackForcePct]) {
          expect(Math.round(pct * 100) / 100).toBe(pct);
        }
      }
    }
  });

  it("never rolls a flat bonus below 1 — a '+0 damage' roll would be a dud", () => {
    for (let i = 0; i < 500; i++) {
      const m = rollWeaponMod(1);
      if (m.damageFlat > 0) expect(m.damageFlat).toBeGreaterThanOrEqual(1);
      if (m.attackForceFlat > 0) expect(m.attackForceFlat).toBeGreaterThanOrEqual(1);
    }
  });

  it("can roll each of its four kinds", () => {
    const kinds = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const m = rollWeaponMod(3);
      if (m.damageFlat) kinds.add("flat");
      if (m.damagePct) kinds.add("pct");
      if (m.attackSpeedPct) kinds.add("speed");
      if (m.attackForceFlat) kinds.add("force");
    }
    expect(kinds.size).toBe(4);
  });
});
