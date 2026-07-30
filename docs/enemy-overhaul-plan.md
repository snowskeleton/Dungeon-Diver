# Enemy Overhaul Plan

The next big push: fewer enemies, less samey, attacks that read. Right now most
rabble is a functional placeholder — default chase + passive contact-touch damage,
no telegraph. This plan cuts the filler, keeps a tighter roster, and gives the
survivors real, readable attacks.

Status: **PLANNING ONLY — nothing implemented yet.**

## 1. Roster changes

### Cut entirely (remove class, client def, `EnemyType` id, art wiring)

| Enemy | ids | Why |
|---|---|---|
| Swarms | `swarm-1`, `swarm-2`, `swarm-3` | Little dot things — not interesting or cool |
| Rat | `rat` | Cut |
| Kultist | `kultist` | Cut |
| Frog-flower (black) | `frog-flower-black` | Keep only green for now; black may return later |
| Float-skulls | `float-skull`, `float-skull-teal`, `float-skull-pink` | Cut ("floatskull") |
| Float-eye | `float-eye` | Cut ("floateye") |
| Gold eyebat | `gold-eye` | Keep only the dark eyebat for now |
| Bones-blader | `bones-blader` | Cut ("bonesblader") |
| Plain bats | `bat`, `brown-bat` | Cut both; keep only the dark eye-bat as the flyer |
| Plain beast | `beast` | Cut; keep only the weapon beasts |
| Hood-fang | `hood-fang` | Keep only `fang` as "the snake" |

**Removal touch-list per id** (mechanical, done once per id):
1. `shared/src/enemies/base.ts` — drop from the `EnemyType` union.
2. `server/src/entities/enemies/index.ts` — drop from `REGULAR_ENEMIES` + its import.
3. `server/src/entities/enemies/<group>.ts` — delete the class.
4. `client/src/enemies/index.ts` — drop from `CLIENT_ENEMY_REGISTRY` + import.
5. `client/src/enemies/<group>.ts` — delete the visual def.
6. `client/src/enemies/spriteGeometry.ts` — drop its geometry entry.
7. Regenerate hurt bounds: `npm run assets:hurtboxes` (the generated
   `hurtBounds.generated.ts` is keyed by `EnemyType`, so a dropped id must leave it).

The `Record<EnemyType, …>` annotations make every one of these a compile error if
missed — the compiler is the checklist.

### Roster after the cut

goo-green/blue/gold · eye-bat · smushroom · spider · frog-flower · bones ·
armor-lancer · axe-beast · mace-beast · sword-beast · fang

15 ids down from 30 — half the pool cut. `eye-bat` is the only flyer left;
`fang` is the only snake.

## 2. Behaviour changes

All new attacks go through the existing `Spell` + `SpellCaster` system — the same
path bosses use. An enemy gets a `SpellCaster`, one or more `Spell`s, and drives
them from `tick()`. Builders already in `server/src/spells/builders.ts`: `swoop`
(dive), `dashAttack`, `novaBurst` (radial AOE), `whirl`, etc.

### Smushroom — AOE cloud (walk-up + on-death)

- Walks up to the player (default chase) and releases a lingering AOE **cloud**
  it tries to catch you in.
- **On death, releases the cloud too** — a parting gift. Same cloud both ways.
- **Cloud only — no passive contact/touch damage.** All damage is the AOE cloud
  (turn off `contactHitSource` via `attackDamage <= 0`).
- **Cloud lifetime (both cases the same):** stays at full for **2s**, then fades
  out and is **fully clear by 6s**. While it exists it **ticks damage every 0.5s**
  to any player still standing in it — leaving the cloud stops the damage.
- Build: this is a **lingering ground-hazard AOE**, not the single-strike
  `novaBurst`. Needs a persistent hazard entity/projectile with `lifetimeMs ≈ 6000`
  and a **re-hit gate on a 500ms interval** (the resolver's `RehitGate` already
  does per-target interval re-hits — reuse that rather than inventing timing).
  Fade is visual; the damaging radius can stay constant until it expires, or shrink
  with the fade — decide with the art.
- The death cloud needs a **new seam**: `Enemy` has no death-triggered spell hook
  today. Cleanest add is an optional `onDeath()` hook on `Enemy` (called from
  `takeDamage` when health hits 0) that spawns the same hazard. OO — a method the
  class overrides, not a config flag.

### Frog-flower (green only) — wind-up leap attack

- **Movement:** actually hop around, not glide. Behaviour: move in discrete hops
  rather than continuous chase. **Reuses existing frog-flower art** — no new art.
- **Attack:** wind up a jump — telegraph is *leaning down / crouching* for a big
  jump — then leap onto the player.
- **Damage only on the jump-slam.** No passive contact damage during normal
  touching. Set `attackDamage`-based `contactHitSource` off (return 0/null) and put
  all damage in the leap `Spell`'s active phase.
- Build: a leap/pounce `Spell`. Closest existing builder is `swoop` (rise → fall
  onto locked aim point) but that's for a flyer; frog is grounded. Likely a **new
  `leap`/`pounce` builder** (crouch wind-up → arc up and land on the aim point,
  contact hitbox only on landing). Reuses the swoop height-driving idea inverted.

### Eye-bat (dark only) — dive attack + spiral movement

- **Movement:** move in a more circular / spiraling pattern (not a straight
  beeline). Override the chase/patrol path to orbit-and-approach.
- **Attack:** dive at the player. **Damage only while dive-attacking**, like the
  frog — no passive contact damage.
- Build: `swoop` builder already exists and is exactly this (it's a flyer with
  `cruiseHeight`). Turn off contact damage; damage lives in the dive.

### Weapon beasts (sword / axe / mace) — real swing animation + wind-up

- Currently default contact-touch. Give each a proper **weapon-swing attack** with
  a **wind-up**, using the simple slash FX:
  `Super Overhead Adventure 2/Characters/Humanoid/Attack FX/Template/Simple Slash Generic (Effect Only).png`
  (needs importing into `assets/`, then `npm run assets:build`; the slash FX strip
  slots into the same per-facing FX approach the player weapons use).
- Build: a melee swing `Spell` with a wind-up phase and an active arc. These are
  directional enemies, so the FX rotates per facing.

### Armor-lancer — give it a lance

- Equip it with the **lance** from our weapon collection
  (`shared/src/weapons/spears/lance`). Attack should read as a lance thrust
  (spear reach), with a wind-up.

## 3. Repurpose player skins → enemies + remove skins

The humanoid **character skins** (`CHARACTER_TYPES` in
`shared/src/characters/base.ts`) are separate from the enemy roster. Two changes:

### Repurpose skeleton + skeleton-mage as enemies

- `skeleton` and `skeleton-mage` stop being playable skins and become **enemies**.
  Assumption: they leave the player skin roster entirely (they're being
  *repurposed*, not duplicated) — flag if you actually want them kept as both.
- **Skeleton** → wields a **broadsword** (`swords/broadsword`), swings it with a
  wind-up. Same pattern as the weapon beasts.
- **Skeleton-mage** → wields a **staff** he can **shoot** players with (a staff
  bolt `Spell` / `weaponSpell`, like the Mage's staff). First ranged rank-and-file
  enemy.
- **New pattern to solve:** these are the **first enemies drawn from the humanoid
  15×4 sheet** (players' sprite path), not the simple enemy sheet factories. Need
  to decide whether an enemy can reuse `HumanoidSprites` + `WeaponVisuals`
  (client player infra) or gets its own enemy visual def. This is the biggest open
  design question in the overhaul.

### Remove player skins entirely

From `CHARACTER_TYPES` (compiler then forces the client
`CLIENT_CHARACTER_VISUAL_REGISTRY` and picker to drop them):
`guy-blue`, `gal-green`, `the-fool`, `reptile`, `kobold`, `scaleless`.

Remaining playable skins: `guy`, `gal`, `colt`, `gigante` (+ whatever we decide
about skeleton/skeleton-mage if not fully repurposed).

## 4. Use the humanoid sheets more fully

Every humanoid PNG is 15 cols × 4 rows (60 frames; rows = Up/Right/Down/Left).
Column layout and current usage:

| Cols | Content | Status |
|---|---|---|
| 0–3 | Idle | Used — loop @6fps |
| 4–7 | Walk | Used — loop @8fps |
| 8–11 | Attack | Used — one-shot @12fps; wind-up/charge holds frame 8 |
| 12 | Stunned | **Under-used** — only a 1-frame hurt flash on taking a hit |
| 13 | Burned | **Never used** |
| 14 | Bleeding | **Never used** |

Wiring is in `client/src/entities/HumanoidSprites.ts` (`defineHumanoidAnimations`
+ `makeHumanoidSpriteConfig`). `resolveAnim` only maps idle/walk/attack; `hurtAnim`
maps col 12. Cols 13 & 14 are never referenced.

**The gap = a status-effect pose vocabulary the sheets ship but we never wired up.**
It lines up exactly with the Floor 5.5 status-effects item (poison/burn/slow/…):

- **Burned (13)** → hold/flash while on fire (burning tile, fire-element buff).
- **Bleeding (14)** → the bleed/poison status pose.
- **Stunned (12)** → *hold* it for the whole knockback stun (`state.stunned` is
  already synced), not just the momentary hit-flash — gives stun a real read for
  players **and** the repurposed skeleton enemies.

Doing this is essentially "build the status-effect visuals" — the frames already
exist for every skin. Both the humanoid path and, once skeleton/skeleton-mage are
on it, the enemies get these poses for free.

Note: the attack row (8–11) is used but **visually masked** — the body's 4 swing
frames play under the weapon FX + `WeaponVisuals`, so the body arm-swing barely
reads. The skeleton-mage's ranged staff cast reuses those same 4 frames as a cast
pose (differentiated by the projectile/staff FX, not the body).

## 5. Art needed (flagged, not blocking)

- **Snake (fang):** needs all-new art of it **lashing out with its fangs** — the
  only enemy in this pass that needs genuinely new art. Added to the roadmap
  (Floor 5.5 art note).
- **Smushroom:** needs the **AOE cloud** art + a matching **creature animation**
  for releasing it. Added to the roadmap.
- Frog-flower, eye-bat dive, and the beast/lancer swings reuse existing frames
  (+ the imported Simple Slash FX strip) — no new art.

## 6. Sequencing / status

- [x] **1. Roster cut** — DONE (commit: cut half the rabble roster). Compiler-guided
  deletion; hurt bounds regenerated; flyer tests moved Bat→EyeBat.
- [x] **2. Skin removal** — DONE. 6 skins dropped from `CHARACTER_TYPES`;
  skeleton/skeleton-mage kept (excluded from the picker) for the enemy path; the
  hurtbox generator now sources its skin list from `CHARACTER_TYPES`.
- [x] **3. Armored/weapon enemies (lancer + beasts)** — DONE. New `ArmedEnemy`
  base (`server/src/entities/enemies/armed.ts`): wields a real `WeaponInstance`,
  swings it via `weaponSpell` with a wind-up, no passive contact damage. Reuses the
  boss telegraph/channeling schema fields so the client's wind-up tint reads it with
  no new client code. Tests in `tests/server/armed-enemy.test.ts`.
  - Follow-up polish (not blocking): a proper swing **slash-FX overlay** on the
    enemy sprite (import the Simple Slash FX strip) — right now the read is the
    telegraph tint, which ships but isn't the swung-blade FX the plan described.

### Remaining — DONE (2026-07-30 pass)

Resolved differently from the guesses above, per the user's steer (abstract/share, don't
copy-paste; keep the cloud attached):

- [x] **4. Eye-bat dive + spiral movement.** Lifted the shared wall-reflection out of
  `Boss.dashStep` into `entities/dashMovement.reflectHeading`; `Enemy.dashStep` now
  drives its DYNAMIC body via `driveAlong`, so a rank-and-file `Enemy` is a
  FlightCaster and reuses `swoop`. Spiral = tangential + inward approach. Contact off.
- [x] **5. Frog-flower leap + hop.** New `leap` builder (crouch → arc via
  `setAirHeight`+`dashStep` → slam-only damage). Discrete-hop locomotion. Contact off.
  Client frog def marked `airborne` so airHeight renders the arc.
- [x] **6. Smushroom cloud.** Kept ATTACHED (user steer): a caster-anchored
  `lingeringCloud` spell (6s, 0.5s re-hit) it drags onto you and re-fires on death via
  a new `Enemy.onDeath()` hook + `Enemy.deathTick()` (GameRoom runs death effects while
  the corpse lingers — enemies never despawn until floor advance anyway). Contact off.
  Placeholder client circle fading 2→6s. **Real gas art still needed.**
- [x] **7. Skeleton + skeleton-mage enemies.** First humanoid-sheet enemies. Backed by
  the `HUMANOID_SKINS` (sheet identity) vs `PLAYER_SKINS` (playable subset) split that
  retired the `CHARACTER_TYPES`/`NON_PLAYER_SKINS` kludge. Both hold a real catalog
  weapon via the client `heldWeapon` path (broadsword / oak-staff); mage is the first
  ranged rabble. `makeHumanoidEnemyDef` builds clips from `HumanoidSprites`.
- [x] **(new) 8. Fang lunge.** Coils then LUNGES via `dashAttack` (contact off).
  Placeholder — reuses the move frames; **dedicated fang-lash art still needed.**

Cross-cutting from this pass: a shared `CastingEnemy` base (SpellCaster + syncCastState
+ interrupt-on-stun-OR-knockback) that every behaviour enemy subclasses; armed enemies
+ skeletons hold & swing their weapon client-side (the swing is the telegraph, so rabble
dropped the generic red tint — it's now only a fallback for creatures without their own
tell). Roadmap item added: derive every content-id union from its class array.

## 7. New architectural seams this introduces

- `Enemy.onDeath()` hook (for the smushroom death cloud) — an overridable method,
  called from `takeDamage` at 0 HP.
- A **rank-and-file casting enemy** pattern — first non-boss enemies to carry a
  `SpellCaster` (smushroom, frog, eye-bat, beasts, lancer, skeletons). Sets the
  template for future ranged/telegraphed rabble.
- **Humanoid-sheet enemy** — first enemy rendered from the player 15×4 sheet
  (skeleton/mage). Decide: reuse `HumanoidSprites` + `WeaponVisuals`, or a new
  enemy visual def.
- Possibly a `leap`/`pounce` spell builder (frog) and a **lingering ground-hazard
  AOE** with interval re-hits (smushroom cloud) in `builders.ts`.
- Turning off passive contact damage per-enemy (frog, eye-bat, smushroom) while
  keeping it for others — clean via the existing `attackDamage <= 0` guard in
  `contactHitSource`.
