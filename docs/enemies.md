# Enemies

Read this before adding or balancing an enemy. Use this recipe, not the generic "add an entity type" steps in CLAUDE.md.

## What you need from the user before starting

1. Spritesheet PNG dropped in `assets/` (confirm dimensions: `node -e "require('sharp')('assets/<name>.png').metadata().then(m=>console.log(m.width,m.height))"`; `sharp` is not a project dependency — `npm install sharp` somewhere scratch and require it by path)
2. Row layout: which row/frames are idle/walk/attack/death. Use the frame-count script below if unsure.
3. Stats that differ from existing enemies (HP, speed, damage, attack cooldown ms, knockback resistance)
4. Facing behavior — this picks which client factory you use, and must match `EnemyConfig.facingMode`:
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

## Files to create (one per enemy type)

**`shared/src/enemies/<Name>.ts`** — a plain `EnemyConfig` object (copy `GooGreen.ts`):

```ts
export const <NAME>_CONFIG: EnemyConfig = {
  maxHp: 60, speed: 70, aggroRadius: 160, attackRadius: 14,
  attackDamage: 10, attackCooldownMs: 1200, knockbackResistance: 3,
};
```

Freshly imported art that nobody has balanced yet can spread `PLACEHOLDER_ENEMY_CONFIG` (or `PLACEHOLDER_BOSS_CONFIG`) from `base.ts` instead — every enemy that does plays identically, which is how you spot the untuned ones. Replace the spread with real numbers when you tune it.

**No client sprite module.** An enemy is one line in `CLIENT_ENEMY_REGISTRY` (below); the factory builds the preload/clip/resolve bundle from the sheet's cell size and column count. The death clip defaults to the move frames reversed; pass `death` to override (bats collapse on `[5,4,3]`).

**Server class: NONE.** `server/src/entities/Goo.ts` is the one concrete enemy class — it takes any `EnemyType`, pulls its config from `ENEMY_REGISTRY`, and reads `cfg.facingMode` to decide 4-way vs left/right facing. Every enemy and every boss spawns as a `Goo`, despite the name. Only add an `Enemy` subclass for genuinely custom AI.

## Files to touch (three edits per enemy type)

1. `shared/src/enemies/base.ts` — add the new id to the `EnemyType` union
2. `shared/src/enemies/index.ts` — register the config in `ENEMY_REGISTRY` (+ re-export it)
3. `client/src/enemies/index.ts` — add a `makeSheetEnemyDef(...)` or `makeDirectionalEnemyDef(...)` entry to `CLIENT_ENEMY_REGISTRY`

Everything else is derived. `GameRoom`'s `ENEMY_TYPES` spawn pool is every non-boss key of `ENEMY_REGISTRY`; `GameScene` iterates `CLIENT_ENEMY_REGISTRY` to preload sheets (deduped by `textureKey`) and define clips; `EnemyEntity` looks the enemy up by type; the Debug menu's enemy-type list builds itself from both registries. The `Record<EnemyType, …>` on each registry makes a forgotten entry a compile error.

The sheet's texture key defaults to the enemy id, so `assets/<id>.png` must match — then `npm run assets:build`. Several enemies can share one sheet by passing an explicit `textureKey` (the three float-skull colours are three rows of `float-skull.png`).

## Multi-row and shared sheets

`makeSheetEnemyDef` takes `cols` (cells per sheet row) and optional `moveFrames` as sheet-wide frame indices. Use the `frameRow(cols, row, startCol, count)` helper rather than hand-computing indices:

```ts
// spider.png is 6×3 of 32×16 cells; row 1 is the 4-frame walk.
makeSheetEnemyDef("spider", {
  name: "Spider", frameWidth: 32, frameHeight: 16, cols: 6,
  moveFrames: frameRow(6, 1, 0, 4), displayW: 32, displayH: 16,
});
```

## Bosses

Set `boss: true` on the config. Bosses are filtered out of the random spawn pool; `GameRoom.spawnBoss()` places exactly one in the room the generator typed `"boss"`, rotating through `BOSS_TYPES` by floor number so consecutive floors differ. They render at 2× a normal enemy.

**`spawnBoss()` must run before `FloorManager.finalizeEmptyRooms()`** — it's called from the end of `spawnFloorEnemies()` for that reason. Run it after, and the boss room is treated as empty, pre-cleared, and its barriers removed.

Boss sheets only get a locomotion clip today; their attack/special/spin rows are imported but unused, waiting on real movesets. A boss's collision body is still the standard `ENTITY_RADIUS` circle at its feet, so a 64px sprite has a small hitbox — raise `attackRadius` to match the art (the placeholder uses 26).

## Death, knockback & hitstun

Handled in the `Enemy` base class — no per-type work needed.

- `takeDamage()` sets `state.isDying` when health hits 0; invulnerable and stops ticking after that; the corpse gets a WALL-only collision mask so it doesn't block.
- `applyKnockback(fromX, fromY, force)` uses an **overage threshold**: `overage = force − cfg.knockbackResistance`. If `overage ≤ 0` the hit is **fully shrugged off** (no push, no stun — heavy enemies ignore weak hits). Above the threshold it pushes `overage * KNOCKBACK_SCALE` px (a velocity impulse decaying ~4 ticks via `KNOCKBACK_DECAY`, swept against walls by the physics step) **and** applies hitstun of `min(KNOCKBACK_STUN_MAX_MS, overage * KNOCKBACK_STUN_MS_PER_UNIT)`. While `stunMs > 0` the enemy's `tick()` skips all AI (no chase/attack — the impulse still carries), so a chasing enemy can't instantly re-close and eat the push. `state.stunned` is synced for a future stun visual. Both melee (`GameRoom` step 3a) and projectiles (step 3c) go through this same method.
- Dead enemies **stay dead until the floor changes.** Cleared rooms stay cleared; everything is wiped and respawned fresh only when `advanceFloor()` regenerates the floor. `Enemy.clearCheckDone` is set to `true` the first tick after death so `GameRoom.tick()` step 4 calls `FloorManager.onEnemyMaybeCleared` exactly once per enemy.
- Client `EnemyEntity` plays the death clip once then holds the last frame, hides the HP bar, drops depth below players.

## Balance

- **Per enemy** → `shared/src/enemies/<Name>.ts` (`GooGreen.ts`, `Bat.ts`, …): `maxHp`, `speed`, `aggroRadius`, `attackRadius`, `attackDamage`, `attackCooldownMs`, `knockbackResistance`.
- **Knockback / hitstun feel** → `shared/src/types.ts`: `KNOCKBACK_SCALE` (px pushed per unit of overage), `KNOCKBACK_STUN_MS_PER_UNIT` + `KNOCKBACK_STUN_MAX_MS` (hitstun length per overage, capped). The per-enemy `knockbackResistance` is the threshold a hit's `force` must clear; per-weapon `attackForce` / per-ammo `knockback` is that force.
- **Enemy count** → `GameRoom.enemiesPerRoom()` = `ceil((ENEMY_BASE_COUNT + floor(floorNum / ENEMY_FLOOR_BONUS_INTERVAL)) × (1 + ENEMY_PLAYER_SCALE × (playerCount − 1)))`. **Every combat and maze room** gets that many, **except the start room, which is always left clear** (players spawn there). Boss/shop/shrine get none. The one exception to the clear-start rule is a single-room debug floor (start === exit), where the start room is all there is. Constants in `shared/src/types.ts`. Floor 1 solo = 3 per room; floor 10 four-player = 14 per room. Types are rolled uniformly from the `ENEMY_TYPES` pool in `GameRoom.ts`.

**Gotcha**: melee `attackRadius` values are center-to-center and must exceed `2 × ENTITY_RADIUS` (10px) or attacks silently never land against rigid separation — that's why the goo configs use `attackRadius: 14`.
