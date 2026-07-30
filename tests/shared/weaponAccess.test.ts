import { describe, it, expect } from "vitest";
import {
  CHARACTER_CLASSES,
  getCharacter,
  CharacterClass,
  WEAPON_REGISTRY,
  WeaponId,
  canClassUseCategory,
  canClassUseWeapon,
  firstRollCategories,
  firstRollWeaponIds,
  partyRollableWeaponIds,
  assertClassesHaveFirstRollPool,
} from "shared";

// D9/D18: weapons are restricted BY CLASS, and the restriction lives on the class
// (usableCategories) — these query helpers derive everything from those lists, so a
// class's identity and the loot filter can't drift from what it declares.

const CLASSES: CharacterClass[] = CHARACTER_CLASSES;
const anyWeaponOfCategory = (cat: string): WeaponId =>
  (Object.keys(WEAPON_REGISTRY) as WeaponId[]).find((id) => WEAPON_REGISTRY[id].category === cat)!;

describe("class weapon access", () => {
  it("lets the Mage — and only the Mage — wield a staff", () => {
    const staff = anyWeaponOfCategory("staff");
    expect(canClassUseWeapon("mage", staff)).toBe(true);
    for (const cls of CLASSES) {
      if (cls === "mage") continue;
      expect(canClassUseWeapon(cls, staff), cls).toBe(false);
    }
  });

  it("lets every class wield a shared-backbone sword", () => {
    const sword = anyWeaponOfCategory("sword");
    for (const cls of CLASSES) expect(canClassUseWeapon(cls, sword), cls).toBe(true);
  });

  it("matches canClassUseCategory to the class's declared list", () => {
    for (const cls of CLASSES) {
      for (const cat of getCharacter(cls).usableCategories) {
        expect(canClassUseCategory(cls, cat), `${cls}/${cat}`).toBe(true);
      }
    }
  });

  it("treats an unknown weapon id as unusable, never a crash", () => {
    expect(canClassUseWeapon("knight", "not-a-weapon")).toBe(false);
  });

  it("puts the beast weapons in the shared catalog, rollable by the party", () => {
    // The beasts wield their own weapons, but those live in the main WEAPONS
    // catalog (not an enemy-only pool), so anyone who can use the category may roll
    // one. sword/axe/mace are shared melee categories every class can wield.
    const beasts: WeaponId[] = ["beast-sword", "beast-axe", "beast-mace"];
    for (const id of beasts) expect(WEAPON_REGISTRY[id], id).toBeDefined();
    const rollable = partyRollableWeaponIds(CLASSES);
    for (const id of beasts) expect(rollable, id).toContain(id);
  });
});

describe("first-roll (unique) categories", () => {
  it("gives each class the categories no other class can use", () => {
    // Derived by set-difference, so this is really a test of the class declarations.
    expect(firstRollCategories("knight").sort()).toEqual(["hammer", "mace"]);
    expect(firstRollCategories("mage")).toEqual(["staff"]);
    expect(firstRollCategories("ranger").sort()).toEqual(["bow", "crossbow"]);
    expect(firstRollCategories("rogue").sort()).toEqual(["dagger", "thrown"]);
  });

  it("never includes a shared category in any class's unique set", () => {
    for (const cls of CLASSES) {
      for (const cat of firstRollCategories(cls)) {
        const owners = CLASSES.filter((c) => canClassUseCategory(c, cat));
        expect(owners, cat).toEqual([cls]);
      }
    }
  });

  it("gives every class a non-empty first-weapon pool, all self-usable", () => {
    for (const cls of CLASSES) {
      const pool = firstRollWeaponIds(cls);
      expect(pool.length, cls).toBeGreaterThan(0);
      for (const id of pool) expect(canClassUseWeapon(cls, id), `${cls}/${id}`).toBe(true);
    }
    // The boot invariant agrees.
    expect(() => assertClassesHaveFirstRollPool()).not.toThrow();
  });
});

describe("party loot filter (D10)", () => {
  it("excludes categories no present class can use", () => {
    // A knight-only party can never see a staff, bow, crossbow, dagger or thrown.
    const usable = partyRollableWeaponIds(["knight"]);
    const forbidden = new Set(["staff", "bow", "crossbow", "dagger", "thrown"]);
    for (const id of usable) expect(forbidden.has(WEAPON_REGISTRY[id].category), id).toBe(false);
    // ...but every shared + knight weapon is present.
    const expected = (Object.keys(WEAPON_REGISTRY) as WeaponId[]).filter((id) =>
      canClassUseWeapon("knight", id),
    );
    expect(new Set(usable)).toEqual(new Set(expected));
  });

  it("unions across the present classes", () => {
    const mixed = partyRollableWeaponIds(["knight", "mage"]);
    const staff = anyWeaponOfCategory("staff");
    const hammer = anyWeaponOfCategory("hammer");
    expect(mixed).toContain(staff); // mage brings staves
    expect(mixed).toContain(hammer); // knight brings hammers
  });

  it("treats an empty party as no restriction (returns everything)", () => {
    expect(partyRollableWeaponIds([]).length).toBe(Object.keys(WEAPON_REGISTRY).length);
  });
});
