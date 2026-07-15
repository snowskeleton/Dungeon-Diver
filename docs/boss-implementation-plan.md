# Boss Implementation Plan

## Status (2026-07-11)

Foundation landed and verified headlessly (`server/src/verify-boss.ts` — drives the
real PhysicsWorld + Boss + Projectile for all 8 bosses):

- **Stage 0 — interaction layers: DONE.** `shared/src/layers.ts` (`Layer` enum,
  `InteractionProfile`, `canAffect`, body/projectile profiles). Physics migrated off
  `CAT`/`COLLIDE` to per-body `layer`/`solidMask`; behaviour-preserving.
- **Stage 1 — enemy-owned projectiles: DONE.** `Projectile` carries an `affects`
  mask; one `GameRoom` loop resolves both teams (player shots hit enemies/props,
  boss shots hit players). New `fireball` + `magic-orb` ammo (art extracted from the
  FX pack). Verified: boss shots damage players, spare enemies.
- **Stage 2 — telegraphs + Boss AI: DONE (baseline).** `server/src/entities/Boss.ts`:
  wind-up → strike → recovery loop, per-ability cooldowns, range-keeping, knockback
  cancels a wind-up. `EnemyState.telegraph`/`abilityId` synced; client pulses the
  sprite red during the tell (`EnemyEntity`). Every boss instantiates as `Boss`.
- **Per-boss kits: PARTIAL.** Each of the 8 bosses has a *distinct projectile kit*
  (`BOSS_KITS` in Boss.ts) — breath cones, orb barrages/sprays, single lances/boulders
  — so all attacks work and read differently. Their **signature non-projectile moves
  are still TODO** (marked per boss in Boss.ts): Centaur gallop/club, Big Beast
  roll/slam, Turtle shell-spin/tremor, Batwing buttstomp, Tengu teleport/summon,
  Wyvern element differentiation (poison/lightning).
- **Stage 5 — bestiary data: DONE (model + boss text).** `EnemyConfig.lore` +
  `abilities` added; all 8 boss configs populated. Book **UI still TODO**.

**Not yet built** (the primitives the remaining signatures need): dash/charge movement
with a contact hitbox + wall-stun, point-radius/ring AOE, airborne/untargetable state +
ground marker, summon hook + invuln flag, lingering hazard tiles. Phases (HP thresholds)
also not wired yet. These are Stages 3–4 below.

**Note:** the in-app preview browser stalls Phaser's async `create()` on scene start
(pre-existing), so verification was headless. A real playtest (telegraph feel, dodge
timing, damage tuning) is the natural next step and wants a human at the controls.

---

Build order for the boss system. Grounded in the two design docs:
- [layers.md](layers.md) — the interaction-layer substrate (build first, everything sits on it)
- [bosses.md](bosses.md) — the per-boss movesets this plan realizes

Guiding rule: **land the foundation, prove it end-to-end with the simplest real case, then
scale by data.** Each stage below ends in a testable state — don't start the next until the
current one is verified in the running game.

---

## Stage 0 — Interaction layers (the substrate)

Nothing boss-specific works well until combat hits stop being hardcoded per-pair loops. Do
this first even though no boss is visible yet.

1. **`shared/`** — add the `Layer` enum and an `InteractionProfile` type
   (`layer` / `solidMask` / `affects` / `blockedBy`). See [layers.md](layers.md) for the set.
2. **`PhysicsWorld.ts`** — replace `CAT` / `COLLIDE` / `maskFor` with per-body
   `layer` + `solidMask`. Bodies take a profile at creation; the dying-corpse path
   (`PhysicsWorld.ts:215`) becomes "swap to the corpse profile" instead of poking
   `collisionFilter.mask`. Keep the H-overlay reading the same layers.
3. **Single interaction resolver** — introduce the source/target abstraction in `GameRoom`:
   - *sources* = `{ shape, affects, ownerId?, onHit(target) }`
   - *targets* = entities exposing `{ layer, shape, takeDamage() }`
   - fire `onHit` iff `source.affects & target.layer` **and** shapes overlap **and**
     target isn't the source's own owner.
4. **Migrate the existing loops** onto the resolver: player melee (`player.tryHitEnemy`) and
   player projectiles (`proj.tryHit`) become sources with `affects: ENEMY | PROP`.

**Checkpoint:** existing gameplay is byte-for-byte unchanged — players still hit enemies with
melee and arrows, walls still block, corpses still don't shove. This stage is a pure
refactor; if anything *feels* different, it regressed.

---

## Stage 1 — Enemy-owned projectiles

The single capability that unlocks 6 of 8 bosses.

1. **`Projectile`** — already carries `ownerSessionId`; give it a full profile so a shot
   declares `layer` / `affects` / `blockedBy`. Its sweep test filters by `affects & layer`;
   wall despawn keys off `blockedBy` (so "flies over walls" is just `blockedBy: 0`).
2. **`GameRoom` projectile pass** — currently loops projectiles × **enemies** only. Route it
   through the Stage-0 resolver so a projectile with `affects: PLAYER` hits players and one
   with `affects: ENEMY` hits enemies, from the same code.
3. **Spawn API for enemies** — a `GameRoom` hook an enemy/boss can call to emit a projectile
   (mirrors the player ranged-fire path at `GameRoom.tick()` step 3b), stamped with the
   `ENEMY_ATTACK` profile.
4. **First ammo**: one boss projectile type (fireball) in `shared/src/ammo/` reusing the
   `AMMO_REGISTRY` pattern, plus its client `ProjectileEntity` visual + FX.

**Checkpoint:** a temporary debug enemy that fires a fireball on a timer damages a player and
is stopped by walls; a player arrow still ignores other players. Friendly fire is verifiably a
one-bit change (flip it on a test weapon, confirm, flip it back).

---

## Stage 2 — Telegraph primitives + Boss AI scaffold

Now the boss brain, still with no specific boss.

1. **Telegraph system** — a scheduler for the **wind-up → strike → recovery** beat: a source
   can be declared "pending" (draws its danger indicator: line / growing ground marker /
   cast ring — see the telegraph vocabulary in [bosses.md](bosses.md)) and only becomes a
   live hit source after its wind-up elapses. Client renders indicators from synced state.
2. **`Boss` entity** — a new `Enemy` subclass (or an ability-driver composed into it) that
   replaces the Goo touch-attack for bosses: a weighted/scripted **ability picker** with
   per-ability cooldowns, explicit wind-up/strike/recovery timing, and optional
   **HP-threshold phase switches** (per-boss, per [bosses.md](bosses.md)'s phase table).
3. **Ability interface** — one shape every boss move implements (telegraph shape + duration,
   strike effect [projectile / AOE / dash / summon], recovery window, cooldown). Bosses are
   then a *list of abilities + a phase policy*, not bespoke code.
4. **Schema** — extend `EnemyState` with what clients need to render telegraphs and special
   states (current ability id / phase via `telegraph`/`channeling`/`abilityId`; `airHeight`
   for flyers — now shipped with the wyvern swoop, see Stage 4).

**Checkpoint:** a stub boss with one telegraphed ranged attack shows a readable wind-up, hits
only on the strike frame, and is punishable during recovery. A perfect player takes zero
damage from it.

---

## Stage 3 — First real boss: Centaur Knight (proof of the model)

Chosen because its kit — **Lance Throw (projectile), Gallop Charge (dash), Club Sweep
(melee arc)** — exercises the most shared tech with the least *new* tech (no airborne, no
AOE rings). See its section in [bosses.md](bosses.md).

1. **Dash / charge movement mode** — an active contact hitbox during a committed straight-line
   move, with **wall-stun-on-impact** (the punish window). Reused later by turtle spin, beast
   roll, thunder dash.
2. **Melee arc source** — a boss-side swing hitbox (`affects: PLAYER`); reuses the swing FX
   path from the player attack system.
3. **Wire Centaur's abilities** into the Stage-2 ability list; tune telegraph lengths so the
   fight is fully dodgeable, then add its Phase 2 (charge feint / lance rain) via the phase
   policy.
4. **Client** — animate the sheet's club/lance/gallop rows (already mapped in
   `client/src/enemies/index.ts`) to the ability states.

**Checkpoint:** a start-to-finish Centaur Knight fight in a debug boss room that a skilled
player can no-hit. This validates the whole stack; every later boss is now mostly data + FX.

---

## Stage 4 — Remaining bosses, easiest-first

Each adds at most one new primitive, then becomes an ability list + FX:

| Order | Boss | New primitive it needs |
|---|---|---|
| 1 | **Turtle Dragon** | ricochet dash variant + cardinal line-hazards (reuses Stage-3 dash) |
| 2 | **Big Beast** | slow-homing roll + radial shockwave ring (first AOE ring) |
| 3 | **Fire / Green / Grey Wyvern** | **airborne height + shadow** and the **diving swoop** ✅ shipped (see [enemies.md](enemies.md) → Flying enemies, and `swoop()`); still needs lingering **hazard tiles** (fire/poison) + cone telegraph; 3 recolors differ by element data |
| 4 | **Tengu Mask** | **summon** hook into the spawner + **invulnerability** flag (Stoneface); teleport reuses `Entity.teleport()` |
| 5 | **Batwing Buttstomper** | airborne height already exists (Wyvern) — needs **untargetability** while high + a tracking ground-marker (Buttstomp), orb-spread |

Point-radius/ring AOE (introduced with Big Beast) is reused by Buttstomp, Tengu lightning
pillars, and Beast/Turtle slams. Hazard tiles (Wyverns) reuse the `HAZARD` layer from Stage 0.

---

## Stage 5 — Bestiary

1. **`shared/`** — add `lore?: string` and `abilities?: { name; desc }[]` to `EnemyConfig`;
   fill them per boss in `shared/src/enemies/<Name>.ts` from the write-ups in
   [bosses.md](bosses.md). (Small enemies can get entries too, incrementally.)
2. **Book UI** — reads `ENEMY_REGISTRY` (stats + lore + abilities) and
   `CLIENT_ENEMY_REGISTRY` (name + sprite) to render a page per enemy. No separate content
   file; design lives next to the numbers.

---

## Dependency summary

```
Stage 0 (layers) ──┬─> Stage 1 (enemy projectiles) ──> Stage 2 (telegraphs + Boss AI) ──> Stage 3 (Centaur) ──> Stage 4 (rest)
                   └─> (matter-js per-body profiles)
Stage 5 (bestiary) is independent of 1–4 and can slot in any time after Stage 0's shared-type work.
```

Balance for every boss lands in its `shared/src/enemies/<Name>.ts` (replacing the
`PLACEHOLDER_BOSS_CONFIG` spread) plus its ability list — consistent with the data-driven
registry pattern in [CLAUDE.md](../CLAUDE.md).
