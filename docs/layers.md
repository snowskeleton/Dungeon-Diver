# Interaction Layers — collision & combat design

Design spec for a single, data-driven layer system that governs **both** physical blocking
and combat hits. Replaces two ad-hoc mechanisms:

- **Physical blocking** — matter-js bodies, today filtered by `CAT` + a global `COLLIDE`
  toggle table (`server/src/physics/PhysicsWorld.ts`).
- **Combat hits** — hand-rolled per-pair loops in `GameRoom.tick()`
  (`player.tryHitEnemy(...)`, `proj.tryHit(...)`), where the projectile loop is **hardcoded
  to enemies** — the exact thing that can't express a boss projectile.

Both get unified under one **Layer** vocabulary. This is a spec, not built yet.

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

## The payoff: one resolver instead of N loops

Today `GameRoom.tick()` has separate hardcoded passes (player-melee→enemy, projectile→enemy,
and would need more for boss→player). Under this model they collapse into **one generic
interaction resolver**:

1. Collect **hit sources** this tick: melee swings, projectiles, AOE bursts, hazard tiles —
   each an `{ shape, affects, onHit(target), ownerId? }`.
2. Collect **targets**: any body/entity with `{ layer, shape, takeDamage() }`.
3. For each source × candidate target, fire `onHit` **only when `source.affects & target.layer`**
   (and shapes overlap, and it's not the source's own owner).

New content — boss projectiles, AOE, cuttable props, pickups, hazard tiles — is a new source
or target *profile*, never a new loop. The matter-js side mirrors this: per-body
`layer`/`solidMask` replaces the global `COLLIDE`/`maskFor`, so blocking is per-entity (the
corpse's `WALL`-only mask at `PhysicsWorld.ts:215` becomes just swapping to the corpse
profile).

---

## Migration sketch (when we build it)

1. Add `Layer` enum + an `InteractionProfile` type to `shared/`.
2. `PhysicsWorld`: replace `CAT`/`COLLIDE`/`maskFor` with `layer`/`solidMask` on each body;
   the H-overlay debug draw reads the same layers.
3. `Projectile`: carry `layer`/`affects`/`blockedBy`; sweep test filters by `affects & layer`;
   wall stop uses `blockedBy`.
4. Melee: player swings and (new) boss/enemy attacks become hit sources with an `affects` mask.
5. `GameRoom.tick()`: replace the per-pair loops with the single resolver.

This is the substrate the boss movesets in [bosses.md](bosses.md) sit on — item 2 there
("enemy-owned projectiles") *is* giving projectiles an `affects: PLAYER` profile.
