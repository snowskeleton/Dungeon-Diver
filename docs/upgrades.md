# Upgrades, weapon instances, and the attack pipeline

Read this before touching player stats, weapon modifiers, damage numbers, or the
reward pedestals. Three systems that landed together and only make sense together.

---

## 1. Weapon templates vs. weapon instances

`WEAPON_REGISTRY` holds one immutable `Weapon` per id. Those are **templates** —
shared by every player, every room, and every client, and nothing ever mutates them.

What a player actually carries is a `WeaponInstance`
([shared/src/weapons/instance.ts](../shared/src/weapons/instance.ts)): a reference to
a template, a `uid`, and its own `WeaponMod[]`. Two players holding "a broadsword"
can therefore be holding genuinely different weapons.

```
Weapon (template, shared)  ──referenced by──▶  WeaponInstance (per wielder)
  damage: 20                                     mods: [SharpMod(+2)]
  attackCooldownMs: 500                          damage → 22
```

- **Identity, visuals, geometry delegate** to the template (`id`, `name`, `fxType`,
  `iconPath`, `getHurtbox`). Only the numeric stats fold. That's why all 52 weapon
  modules were untouched by this and a rolled weapon still draws with the same icon
  and swings the same arc.
- **Duplicates are legal.** `Player.weapons` may hold two broadswords with different
  rolls; that's the point. Anything diffing weapons must key on `uid`, not `id`
  (see `LocalPlayer.checkAcquired`).
- **`Player.weapons`, not `inventory`.** Other item lists (consumables, key items,
  equipment) are expected to sit beside it as their own typed lists rather than one
  heterogeneous `Item[]`.

### The folding rule

```
stat = (base + Σflat) × (1 + Σpct)
```

All flats land before any percent, and percents **sum rather than compound**. This is
the only ordering where pickup order doesn't change the result — which matters in a
roguelite where the player can't choose their drop order. It also keeps stacking
legible ("+10% and +10% is +20%") and avoids late-floor compounding blowups.

**Cooldown is the exception.** A percent *reduction* has a singularity at 100%, so
cooldown folds as attack SPEED instead, floored at `MIN_ATTACK_COOLDOWN_MS`:

```
attackCooldownMs = (base + Σflat) / (1 + Σspeedpct)
```

+100% attack speed halves it, +200% thirds it, and it can never reach zero.

### Adding a weapon modifier

One class in [server/src/upgrades/weaponMods.ts](../server/src/upgrades/weaponMods.ts)
extending `WeaponMod`, overriding only the getters it touches, with a `label` for
display. Magnitude is a constructor argument so one class covers a whole tier of
rolls. `rollWeaponMod(floor)` picks one and scales it with depth.

---

## 2. The attack pipeline

Damage is no longer a literal anywhere. Every blow is assembled in four stages:

| # | Stage | Where | Produces |
|---|---|---|---|
| 1 | Template base | `Weapon` / `AmmoConfig` | raw numbers |
| 2 | Weapon instance mods | `WeaponInstance` getters | per-weapon stats |
| 3 | Caster scaling | `Caster.scaleAttack` | the `Attack` |
| 4 | Receiver mitigation | `Entity.takeHit` override | applied HP loss |

**`Caster.scaleAttack(base: AttackStats): AttackStats` is the single fold point for
outgoing damage.** `Entity` implements the identity, so enemies and bosses pass their
numbers straight through and are completely unaffected; **`Player` is the only
override in the game**. That one method is why an upgrade reaches every weapon,
ability, and shot at once without any spell builder knowing modifiers exist.

`buildAttack(base, sourceX, sourceY)` = `scaleAttack` + an origin. It's split that way
because a projectile needs the scaled numbers at the muzzle but its blow's *origin*
only at the moment of impact.

### Ranged shots

A projectile has no link back to the weapon that fired it or the player who drew it,
so scaling is resolved at the muzzle and rides along on `SpawnOpts.attack`.
`Projectile` stores it as `attackStats` and reads that in `hitSource()` instead of its
shared `AmmoConfig`. Omitted (enemy/boss shots) = the ammo's own numbers.

**A ranged weapon's `damage` is a flat bonus added to its ammo's damage.** This
changed when modifiers landed — otherwise a "+2 damage" roll would do nothing on a
bow. Most ranged weapons still declare `damage: 0`. See
[weapons-and-ammo.md](weapons-and-ammo.md).

### Damage dealt, not damage attempted

`takeHit` returns the damage **actually** applied (post-mitigation, post-overkill), and
`HitSource.onDealt` reports it back. That's what keeps lifesteal honest — hitting a
corpse or an invulnerable boss phase returns 0 and heals nothing.

### Where damage types will go (not built)

Add a `type` field to `AttackStats` and override `takeHit` on the enemies that resist
or are weak to it. Both seams already exist and are load-bearing today; nothing else
should need to change.

---

## 3. Upgrades

Behavioural content, so it follows the enemy/boss rules (see the engineering note in
[CLAUDE.md](../CLAUDE.md)): **one class per upgrade, stats as compiler-checked getters,
collected in a plain array. There is no UPGRADE_REGISTRY and no id→effect table.**

```ts
export class IronSkin extends Upgrade {
  readonly id = "iron-skin";
  readonly name = "Iron Skin";
  readonly description = "Ignore 2 damage from every hit.";
  override get armorFlat() { return 2; }
}
```

Every contribution defaults to zero, so a subclass overrides only what it affects and
a typo'd override is a compile error rather than a silently-ignored config key.

**To add one:** write the class in
[server/src/upgrades/stats.ts](../server/src/upgrades/stats.ts), add its id to the
`UpgradeId` union in [shared/src/upgrades.ts](../shared/src/upgrades.ts), and add one
line to `UPGRADES`. `assertUpgradesCoverAllIds()` runs at server boot and throws if
the union and the class list ever drift apart.

`minFloor` gates when an upgrade may be offered — floor scaling without a table.

### How the player folds them

`Player.recomputeStats()` folds over a **`StatContributor[]`**, not over `upgrades`
directly. Today that array is just the upgrades; worn equipment will join it without
the fold changing. It runs on add and on construction only — never per tick.

- **Armor** applies in a `Player.takeHit` override, floored at 1 damage so no amount
  of stacking makes a player untouchable. Knockback is deliberately *not* mitigated —
  being shoved is a positioning problem, not a damage one.
- **Lifesteal** applies in `onDamageDealt`, clamped to max HP.
- **A maxHp increase grants the delta to current health.** Preserving the percentage
  would heal a nearly-dead player almost nothing, making a +20 max HP pick feel worse
  than a plain heal at the exact moment it should feel good.

### Active abilities (not built)

`Upgrade.spell()` returns null today. Abilities are intended to live in this same
list rather than a parallel one — turning one on should be a subclass override plus an
input control, nothing structural.

---

## 4. Reward pedestals

`OfferState` in `GameState.offers`, keyed by room id. One at every shrine room's
center (shrines spawn no enemies and are pre-cleared, so it's reachable immediately),
plus one dropped where a boss dies — gated on `clearCheckDone` so it fires exactly
once and can't be farmed.

- **Shrine:** 1 weapon + 2 upgrades. **Boss:** 2 weapons + 1 upgrade, so beating a
  boss reads as loot rather than another stat bump.
- **The room pauses while the picker is open** (reusing the inventory menu's
  `setPause` handshake), unlike shops. A shop decision is reversible browsing; a
  1-of-3 is an irreversible modal choice, and the room is already cleared so pausing
  costs nothing tactically.
- **First player to claim it takes it.** `claimed` is the whole concurrency story, so
  a duplicated or racing message is harmless rather than a double-grant. Proximity is
  re-validated server-side; the client prompt is only a hint.
- **Shops roll no modifiers.** The pedestal cost formula derives from damage, so a
  good roll would cost *more*. Shops stay the predictable baseline; surprise is
  concentrated in reward tiers. Enabling rolls later means minting a `WeaponInstance`
  in `rollShopWeapons` and giving `ShopItemState` a stat block.

### The server-only `mods` field — read this before copying the pattern

`OfferChoiceState.mods` is a plain property with **no `@type` decorator**, so it never
serializes. This is deliberate and slightly subtle:

- The rolled `WeaponMod` objects must survive from floor generation until someone
  claims the pedestal, so they have to live *somewhere*.
- They can't be schema fields: a `WeaponMod`'s value is behaviour (getters), and
  `@type` holds only primitives and `Schema`s.
- Reconstructing one client-side from a synced tag would need an id→class map — the
  pattern this project forbids — and the client has no use for the object anyway,
  since the synced `weapon` slot already carries the resolved numbers it draws.

Keeping the real objects on the choice they belong to means claiming hands
`Player.addWeapon` the exact modifier that was rolled, so **the card cannot show stats
the reward won't have**. An earlier version used a parallel `Map` keyed by room id and
index-aligned with `choices`; the undecorated field removes the alignment entirely.

---

## 5. What crosses the wire

`PlayerState.weapons` is an `ArraySchema<WeaponSlotState>` carrying **resolved stats**
plus `modLabels` — never the modifier objects.

Two reasons, both load-bearing:

1. Syncing modifiers would require reconstructing `WeaponMod`/`Upgrade` subclasses
   from an id on the client — a lookup table, which CLAUDE.md rules out.
2. Two fold implementations (server for combat, client for display) is a divergence
   bug factory. The server folds once, authoritatively, and broadcasts numbers.

`viewFromSlot()` / `viewFromTemplate()` in
[shared/src/weapons/views.ts](../shared/src/weapons/views.ts) turn either a synced slot
or a bare template into the `WeaponView` that display code reads. They live in
`shared` rather than the client UI so the **server** can round-trip a slot through
`viewFromSlot` in its verify harness and prove the client sees exactly the numbers the
server computed.

`UpgradeSlotView` carries only `{id, name, description}` — descriptive strings the
client renders and computes nothing from.

---

## Verifying a change here

`server/src/verify-combat.ts` covers instance folding, the stale-spell-cache
regression, the pipeline, armor/lifesteal/maxHp, and the slot→view round-trip:

```bash
npx ts-node server/src/verify-combat.ts
```

**`server/src/verify-boss.ts` output must stay byte-identical** across any change to
the pipeline — that's the proof enemies and bosses are unaffected. Capture it before
you start:

```bash
npx ts-node server/src/verify-boss.ts > /tmp/boss-before.txt
# ...make the change...
npx ts-node server/src/verify-boss.ts | diff /tmp/boss-before.txt -
```

The reward-pedestal flow (spawning, proximity refusal, claim, double-claim no-op,
boss drop) needs a **running server** and is currently exercised by ad-hoc headless
Colyseus clients rather than a checked-in harness — worth promoting to a
`verify-offers.ts` if this area gets more work.

A useful shortcut while balancing: the Debug menu's **Starting upgrades** knob
(`DebugConfig.startingUpgrades`) grants upgrades on join, so you can test folding
without walking to a shrine.
