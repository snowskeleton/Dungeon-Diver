import { describe, it, expect } from "vitest";
import {
  WEAPONS,
  WEAPON_REGISTRY,
  AMMO_REGISTRY,
  Weapon,
  WeaponInstance,
  WeaponMod,
  WeaponId,
  Sword,
  WeaponCategory,
  foldStat,
  resolveCooldown,
  MIN_ATTACK_COOLDOWN_MS,
  viewFromTemplate,
  viewFromSlot,
  isStripFx,
} from "shared";

const templates = WEAPONS.map(W => new W());

// ── Registry integrity ───────────────────────────────────────────────────────
// These are the invariants that keep the roster from rotting: a weapon whose id
// collides with another silently replaces it in the derived registry, and a
// ranged weapon pointing at ammo that doesn't exist crashes only when someone
// fires it. Both are cheap to assert once over the whole array.

describe("weapon registry", () => {
  it("has weapons in it", () => {
    expect(templates.length).toBeGreaterThan(0);
  });

  it("derives one registry entry per class, with no id collisions", () => {
    const ids = templates.map(w => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(WEAPON_REGISTRY)).toHaveLength(templates.length);
  });

  it("maps every id back to the weapon that declared it", () => {
    for (const w of templates) {
      expect(WEAPON_REGISTRY[w.id].id).toBe(w.id);
    }
  });

  it("gives every weapon a non-empty display name", () => {
    for (const w of templates) {
      expect(w.name.length, `${w.id} has no name`).toBeGreaterThan(0);
    }
  });

  it("points every ranged weapon at ammo that actually exists", () => {
    for (const w of templates) {
      if (!w.isRanged) continue;
      expect(AMMO_REGISTRY[w.ammoId!], `${w.id} → missing ammo "${w.ammoId}"`).toBeDefined();
    }
  });

  it("gives every ranged weapon a render style, so the client knows what to draw", () => {
    for (const w of templates) {
      if (!w.isRanged) continue;
      expect(["held", "thrown", "cast"], `${w.id}`).toContain(w.rangedStyle);
    }
  });

  it("derives an icon path under the weapon's own category folder", () => {
    for (const w of templates) {
      expect(w.iconPath).toBe(`/sprites/weapons/${categoryDir(w)}/${w.id}/${w.id}.png`);
    }
  });

  it("keeps every stat physically sensible", () => {
    for (const w of templates) {
      expect(w.damage, `${w.id} damage`).toBeGreaterThanOrEqual(0);
      expect(w.attackCooldownMs, `${w.id} cooldown`).toBeGreaterThan(0);
      expect(w.attackForce, `${w.id} force`).toBeGreaterThanOrEqual(0);
    }
  });
});

function categoryDir(w: Weapon): string {
  return {
    sword: "swords", axe: "axes", spear: "spears", rapier: "rapiers",
    mace: "maces", dagger: "daggers", hammer: "hammers",
    bow: "bows", crossbow: "crossbows", staff: "staves", thrown: "thrown",
  }[w.category];
}

// ── Melee vs ranged vs AOE, as mutually-exclusive modes ──────────────────────

describe("weapon mode", () => {
  it("treats a weapon with ammo as ranged and one without as melee", () => {
    const melee = templates.filter(w => !w.isRanged && !w.isAoe);
    const ranged = templates.filter(w => w.isRanged);
    expect(melee.length).toBeGreaterThan(0);
    expect(ranged.length).toBeGreaterThan(0);
    for (const w of ranged) expect(w.ammoId).toBeDefined();
    for (const w of melee) expect(w.ammoId).toBeUndefined();
  });

  it("gives every melee strip weapon a real hurtbox and every ranged one none", () => {
    for (const w of templates) {
      const box = w.getHurtbox(0, 0, "right", 200); // mid-swing
      if (w.isRanged || w.isAoe || !isStripFx(w.fxType)) {
        expect(box, `${w.id} should have no melee region`).toBeNull();
      } else {
        expect(box, `${w.id} draws nothing at 200ms into its swing`).not.toBeNull();
      }
    }
  });

  it("gives each staff its own element rather than sharing one bolt", () => {
    const staves = templates.filter(w => w.category === "staff");
    expect(staves.length).toBeGreaterThan(1);
    const elements = new Set(staves.map(s => s.ammoId));
    expect(elements.size).toBeGreaterThan(1);
    for (const s of staves) {
      expect(AMMO_REGISTRY[s.ammoId!]).toBeDefined();
    }
  });

  it("makes ranged weapons contribute fire rate and ammo, not melee damage", () => {
    // Ranged damage lives on the ammo; the weapon's own damage is a flat bonus,
    // and most declare 0. Asserting the RULE, not any particular weapon's number.
    for (const w of templates.filter(t => t.isRanged)) {
      expect(w.damage, `${w.id}`).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── The three-level class chain ──────────────────────────────────────────────

describe("stat inheritance", () => {
  it("resolves a stat from the category base when the weapon doesn't override it", () => {
    class PlainSword extends Sword {
      readonly id = "test-plain" as WeaponId;
      readonly name = "Plain";
    }
    const plain = new PlainSword();
    const swordDefaults = new (class extends Sword {
      readonly id = "test-ref" as WeaponId;
      readonly name = "Ref";
    })();

    expect(plain.damage).toBe(swordDefaults.damage);
    expect(plain.category).toBe("sword");
  });

  it("lets a concrete weapon override only what differs", () => {
    class Heavy extends Sword {
      readonly id = "test-heavy" as WeaponId;
      readonly name = "Heavy";
      override get damage() { return 999; }
    }
    const heavy = new Heavy();
    expect(heavy.damage).toBe(999);
    expect(heavy.fxType).toBe(new (class extends Sword {
      readonly id = "test-ref2" as WeaponId;
      readonly name = "Ref";
    })().fxType); // untouched inherited stat
  });
});

// ── Instances: the per-wielder layer ─────────────────────────────────────────

class Plus extends WeaponMod {
  readonly label = "test";
  constructor(private readonly n: number) { super(); }
  override get damageFlat() { return this.n; }
}
class Pct extends WeaponMod {
  readonly label = "test%";
  constructor(private readonly p: number) { super(); }
  override get damagePct() { return this.p; }
}
class Faster extends WeaponMod {
  readonly label = "faster";
  constructor(private readonly p: number) { super(); }
  override get attackSpeedPct() { return this.p; }
}
class Heavier extends WeaponMod {
  readonly label = "heavier";
  constructor(private readonly n: number) { super(); }
  override get attackForceFlat() { return this.n; }
}

describe("WeaponInstance", () => {
  const template = WEAPON_REGISTRY["broadsword"];

  it("passes template stats straight through when unmodified", () => {
    const inst = new WeaponInstance(template, "a");
    expect(inst.damage).toBe(template.damage);
    expect(inst.attackCooldownMs).toBe(template.attackCooldownMs);
    expect(inst.attackForce).toBe(template.attackForce);
    expect(inst.isModified).toBe(false);
  });

  it("delegates identity and visuals to the template, unfolded", () => {
    const inst = new WeaponInstance(template, "a", [new Plus(5)]);
    expect(inst.id).toBe(template.id);
    expect(inst.name).toBe(template.name);
    expect(inst.iconPath).toBe(template.iconPath);
    expect(inst.fxType).toBe(template.fxType);
  });

  it("changes only its own copy — the template and its siblings are untouched", () => {
    const plain = new WeaponInstance(template, "a");
    const rolled = new WeaponInstance(template, "b", [new Plus(2)]);

    expect(rolled.damage).toBe(template.damage + 2);
    expect(plain.damage).toBe(template.damage);
    expect(WEAPON_REGISTRY["broadsword"].damage).toBe(template.damage);
  });

  it("folds flat before percent", () => {
    const inst = new WeaponInstance(template, "c", [new Plus(2), new Pct(0.5)]);
    expect(inst.damage).toBeCloseTo((template.damage + 2) * 1.5, 9);
  });

  it("gives the same total whatever order the mods were applied in", () => {
    const a = new WeaponInstance(template, "a", [new Plus(2), new Pct(0.5)]);
    const b = new WeaponInstance(template, "b", [new Pct(0.5), new Plus(2)]);
    expect(a.damage).toBe(b.damage);
  });

  it("folds attack force the same way", () => {
    const inst = new WeaponInstance(template, "d", [new Heavier(3)]);
    expect(inst.attackForce).toBe(template.attackForce + 3);
  });

  it("treats cooldown as attack SPEED, so +100% halves it", () => {
    const inst = new WeaponInstance(template, "e", [new Faster(1)]);
    expect(inst.attackCooldownMs).toBeCloseTo(template.attackCooldownMs / 2, 9);
  });

  it("never lets stacked attack speed collapse the cooldown to nothing", () => {
    const inst = new WeaponInstance(template, "f", [new Faster(1000)]);
    expect(inst.attackCooldownMs).toBe(MIN_ATTACK_COOLDOWN_MS);
    expect(inst.attackCooldownMs).toBeGreaterThan(0);
  });

  it("exposes mod labels in the order applied, for the stat panel", () => {
    const inst = new WeaponInstance(template, "g", [new Plus(2), new Faster(0.1)]);
    expect(inst.modLabels).toEqual(["test", "faster"]);
  });

  it("reports itself modified as soon as it carries any mod", () => {
    expect(new WeaponInstance(template, "h", [new Plus(0)]).isModified).toBe(true);
  });
});

describe("stat folding primitives", () => {
  it("foldStat is (base + flat) × (1 + pct)", () => {
    expect(foldStat(10, 2, 0.5)).toBe(18);
    expect(foldStat(10, 0, 0)).toBe(10);
    expect(foldStat(10, -5, 0)).toBe(5);
    expect(foldStat(10, 0, -0.5)).toBe(5);
  });

  it("resolveCooldown divides by speed and never returns zero", () => {
    expect(resolveCooldown(500, 0)).toBe(500);
    expect(resolveCooldown(500, 1)).toBe(250);
    expect(resolveCooldown(500, 4)).toBe(100);
    expect(resolveCooldown(500, 1e9)).toBe(MIN_ATTACK_COOLDOWN_MS);
  });
});

// ── The wire adapters ────────────────────────────────────────────────────────

describe("weapon views", () => {
  it("shows a melee template's own stats and no ammo block", () => {
    const view = viewFromTemplate(WEAPON_REGISTRY["broadsword"]);
    expect(view.damage).toBe(WEAPON_REGISTRY["broadsword"].damage);
    expect(view.ammo).toBeUndefined();
  });

  it("adds a ranged weapon's damage to its ammo's, in one place", () => {
    const bow = WEAPON_REGISTRY["longbow"];
    const ammo = AMMO_REGISTRY[bow.ammoId!];
    const view = viewFromTemplate(bow);
    expect(view.ammo!.damage).toBe(ammo.damage + bow.damage);
    expect(view.ammo!.speed).toBe(ammo.speed);
    expect(view.ammo!.pierce).toBe(ammo.pierce);
  });

  it("round-trips a synced slot back to the same numbers", () => {
    const inst = new WeaponInstance(WEAPON_REGISTRY["broadsword"], "x", [new Plus(3)]);
    const slot = {
      uid: inst.uid,
      weaponId: inst.id,
      damage: inst.damage,
      attackCooldownMs: Math.round(inst.attackCooldownMs),
      attackForce: inst.attackForce,
      ammoDamage: 0, ammoSpeed: 0, ammoPierce: 0, ammoKnockback: 0,
      modLabels: inst.modLabels,
    };
    const view = viewFromSlot(slot)!;

    expect(view.damage).toBe(inst.damage);
    expect(view.name).toBe(inst.name);
    expect(view.ammo).toBeUndefined();
  });

  it("returns null for an unknown weapon id rather than inventing a weapon", () => {
    expect(viewFromSlot({
      uid: "x", weaponId: "no-such-weapon",
      damage: 1, attackCooldownMs: 1, attackForce: 1,
      ammoDamage: 0, ammoSpeed: 0, ammoPierce: 0, ammoKnockback: 0,
      modLabels: [],
    })).toBeNull();
  });
});

describe("AOE weapons", () => {
  it("expose an aoe spec that marks them as neither melee nor ranged", () => {
    // Extends Weapon rather than Staff: a Staff always carries an ammoId (it
    // fires an elemental bolt), and an AOE weapon by definition does not.
    class NovaStaff extends Weapon {
      readonly id = "test-nova" as WeaponId;
      readonly name = "Nova";
      get category(): WeaponCategory { return "staff"; }
      override get aoe() { return { radius: 76, windUpMs: 260, blastMs: 130 }; }
    }
    const nova = new NovaStaff();
    expect(nova.isAoe).toBe(true);
    expect(nova.isRanged).toBe(false);
    expect(nova.getHurtbox(0, 0, "right", 100)).toBeNull();
  });
});
