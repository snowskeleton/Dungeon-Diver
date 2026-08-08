# Enemy pathfinding & aggro

How a rank-and-file enemy decides *who* to chase and *how* to get there. Bosses do
not use any of this — they have their own movement behaviours (see
[bosses.md](bosses.md) and `entities/bosses/movement.ts`).

## The shape of the problem

Enemies are **confined to one room** (`Enemy.confineTo` / `homeBounds`), so navigation
never spans the floor — only "cross this ~19×14-tile room to a player." That collapses
A*-per-enemy into a shared **flow field**: once per tick we BFS-flood a distance field
from each in-room player over the room's walkable tiles, and every enemy reads the
gradient at its own tile in O(1). Many enemies chasing one player share one flood.

We flood **per player**, not from a single "nearest player" source. That is the whole
reason aggro is cheap: pathfinding answers *how to reach player X*, and target selection
(`Enemy.pickTarget`) independently answers *which X* — the field never knows aggro exists.

## The three pieces

### 1. Wall classification — `wallKind()` (`shared/src/dungeonGenerator.ts`)

Every `TILE.WALL` is either **structural** (the room's perimeter ring / the void between
rooms) or **cover** (a designer-placed block inside a room's interior). `wallKind(col,
row, tile)` is the single classifier, and it backs BOTH:

- **Physics** (`PhysicsWorld.buildWallBodies`) emits structural tiles as `Layer.WALL`
  bodies and cover tiles as `Layer.COVER` bodies, in two separate greedy-merge passes so
  a single body never spans both classes.
- **Traversability grids** (below) mark ground-blocked vs air-blocked from the same rule.

Because one function feeds both, what an enemy paths through and what its body collides
with can never disagree.

**Flyers fly over cover.** A ground enemy's body carries `Layer.COVER` in its solid mask
(`ENEMY_BODY_PROFILE` → `ALL_SOLID`); an airborne enemy (`cruiseHeight > 0`) uses
`AIRBORNE_ENEMY_BODY_PROFILE`, which drops the `COVER` bit — so it still collides with
structural walls, the perimeter, players, and other enemies, but passes over interior
cover blocks. The profile is chosen in `Enemy`'s constructor from `cruiseHeight` (a
constant getter, safe to read there). Height itself stays purely visual; this only
changes which walls stop the body.

### 2. `FlowFieldSystem` (`server/src/pathfinding/FlowFieldSystem.ts`)

Owned by `GameRoom`, rebuilt each floor (new geometry = new grids).

- **Traversability grids**, cached per room, one **ground** (cover is solid) and one
  **air** (cover is passable). Static for the floor, so built once. Interior bounds come
  from `roomInteriorRect` (the 1-tile border ring is excluded).
- **Per-tick flood** — `rebuild(occupiedRoomIds, players)` (GameRoom tick step 1c): for
  each occupied room, BFS-flood a distance field from each player standing in it, over
  both grids, keyed `${roomId}:${sessionId}:${kind}`. Rebuilt every tick, so a field is
  never stale — no replan-interval bookkeeping. Cost is ≤4 players × 2 grids × ~266 tiles.
- BFS is **4-neighbour** (uniform cost, no diagonal corner-cutting). `sample(kind,
  roomId, sessionId, x, y)` returns the raw tile-delta toward the player by steepest
  descent over the tile's **8** open neighbours (an 8-way lookaround off a 4-way field →
  smooth diagonal heading, with an explicit corner-cut guard). `null` = no field (enemy
  outside a tracked room) or no downhill step (already adjacent) → caller beelines.
- `lineOfSight(kind, roomId, x0,y0, x1,y1)` marches the segment at half-tile resolution;
  a point outside the interior counts as blocked.

### 3. Target selection + following (`server/src/entities/Enemy.ts`)

`tick()` (the default chase-and-melee AI) now:

1. `decayThreat(dtMs)` — every player's threat halves every `THREAT_HALF_LIFE_MS`.
2. `pickTarget(players)` — among players within `aggroRadius`, the highest
   `AGGRO_PROX_WEIGHT·(1 − dist/aggroRadius) + AGGRO_THREAT_WEIGHT·threat`. With zero
   threat this is exactly "nearest player"; enough accumulated damage pulls an enemy off
   a closer target. `null` (none in range) → patrol.
3. In attack range → attack; else `pathToward(target)`.

`pathToward` uses the field only when it has to: with a **clear line of sight** it
beelines (precise tracking of a moving player); when a wall or cover block is in the way
it follows the gradient around it. Without a navigator (a test-built enemy on a bare
`PhysicsWorld`) it always beelines. **It samples at the foot position** (`state.y +
FOOT_OFFSET`), not the sprite centre, because the collision body is at the feet — sampling
the centre would route an enemy through a gap its body doesn't fit.

**Threat is fed from the combat resolver, not bookkept per attack.** `CombatSystem.resolve`
already returns `HitEvent { ownerId, targetId, damage }`; `GameRoom` walks that list and
calls `enemy.registerThreat(ownerId, damage)`. So melee, projectiles, and AOE all raise
threat identically. For this to work every player hit needs an `ownerId`, so `GameRoom`
stamps it at the drain choke point (harmless to resolution — a player source only affects
`ENEMY|PROP`, so its owner can never self-exclude).

### 4. Crowd separation — `EnemyFlock` (`engine/src/pathfinding/EnemyFlock.ts`)

The flow field answers *which way* to the player, and on its own it funnels every
chaser onto the one shortest path — so a pack piles into a single overlapping stack
(the collision bodies are radius-5 foot circles under much bigger sprites, so bodies
barely touch while sprites fully overlap). `EnemyFlock` is the second half of a
boids-style steer: the **separation** term that fans the pack out to *surround* the
target.

- `GameRoom.tick` (step 1d, right after the flow-field rebuild) calls
  `enemyFlock.rebuild(...)` with every **spawned, non-dying** enemy paired with its
  home room. One per-tick snapshot grouped by room — cheap because enemies are
  confined to one room, so separation only ever consults same-room neighbours.
- `separation(selfId, roomId, x, y, radius)` returns an accumulated push-away vector:
  each same-room neighbour within `radius` contributes a unit vector pointing away
  from it, scaled by a linear falloff (1 at contact → 0 at the rim). The result is
  **not** normalized — its length reflects crowd pressure.
- `Enemy.chase` blends this into the desired heading: the heading is reduced to a unit
  vector, then `separation × separationWeight` is added. So a lone enemy chases
  exactly as before, and a crowded one bows outward in proportion to how bunched it
  is. The push fades at the rim, so the group settles spread ~`separationRadius`
  apart rather than being flung arbitrarily far. **Facing tracks the original heading**
  (the player), not the shoved one, so a spreading enemy still looks where it's going.

The flock is injected (`Enemy.setCrowd`) at the same `SpawnDirector.addEnemy` choke
point as the navigator, so a test-built or free enemy has none and simply doesn't
spread. Bosses fully override `tick()` and drive their bodies with the movement
builders (not `chase`), so separation never touches them.

## Tuning

| Knob | Where |
|---|---|
| Aggro weights (proximity vs threat), threat half-life | `AGGRO_*` / `THREAT_*` consts in `engine/src/entities/Enemy.ts` |
| Aggro range, speed (per enemy) | the `Enemy` subclass's `aggroRadius` / `speed` getters |
| Which enemies fly over cover | the subclass's `cruiseHeight` getter (> 0 = airborne) |
| Crowd spread (how far / how hard a pack fans out) | `separationRadius` / `separationWeight` getters on `Enemy` (per-subclass override; `separationWeight = 0` disables spreading for a bulldozing brute) |

## Gotchas

- **Field tiles are sprite-space; collision is foot-space.** `pathToward` offsets by
  `FOOT_OFFSET` when sampling so the two agree. If you add another consumer of the
  navigator, offset it the same way or it will steer bodies into walls.
- **Cover-vs-structural is positional**, from `col % ROOM_W` / `row % ROOM_H` — it assumes
  the map is exactly `gridCols·ROOM_W × gridRows·ROOM_H` (it always is). A wall on any
  room slot's border ring is structural; only interior walls are cover.
- **The air grid inside a room is effectively open** (structural walls only live on the
  excluded border ring), so the air field is a straight-line beeline within the room —
  which is exactly what a flyer should do. The two-grid design still earns its keep
  because it keeps one code path for flyers and walkers with no beeline special-case.
- Bosses override `tick()`, so none of this touches them.
