# Enemies

Read this before adding or balancing an enemy. Use this recipe, not the generic "add an entity type" steps in CLAUDE.md.

## Hurt bounds are generated, not declared

An enemy's damageable region is measured from its spritesheet — add the enemy's
geometry to `client/src/enemies/spriteGeometry.ts` and run `npm run assets:hurtboxes`.
Never write a hurt size by hand. See CLAUDE.md's gotcha on walking-vs-hurt bounds.

## What you need from the user before starting

1. Spritesheet PNG dropped in `assets/` (confirm dimensions: `node -e "require('sharp')('assets/<name>.png').metadata().then(m=>console.log(m.width,m.height))"`; `sharp` is not a project dependency — `npm install sharp` somewhere scratch and require it by path)
2. Row layout: which row/frames are idle/walk/attack/death. Use the frame-count script below if unsure.
3. Stats that differ from existing enemies (HP, speed, damage, attack cooldown ms, knockback resistance)
4. Facing behavior — this picks which client factory you use, and must match the class's `facingMode` getter:
   - **horizontal** (`makeSheetEnemyDef`): one side view, mirrored with flipX for left. Goos, bats, spider, frog-flowers, float-skulls, every boss.
   - **directional** (`makeDirectionalEnemyDef`): a 4-row sheet, one row per facing. Bones, kultist, armor-lancer, the beasts, the snakes.

**Row order on directional sheets is up / right / down / left**, same as the humanoid sheets. This art pack documents it only in `Humanoid Sprites.txt`, but it holds for the enemy sheets too — verified two ways: row 3 is an exact per-cell mirror of row 1 (so one of them is "left"), and on ArmorLancer — the one sheet drawn per-direction rather than mirrored — row 1's lance tip reaches the right edge. If a new enemy ends up walking backwards, swap `ROW.right`/`ROW.left` in `directionalEnemy.ts` for it.

## Detecting frame counts per row

```js
node -e "
const sharp = require('node_modules/sharp');
async function go() {
  const { data, info } = await sharp('assets/<name>.png').raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, CELL = 32, COLS = Math.round(W/32);
  for (let row = 0; row < Math.round(H/CELL); row++) {
    const cols = Array.from({length:COLS},(_,col)=>{
      for(let y=row*CELL;y<(row+1)*CELL;y++)for(let x=col*CELL;x<(col+1)*CELL;x++)
        if(data[(y*W+x)*4+3]>0)return '#';
      return '.';
    });
    console.log('Row', row, ':', cols.join(''), '->', cols.filter(c=>c==='#').length, 'frames');
  }
}
go()
"
```

## Files to create (one server class per enemy type)

Enemies are **object-oriented**: behaviour and stats live *on the class*, compiler-checked. There is **no** `EnemyConfig`, **no** `ENEMY_REGISTRY`, and **no** generic `Goo` class — that data-driven design was abandoned (see CLAUDE.md's engineering note).

**`server/src/entities/enemies/<group>.ts`** — an `Enemy` subclass. `GooGreen` is the baseline (exactly the `Enemy` defaults, overriding nothing); tune by overriding stat getters:

```ts
export class GooGold extends Enemy {
  static readonly type: EnemyType = "goo-gold";
  protected get maxHp() { return 100; }
  protected get speed() { return 60; }
  protected get attackDamage() { return 18; }
  protected get knockbackResistance() { return 8; }
  // facingMode defaults to "horizontal"; override to return "directional" for a 4-row sheet.
}
```

Related enemies share a file — `goos.ts`, `bats.ts`, `floaters.ts`, `critters.ts`, `directional.ts` — grouped by art/behaviour, not one file each. The default `tick()` (patrol → chase → contact-melee) covers the rank-and-file; contact damage is emitted by `Enemy.contactHitSource()` (a hitbox the combat resolver applies), not dealt inline. Only override `tick()` for genuinely custom AI, or give the enemy a Spell (below).

**No client sprite module.** An enemy is one `makeSheetEnemyDef(...)` / `makeDirectionalEnemyDef(...)` def in its group module under `client/src/enemies/` (`goos.ts`, `bats.ts`, `floaters.ts`, `critters.ts`, `directional.ts`, or `bosses/<Name>.ts`) — the same grouping as the server classes; the factory builds the preload/clip/resolve bundle from the sheet's cell size and column count. The death clip defaults to the move frames reversed; pass `death` to override (bats collapse on `[5,4,3]`).

## Files to touch (three edits per enemy type)

1. `shared/src/enemies/base.ts` — add the new id to the `EnemyType` union.
2. `server/src/entities/enemies/index.ts` — add the class to the `REGULAR_ENEMIES: EnemyClass[]` array (import it). `EnemyClass` requires a `static readonly type`, so a missing or mistyped id is a compile error — no id→class map to keep in sync.
3. `client/src/enemies/` — export a `makeSheetEnemyDef(...)` or `makeDirectionalEnemyDef(...)` def from the matching group module (`bats.ts`, `directional.ts`, `bosses/<Name>.ts`, …), then wire its id to that named export in the `CLIENT_ENEMY_REGISTRY` table in `index.ts` (pure wiring — no definitions live there).

Everything else is derived. `GameRoom` rolls its spawn pool from `REGULAR_ENEMIES`; `GameScene` iterates `CLIENT_ENEMY_REGISTRY` to preload sheets (deduped by `textureKey`) and define clips; `EnemyEntity` looks the enemy up by type. The class's `facingMode` getter must match the client def (horizontal vs directional). The `Record<EnemyType, ClientEnemyDef>` on the registry makes the compiler flag any id that's missing a def.

The sheet's texture key defaults to the enemy id, so `assets/<id>.png` must match — then `npm run assets:build`. Several enemies can share one sheet by passing an explicit `textureKey` (the three float-skull colours are three rows of `float-skull.png`).

## Ranged / casting enemies

A shooting or casting enemy isn't special-cased: give it a `SpellCaster` and one or more `Spell`s (the same builders bosses use — `volley`, an AOE, …) and drive it from `tick()`. The enemy implements the small `Caster` interface (position, facing, team mask, `emitHitSource`/`spawnProjectile` — all on `Entity`). No ranged rank-and-file enemy ships yet; the boss movesets and the Mage's AOE staff (`weaponSpell`) are the reference casters. See [weapons-and-ammo.md](weapons-and-ammo.md) / [bosses.md](bosses.md).

## Multi-row and shared sheets

`makeSheetEnemyDef` takes `cols` (cells per sheet row) and optional `moveFrames` as sheet-wide frame indices. Use the `frameRow(cols, row, startCol, count)` helper rather than hand-computing indices:

```ts
// spider.png is 6×3 of 32×16 cells; row 1 is the 4-frame walk.
makeSheetEnemyDef("spider", {
  name: "Spider", frameWidth: 32, frameHeight: 16, cols: 6,
  moveFrames: frameRow(6, 1, 0, 4), displayW: 32, displayH: 16,
});
```

## Flying enemies

Flying is a plain stat, like HP or speed — no separate base class. An enemy hovers by overriding one getter:

```ts
export class Bat extends Enemy {
  static readonly type: EnemyType = "bat";
  protected get cruiseHeight() { return 16; } // px above the floor; 0 (default) = grounded
}
```

The base `Enemy.tick()` keeps `state.airHeight` at `cruiseHeight` every tick (and drops it to 0 on death, so the corpse falls). The **collision body never leaves the ground point** — height is purely visual, so a flyer is hit exactly like a grounded enemy. Current flyers: bats (16px) and the floating eyes/skulls (12px); the wyvern bosses cruise at `FLYING_CRUISE_HEIGHT` (44px). A dive attack (the wyvern swoop) drives the height dynamically via `setAirHeight()` from a Spell — see [bosses.md](bosses.md).

On the client, mark the def **`airborne: true`** (a field on `SheetSpec` / `ClientEnemyDef`); `EnemyEntity` then lifts the sprite by the synced `airHeight` and scales a ground shadow beneath it. The shadow's falloff is in absolute px, so it works at any cruise height without extra config.

## Bosses

A boss is a `Boss` subclass — one per boss, in `server/src/entities/bosses/<Name>.ts`, listed in `BOSSES` in `bosses/index.ts` (not in `REGULAR_ENEMIES`, so a boss can never leak into the normal spawn pool). Its moveset is `abilities(): Spell[]`; the full recipe is [bosses.md](bosses.md). `GameRoom.spawnBoss()` places exactly one in the room the generator typed `"boss"`, rotating through `BOSSES` by floor number so consecutive floors differ. They render at 2× a normal enemy.

**`spawnBoss()` must run before `FloorManager.finalizeEmptyRooms()`** — it's called from the end of `spawnFloorEnemies()` for that reason. Run it after, and the boss room is treated as empty, pre-cleared, and its barriers removed.

Bosses deal **no passive contact damage** — every hit is a telegraphed Spell, so `Boss` overrides `contactHitSource()` to return null. A boss's collision body is still the standard `ENTITY_RADIUS` circle at its feet, so a 64px sprite has a small hitbox.

## Deferred spawning (you get no say, but know it happens)

An enemy is **constructed at floor start but not revealed until a player walks into its
room.** `SpawnDirector.spawnFloorEnemies` builds every creature (confined, party-scaled,
registered with FloorManager so the room locks) and holds it *unspawned* — out of the
synced `state.enemies`, skipped for AI/contact, and un-hittable (`damageable` is false).
`GameRoom.tick` reveals a room's whole batch at once the first time a player is in it or
in a passageway touching it; the client puffs dust over each on `enemies.onAdd`
(`client/src/entities/SpawnFX.ts`). A new enemy class needs to do **nothing** for this —
it's handled entirely in `Enemy` (`_spawned`, `markUnspawned`/`reveal`) and
`SpawnDirector`. `_spawned` defaults to true, so a directly-constructed enemy (a unit
test, a boss summon) is live immediately. This is also why there is no longer any
room-dormancy code: an enemy you haven't reached simply doesn't exist yet.

## Death, knockback & hitstun

Handled in the `Entity` / `Enemy` base classes — no per-type work needed. Knockback + hitstun live on `Entity` so **players share them** (a boss shove or projectile pushes and briefly stuns the player too).

- `Enemy.takeDamage()` sets `state.isDying` when health hits 0; `damageable` then returns false so the corpse takes no more hits, and it gets a WALL-only collision mask so it doesn't block.
- Every hit — a melee swing, a projectile, a boss AOE, an enemy's contact — arrives as an `Attack` value object through `Entity.takeHit()`, which applies the damage then `applyKnockback(sourceX, sourceY, knockback)`. One resolver (`server/src/combat/CombatSystem`) drives all of it (see [layers.md](layers.md)).
- `applyKnockback(fromX, fromY, force)` uses an **overage threshold**: `overage = force − knockbackResistance`. If `overage ≤ 0` the hit is **fully shrugged off** (no push, no stun — heavy enemies ignore weak hits). Above it, push = `overage × KNOCKBACK_SCALE` px (a velocity impulse decaying via `KNOCKBACK_DECAY`, swept against walls by the physics step) **and** hitstun of `min(KNOCKBACK_STUN_MAX_MS, overage × KNOCKBACK_STUN_MS_PER_UNIT)`. While `stunMs > 0`, `updateStun()` gates control — an enemy skips its AI, a player skips its input — so the impulse carries cleanly. `state.stunned` is synced (shared on `EntityState`).
- Dead enemies **stay dead until the floor changes.** Cleared rooms stay cleared; everything is wiped and respawned fresh only when `advanceFloor()` regenerates the floor. `Enemy.clearCheckDone` is set the first tick after death so `GameRoom.tick()` calls `FloorManager.onEnemyMaybeCleared` exactly once per enemy.
- Client `EnemyEntity` plays the death clip once then holds the last frame, hides the HP bar, drops depth below players.

## Balance

- **Per enemy** → the stat getters on its `Enemy` subclass (`goos.ts`, `bats.ts`, …): `maxHp`, `speed`, `aggroRadius`, `attackRadius`, `attackDamage`, `attackCooldownMs`, `knockbackResistance`, `facingMode`, `cruiseHeight` (flyers). Override only what differs from the `Enemy` defaults.
- **Knockback / hitstun feel** → `shared/src/types.ts`: `KNOCKBACK_SCALE` (px pushed per unit of overage), `KNOCKBACK_STUN_MS_PER_UNIT` + `KNOCKBACK_STUN_MAX_MS` (hitstun length per overage, capped). The per-class `knockbackResistance` is the threshold a hit's `force` must clear; per-weapon `attackForce` / per-ammo `knockback` is that force. Players default to resistance 0.
- **Enemy count** → `GameRoom.enemiesPerRoom()` = `ceil((ENEMY_BASE_COUNT + floor(floorNum / ENEMY_FLOOR_BONUS_INTERVAL)) × (1 + ENEMY_PLAYER_SCALE × (playerCount − 1)))`. **Every combat and maze room** gets that many, **except the start room, which is always left clear** (players spawn there). Boss/shop/shrine get none. The one exception to the clear-start rule is a single-room debug floor (start === exit). Constants in `shared/src/types.ts`. Floor 1 solo = 3 per room; floor 10 four-player = 14 per room. Types are rolled uniformly from `REGULAR_ENEMIES` in `GameRoom.ts`.

**Gotcha**: melee `attackRadius` values are center-to-center and must exceed `2 × ENTITY_RADIUS` (10px) or attacks silently never land against rigid separation — that's why the goo configs use `attackRadius: 14`.
