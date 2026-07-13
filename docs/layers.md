# Interaction Layers — collision & combat design

A single, data-driven layer system that governs **both** physical blocking and combat hits.
**Built** (this is no longer a spec) — it replaced two ad-hoc mechanisms:

- **Physical blocking** — matter-js bodies, once filtered by a `CAT` + global `COLLIDE`
  toggle table; now per-body `layer` / `solidMask` from each entity's `InteractionProfile`
  (`server/src/physics/PhysicsWorld.ts`, profiles in `shared/src/layers.ts`).
- **Combat hits** — once hand-rolled per-pair loops in `GameRoom.tick()`; now **one resolver**
  (`server/src/combat/CombatSystem`) over hit sources and targets.

Both are unified under one **Layer** vocabulary (`shared/src/layers.ts`).

---

## The model (Godot-style: layer + mask, directional)

Every interacting thing carries an **interaction profile** with up to three masks over one
shared set of layer bits:

| Field | Meaning | Feeds | Symmetry |
|---|---|---|---|
| `layer` | *what I am* (usually a single bit) | both systems | — |
| `solidMask` | *what physically stops / separates me* | matter-js `collisionFilter` | **symmetric** (blocking is mutual) |
| `affects` | *what my hitbox damages / triggers* | the combat overlap resolver | **directional** (Godot `collision_mask`) |
| `blockedBy` | *(projectiles only)* which layers stop my flight | Projectile integration / tile check | — |

**The core rule (directional):** a hit **source A affects target B iff `A.affects & B.layer ≠ 0`.**
Whether B also affects A is a *separate* question answered by B's own `affects`. This is what
lets a player's weapon cut the Enemy and Prop layers while enemies never touch Props, and
enemies affect the Player layer while player bodies affect nothing.

**Physical blocking stays symmetric,** matching matter-js: two bodies separate only when each
one's mask includes the other's layer (`(A.layer & B.solidMask) && (B.layer & A.solidMask)`).
`layer` → matter's `category`; `solidMask` → matter's `mask`.

### Godot mapping
`layer` = `collision_layer`, `affects` = `collision_mask`. Same idea: an object scans the
layers in its mask; it detects/affects anything sitting on one of those layers, regardless of
what that thing scans for.

---

## The layer set (forward-looking; unused bits are free)

```ts
// shared/ — one vocabulary for the whole game (client H-overlay reads it too)
export enum Layer {
  WALL          = 1 << 0,
  PLAYER        = 1 << 1,  // player bodies (hurtable)
  ENEMY         = 1 << 2,  // enemy / boss bodies (hurtable)
  PLAYER_ATTACK = 1 << 3,  // player melee swings + player projectiles
  ENEMY_ATTACK  = 1 << 4,  // boss projectiles, AOE, telegraphed strikes
  PROP          = 1 << 5,  // bushes / destructibles / breakables
  PICKUP        = 1 << 6,  // dropped items, hearts
  HAZARD        = 1 << 7,  // lingering fire / poison ground tiles
}
```

PROP / PICKUP / HAZARD have no features behind them yet; they're reserved so those features
land as pure data later, and so the vocabulary is stable now.

---

## Example profiles (every interaction is data, no hardcoded pairs)

| Thing | `layer` | `solidMask` (blocks against) | `affects` (damages / triggers) | `blockedBy` |
|---|---|---|---|---|
| Player body | `PLAYER` | `WALL \| ENEMY` | — | — |
| Contact enemy body | `ENEMY` | `WALL \| PLAYER \| ENEMY` | `PLAYER` | — |
| Boss body (no contact dmg) | `ENEMY` | `WALL \| PLAYER \| ENEMY` | — *(damage comes from its attacks, not its body)* | — |
| Dying corpse | `ENEMY` | `WALL` | — | — |
| Player arrow | `PLAYER_ATTACK` | — | `ENEMY \| PROP` | `WALL` |
| Fly-over player shot | `PLAYER_ATTACK` | — | `ENEMY \| PROP` | `0` (passes over walls) |
| Player melee swing | `PLAYER_ATTACK` | — | `ENEMY \| PROP` | — |
| Boss fireball | `ENEMY_ATTACK` | — | `PLAYER` | `WALL` |
| Boss AOE / shockwave | `ENEMY_ATTACK` | — | `PLAYER` | — |
| Bush | `PROP` | `WALL` *(or `0` if walkable)* | — | — |
| Fire hazard tile | `HAZARD` | — | `PLAYER` *(or `PLAYER \| ENEMY`)* | — |
| Dropped heart | `PICKUP` | — | `PLAYER` | — |

The requested behaviors fall straight out:
- **Boss projectile hits players, not enemies** → `affects: PLAYER`.
- **Player projectile spares players** → `affects: ENEMY | PROP` (no `PLAYER` bit).
- **Cutting bushes** → attacks list `PROP`; enemies don't, so they can't.
- **Fly-over vs stop-on-wall** → `blockedBy: WALL` or `0`.

### Friendly fire — a one-bit flip, by construction
Off now: player attacks use `affects: ENEMY | PROP`. Turning it on is adding the `PLAYER`
bit — `affects: ENEMY | PROP | PLAYER` — on whichever weapon/projectile (or via a debug/room
flag) should have it. Because `affects` is directional per-source data, this needs **zero**
changes elsewhere: no new loop, no special-case, no toggle plumbing. The system is "good"
precisely because this is a data edit, not a code change. (There's a subtlety when we get
there — a shot shouldn't hit *its own owner* the instant it spawns — handled by the existing
`ownerSessionId` self-exclusion, independent of layers.)

---

## The payoff: one resolver, no per-pair loops

`GameRoom.tick()` used to have separate hardcoded passes (player-melee→enemy, projectile→enemy,
and would have needed more for boss→player). They are now **one generic resolver**
(`server/src/combat/CombatSystem.resolve`):

1. Every entity queues its **hit sources** during its own tick — melee swings, projectiles, AOE
   bursts, boss channels — each a `HitSource` `{ shape, affects, attack, claim(targetId), ownerId? }`
   (`server/src/combat/HitSource.ts`). `GameRoom` drains them (`Entity.drainEffects`).
2. **Targets** are any `CombatTarget` (`{ state.x/y, hurtRadius, damageable, takeHit(attack) }`) —
   players and enemies, grouped by `layer`.
3. For each source × candidate target, deliver the `Attack` **only when `source.affects & target.layer`**,
   the shapes overlap, it isn't the source's own owner, and the source's `claim` allows it (per-source
   dedupe — once-per-swing, pierce, or a `RehitGate` for lingering hitboxes).

New content — boss projectiles, AOE, cuttable props, pickups, hazard tiles — is a new source or
target, never a new loop. The matter-js side mirrors this: per-body `layer`/`solidMask` replaces the
old global `COLLIDE`/`maskFor`, so blocking is per-entity (a corpse just swaps to a `WALL`-only mask
via `setEntityDead`).

---

## How it's built (map to the code)

1. `shared/src/layers.ts` — `Layer` enum, `InteractionProfile`, `canAffect`, and the per-team
   attack masks (`PLAYER_ATTACK_AFFECTS` / `ENEMY_ATTACK_AFFECTS`).
2. `shared/src/combat/` — the `Attack` value object + `HitShape` geometry (`shapeHitsPoint`).
3. `server/src/physics/PhysicsWorld.ts` — bodies carry `layer`/`solidMask` from their profile; the
   H-overlay debug draw reads the same layers.
4. `server/src/entities/Projectile.ts` — carries `affects`; its swept-ellipse `hitSource()` flows
   through the resolver like any other source.
5. `server/src/combat/CombatSystem.ts` — the single resolver; `Entity.takeHit(attack)` is the
   receiver (damage + knockback, shared by players and enemies).
6. Attacks are produced by the unified Spell system (`server/src/spells/`): a boss move, an enemy
   attack, or a player's weapon swing/shot all emit hit sources or projectiles through the same
   `Caster` interface. See [bosses.md](bosses.md), [weapons-and-ammo.md](weapons-and-ammo.md).

### Friendly fire, still a one-bit flip
`PLAYER_ATTACK_AFFECTS = ENEMY | PROP`. OR in `PLAYER` to let player attacks hit players — one
data edit, no new code, because `affects` is directional per-source data (the `ownerId`
self-exclusion keeps a shot from hitting its own caster).
