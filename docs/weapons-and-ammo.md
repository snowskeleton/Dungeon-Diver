# Weapons, ammo & projectiles

Read this before touching weapons, attack FX, ammo, or projectiles.

A weapon's attack FX type comes from the weapon itself — `WEAPON_REGISTRY[weaponId].fxType` (`shared/src/weapons/base.ts`). There is no per-class FX mapping.

> **Templates vs. instances.** Everything in this doc describes a weapon **template** —
> the immutable, shared `Weapon` in `WEAPON_REGISTRY`. What a player actually *wields*
> is a `WeaponInstance` wrapping that template with its own modifiers, so its damage /
> cooldown / knockback may differ from the numbers here. Visuals and hurtbox geometry
> delegate straight through, so nothing in this doc changes because of it. Before
> touching damage numbers or adding a modifier, read [upgrades.md](upgrades.md).

## Attack FX (melee: one-shot rotated strips)

Attacks render as short FX strips layered over the character, not as a persistent weapon sprite — see `client/src/entities/AttackFXSprites.ts`:

- Each FX type (`slash`, `long-slash`, `stab`, `long-stab`) is a **right-facing 4-frame strip** played once at 14 fps. Frame sizes: slash=48×48, long-slash=64×48, stab=64×48, long-stab=96×48.
- The FX sprite's origin is anchored at the character body position within each cell (24px from the cell's top-left, matching the asset pack's template sheets) — so placing the sprite at the entity center aligns every frame automatically. The wide strips (long-slash, long-stab) extend rightward from that anchor; facing rotation pivots around it.
- `Entity.setupCharacter()` picks the FX from the weapon config and creates one hidden FX sprite and one weapon-icon image per entity. On the rising edge of an attack, `playAttackFX()` places both and plays the clip. The weapon icon follows per-frame `ICON_KEYFRAMES` (decoded from the template sheets — position and angle relative to the body, per FX type and frame index), driven by `ANIMATION_UPDATE` events. Both track the entity's position each frame via `syncAttackFX()`, called from `syncSpritePosition()`.
- Adding a new FX = drop the strip PNG in `assets/`, run `npm run assets:build`, add an entry to `FX_CONFIG` (key, file, frame size, frame count), and add per-frame `ICON_KEYFRAMES`.

**This melee path is only one of three attack render modes.** `setupCharacter()` branches on the weapon's `rangedStyle`:
- melee (no `rangedStyle`) → FX strip + icon, above
- **`"held"`** (bows, crossbows) → a bow-draw sprite instead (`RangedWeaponFX.ts`)
- **`"thrown"`** (knives, stars, boomerangs) → *no* in-hand sprite at all; the flying projectile is the whole visual

## Two data registries, mirrored folder layout

Ranged weapons live in `shared/src/weapons/` (categories `bows`, `crossbows`, `thrown`); their *projectiles* live in a parallel **`shared/src/ammo/`** registry structured the same way. An `Ammo` base class in `ammo/base.ts` derives `spritePath` (like `Weapon` derives `iconPath`), and `ammo/index.ts` aggregates `AMMO_REGISTRY` + the `AmmoId` union.

Ammo that shares a **behaviour bundle** is grouped under a category folder with its own base subclass:
- `ammo/arrows/` (`Arrow`: `spriteAngle -90`, single-target, wall-despawn defaults)
- `ammo/boomerangs/` (`Boomerang`: the spin + `ignoresWalls` + high-pierce bundle; `returnsAtMs` auto-derives to half the lifetime unless overridden)

One-offs that share no behaviour (`throwing-knife` points, `throwing-star` spins) sit **flat** at `ammo/<id>/`. Category ammo derives `spritePath` as `/sprites/ammo/<category>/<id>/<id>.png`; flat ammo omits the category segment. `sync-to-client.js` copies **both** `weapons/` and `ammo/` trees into `client/public/sprites/` (one generalized `copyTree`, looped over `["weapons","ammo"]`).

A ranged weapon just carries an `ammoId`; firing looks the projectile up in `AMMO_REGISTRY`. This is why "fire a sword" is trivial — add an ammo entry pointing at any sprite.

## Field reference

**Weapon fields that make a weapon ranged** (`shared/src/weapons/base.ts`):
- `ammoId?: string` — set = ranged. `weapon.isRanged` is just `ammoId !== undefined`. Ranged weapons pass `getHurtbox: () => null` (no melee) via their category `base.ts` defaults.
- `rangedStyle?: "held" | "thrown"` — client render mode (above).
- `fxType` — the melee FX strip key.

**Ammo fields** (`AmmoConfig`): `damage`, `speed` (px/s), `pierce` (enemies hit before despawn), `knockback`, `lifetimeMs`, `hitRadiusForward`/`hitRadiusSide` (the hit ellipse's reach *along* travel and half-width *across* it — equal values = a plain circle; arrows are narrow-forward/wide-side so you can miss to the side without the arrow reaching enemies any sooner ahead), `spriteAngle` (art's native pointing angle — arrows point up, so `-90`), plus three optional behaviours:
- `spinDegPerSec` (>0 = spin in flight instead of pointing along travel — thrown stars/boomerangs spin, arrows/knives point)
- `returnsAtMs` (velocity reverses once at this age — boomerang out-and-back; the hit list clears on the turn so it can re-hit returning)
- `ignoresWalls` (don't despawn on wall tiles — boomerang)

## Server flow

Attacks are `Spell`s now (`server/src/spells`). A weapon becomes a `Spell` via `weaponSpell()`: a melee weapon → a zero-wind-up swing whose active phase emits the weapon's hurtbox; a ranged weapon → a shot that spawns its ammo on the strike frame (staves included — each staff fires its own elemental bolt from `ammo/bolts`, rendered with `rangedStyle: "cast"`); a weapon carrying an `aoe` spec → a wind-up + AOE nova (supported, but unused by any weapon today — reserved for the Mage's nova ability). `Player.applyInput()` drives a `SpellCaster` running the active weapon's spell (rising-edge for `fireMode: "press"`, held for `"hold"`), aiming by facing. A ranged spell calls `caster.spawnProjectile(...)`, which queues a spawn on the entity's effect buffer; `GameRoom.tick()` drains it into a real `Projectile` (`server/src/entities/Projectile.ts`) stamped with the player's team mask + owner. Each projectile ticks (manual integration — **not** a matter-js body) and exposes a `hitSource()` (swept ellipse) to the one combat resolver, which applies ammo damage + knockback (pushed along travel via `prevX/prevY`); it despawns on wall/lifetime/pierce-exhausted. Projectiles clear on floor change. State syncs via `GameState.projectiles` (`MapSchema<ProjectileState>`: `x, y, angle, ammoId, ownerSessionId`).

### Swept hit test — don't revert to a point-at-endpoint check

(the `sweptEllipse` shape in `shared/src/combat/shapes.ts`, built by `Projectile.hitSource()`) A fast arrow (speed 500 → ~25px/server tick) with a ~10px forward radius will *tunnel* straight through an enemy sitting in the gap between two per-tick sample points if you only test the projectile's current position. The shape therefore tests the target against the whole segment travelled this tick (`prevX/prevY → state.x/y`) in the projectile's travel frame — `along` down the flight line vs the ellipse's forward half-width, `perp` across vs `hitRadiusSide`. This is speed-independent; the visible "arrow passes through enemy" bug was exactly this tunnelling.

(The **H** debug overlay draws the *instantaneous* ellipse at the lerped sprite position, so on a hit frame the drawn ellipse can look slightly past the enemy even though the sweep caught it — cosmetic, the damage is correct.)

## Client flow

`GameScene.setupWorldSync()` wires `state.projectiles.onAdd/onChange/onRemove` to `ProjectileEntity` (`client/src/entities/ProjectileEntity.ts`) — a lightweight non-`Entity` sprite (no HP bar) that lerps to the server position and either points along `angle` (using the ammo's `spriteAngle`) or spins (`spinDegPerSec`). Ammo sprites preload in `GameScene.preload()` keyed by ammo id.

The **held-bow draw** is a separate concern (`RangedWeaponFX.ts`): a 2-frame draw sheet (frame 0 relaxed / 1 drawn) played `0→1→0→0` beside the player, rotated toward the fire direction, anchored to the player each frame like the melee FX. Thrown weapons render nothing in-hand.

## Adding a weapon

- **Melee**: `shared/src/weapons/<category>/<id>/index.ts` (`export default new <Category>({ id, name, … })`) + `<id>.png` icon → register in `weapons/index.ts` (`ALL_WEAPONS` + the category `…Id` union) → `node assets/sync-to-client.js`. `GameScene` preloads the icon and the melee FX from the registry automatically.
- **Ranged**: same, but the weapon carries `ammoId` + `rangedStyle`, and you also add an ammo entry — under `ammo/arrows/` or `ammo/boomerangs/` if it fits that behaviour bundle (use the `Arrow`/`Boomerang` base and override only the per-variant stats), else flat at `ammo/<id>/` with `new Ammo({…})`. Register both in their `index.ts` aggregates (+ union types), then `node assets/sync-to-client.js`. No new client wiring — `GameScene` iterates the registries.

Bow/crossbow icon PNGs are 2-frame draw sheets (64×32); thrown-weapon icons are single-frame and double as the projectile art (same PNG copied into both `weapons/thrown/<id>/` and the ammo folder).

Once registered, a weapon automatically becomes **buyable in shops** and works in the **inventory/switching** system (both roll/read straight from `WEAPON_REGISTRY`) — see [loadout.md](loadout.md). Nothing extra to wire.

## Balance

- **Weapon** → the weapon's `shared/src/weapons/<category>/<id>/index.ts` (or the category `base.ts` defaults). For ranged weapons the weapon controls fire rate (`attackCooldownMs`), which `ammoId`, and a flat `damage` bonus **added to the ammo's damage** at the muzzle — that bonus is what lets a per-weapon modifier matter on a bow. Speed/pierce/knockback live on the ammo. Most ranged weapons leave `damage: 0`.
- **Ammo/projectile** → `shared/src/ammo/<id>/index.ts`: the `AmmoConfig` fields above.

## Sprite provenance (asset pack)

Bow/crossbow draw frames come from `Weapons.png` row 5 (16px cells, scaled ×2 → 32px; shortbow cols 0/1, longbow 2/3, crossbow 5/4 = empty→loaded). Arrows + throwables come from `Tools.png` row 1 (arrows cols 7–12; boomerangs 0/1 + 2/3; star 4/5; knife 6; the last two are torches, unused). Re-extract from those sheets, never from prior output.

`assets/weapon-icons.png` is the source sheet for `assets/generate-weapons.js`, which splits it into per-weapon PNGs + TypeScript definition files under `shared/src/weapons/<category>/<id>/`.
