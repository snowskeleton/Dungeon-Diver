# Enemies

Read this before adding or balancing an enemy. Use this recipe, not the generic "add an entity type" steps in CLAUDE.md.

## What you need from the user before starting

1. Spritesheet PNG dropped in `assets/` (confirm dimensions: `node -e "require('sharp')('assets/<name>.png').metadata().then(m=>console.log(m.width,m.height))"`)
2. Row layout: which row/frames are idle/walk/attack/death. Current enemies are single-row strips: goos are 6×1 at 32×32, bat is 6×1 at 16×16. Use the frame-count script below if unsure.
3. Stats that differ from existing enemies (HP, speed, damage, attack cooldown ms, knockback resistance)
4. Facing behavior: **horizontal-only** (left/right only, flipX for mirroring — all current enemies) or **full 4-directional** (humanoid-style; needs an `Enemy` subclass)

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

## Files to create (two per enemy type)

**`shared/src/enemies/<Name>.ts`** — a plain `EnemyConfig` object (copy `GooGreen.ts`):

```ts
export const <NAME>_CONFIG: EnemyConfig = {
  maxHp: 60, speed: 70, aggroRadius: 160, attackRadius: 14,
  attackDamage: 10, attackCooldownMs: 1200, knockbackResistance: 3,
};
```

**`client/src/entities/<Name>Sprites.ts`** — same structure as `GooSprites.ts`/`BatSprites.ts`:
- `FRAME_SIZE`, `COLS` (from spritesheet dimensions ÷ cell size)
- anim definitions with `frames`, `frameRate`, `repeat` per clip (goos reuse the walk frames reversed as the death clip — cheap and looks fine)
- `<name>AnimKey(...)`, `preload<Name>(scene)`, `define<Name>Animations(scene)`, and an `is<Name>Type()` type guard

**Server class: usually NONE.** `server/src/entities/Goo.ts` is the one concrete enemy class — it takes any `EnemyType`, pulls its config from `ENEMY_REGISTRY`, and overrides `updateFacing()` for horizontal-only art (bats spawn as `Goo` too, despite the name). Only add an `Enemy` subclass if the new enemy needs different facing behavior or custom AI.

## Files to touch (five edits per enemy type)

1. `shared/src/enemies/base.ts` — add the new id to the `EnemyType` union
2. `shared/src/enemies/index.ts` — register the config in `ENEMY_REGISTRY` (+ re-export it)
3. `server/src/rooms/GameRoom.ts` — add the id to the `ENEMY_TYPES` spawn pool
4. `client/src/scenes/GameScene.ts` — add `preload<Name>` in `preload()` and `define<Name>Animations` in `create()`; the `state.enemies.onAdd` handler already reads `enemyType` generically
5. `client/src/entities/EnemyEntity.ts` — branch on `is<Name>Type()` in the constructor (to set up the sprite) and in `playEnemyAnim()`; also add a display name to `CLIENT_ENEMY_REGISTRY` in `client/src/enemies/index.ts`

## Death, knockback & hitstun

Handled in the `Enemy` base class — no per-type work needed.

- `takeDamage()` sets `state.isDying` when health hits 0; invulnerable and stops ticking after that; the corpse gets a WALL-only collision mask so it doesn't block.
- `applyKnockback(fromX, fromY, force)` uses an **overage threshold**: `overage = force − cfg.knockbackResistance`. If `overage ≤ 0` the hit is **fully shrugged off** (no push, no stun — heavy enemies ignore weak hits). Above the threshold it pushes `overage * KNOCKBACK_SCALE` px (a velocity impulse decaying ~4 ticks via `KNOCKBACK_DECAY`, swept against walls by the physics step) **and** applies hitstun of `min(KNOCKBACK_STUN_MAX_MS, overage * KNOCKBACK_STUN_MS_PER_UNIT)`. While `stunMs > 0` the enemy's `tick()` skips all AI (no chase/attack — the impulse still carries), so a chasing enemy can't instantly re-close and eat the push. `state.stunned` is synced for a future stun visual. Both melee (`GameRoom` step 3a) and projectiles (step 3c) go through this same method.
- Dead enemies **stay dead until the floor changes.** Cleared rooms stay cleared; everything is wiped and respawned fresh only when `advanceFloor()` regenerates the floor. `Enemy.clearCheckDone` is set to `true` the first tick after death so `GameRoom.tick()` step 4 calls `FloorManager.onEnemyMaybeCleared` exactly once per enemy.
- Client `EnemyEntity` plays the death clip once then holds the last frame, hides the HP bar, drops depth below players.

## Balance

- **Per enemy** → `shared/src/enemies/<Name>.ts` (`GooGreen.ts`, `Bat.ts`, …): `maxHp`, `speed`, `aggroRadius`, `attackRadius`, `attackDamage`, `attackCooldownMs`, `knockbackResistance`.
- **Knockback / hitstun feel** → `shared/src/types.ts`: `KNOCKBACK_SCALE` (px pushed per unit of overage), `KNOCKBACK_STUN_MS_PER_UNIT` + `KNOCKBACK_STUN_MAX_MS` (hitstun length per overage, capped). The per-enemy `knockbackResistance` is the threshold a hit's `force` must clear; per-weapon `attackForce` / per-ammo `knockback` is that force.
- **Enemy count** → `GameRoom.enemiesPerRoom()` = `ceil((ENEMY_BASE_COUNT + floor(floorNum / ENEMY_FLOOR_BONUS_INTERVAL)) × (1 + ENEMY_PLAYER_SCALE × (playerCount − 1)))`. **Every combat and maze room** gets that many (boss/shop/shrine get none). Constants in `shared/src/types.ts`. Floor 1 solo = 3 per room; floor 10 four-player = 14 per room. Types are rolled uniformly from the `ENEMY_TYPES` pool in `GameRoom.ts`.

**Gotcha**: melee `attackRadius` values are center-to-center and must exceed `2 × ENTITY_RADIUS` (10px) or attacks silently never land against rigid separation — that's why the goo configs use `attackRadius: 14`.
