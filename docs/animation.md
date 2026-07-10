# Character animation

Read this before touching character sprites, attack visuals, or hurt/flash behavior.

Player characters ("humanoids": guy, gal, skeleton, skeleton-mage) share one pipeline across three files:

- **`client/src/entities/HumanoidSprites.ts`** — the shared sheet layout every humanoid PNG follows (15 cols × 4 rows at 32×32px: rows 0–3 = Up/Right/Down/Left; cols 0–3 idle, 4–7 walk, 8–11 attack, 12 stunned/hurt, 13 burned, 14 bleeding), the clip definitions, and `makeHumanoidSpriteConfig(type)` which builds a `CharacterSpriteConfig` — the `resolveAnim(action, facing)` / `hurtAnim(facing)` lookup functions `Entity` drives. Every sheet has a **dedicated left-facing row**, so `usesFlipX: false` — no mirroring. `Entity` still supports mirroring through the `usesFlipX` flag if a future sheet needs it.
- **`client/src/characters/index.ts`** — `CLIENT_CHARACTER_VISUAL_REGISTRY` maps each `CharacterType` to `{ preload, defineAnimations, spriteConfig }`. `GameScene` iterates it in `preload()`/`create()` (deduped by texture key), so a new character skin touches only this file plus the `CharacterType` union.
- **`client/src/entities/Entity.ts` → `setupCharacter(spriteConfig, weaponType)` + `playAnim(action, facing)`** — the single per-frame driver, called by both `LocalPlayer` and `RemotePlayer`. Short sequence: sync sprite position → hurt flash (interrupts everything, early-returns) → resolve effective action → set clip → play attack FX.

Enemies do **not** go through this path — `EnemyEntity` calls `useRawSprite()` and drives its own clips from `GooSprites.ts`/`BatSprites.ts`. Clip-definition helpers shared by both paths live in `client/src/entities/SpriteClips.ts`.

## The one-shot-clip trap (bit us twice — read before touching attack/hurt)

Looping clips use `repeat: -1`; attack and hurt use `repeat: 0` (play once). Phaser sets `anims.isPlaying = false` the instant a one-shot *finishes*, which is **indistinguishable from "never started."** A naive "replay if `!isPlaying`" therefore restarts the clip every frame for as long as the input (held Space) still says "attack" — looping an animation meant to fire once.

The fix pattern, used for the body clip (`wasAttacking`/`attackAnimDone` → `resolveEffectiveAction`, falls back to idle once done) and the attack FX (`updateAttackFX` only fires on the `startedAttack` rising edge): **edge-detect the rising edge of the action, track completion explicitly, and don't re-fire until the action goes false then true again.** Any new one-shot (a spell cast, a dodge) needs this same treatment.

## Who decides an attack happened: the server, via `attackSeq`

Not the local keypress. The *cooldown-gated* fire logic lives only in `Player.applyInput()` (server), which bumps `state.attackSeq` once per accepted attack. Both `RemotePlayer` and `LocalPlayer` drive their swing/hurt visuals off that seq: on a seq change they call `retriggerAttack()` (resets `wasAttacking` so the next `playAnim("attack")` is a fresh `startedAttack` → restarts the body clip + replays the attack FX/bow), and pass `action = isAttacking ? "attack" : …`.

**Do not** revive the old "local player animates straight from `input.attack`" shortcut — it desynced from the server's cooldown, so held-fire replayed the bow only once and cooldown-rejected presses restarted the swing clip every frame. Trade-off: the local swing shows ~1 tick (50ms) after the press (position was already server-driven, so it's consistent); if that ever needs to feel instant, add client-side cooldown prediction rather than going back to raw-input animation.

Two related server rules in the same method:
- **Melee fires only on the rising edge** (`input.attack && !prevAttack`) so you can't hold-to-chain-swing, while **ranged auto-fires while held**.
- **Facing is frozen while a ranged weapon is held** (after the first frame) so you can strafe/back-pedal and keep firing your aimed direction. `LocalPlayer` mirrors that exact facing rule locally so the sprite matches with no round-trip — **if you change one, change both.**

## `syncSpritePosition` — why it exists

`RemotePlayer.update()` moves `sprite.x/y` (the invisible rectangle anchor) via lerp, but only `Entity.setPosition()` — which `RemotePlayer` never calls — would copy that onto the visible `charSprite`. Fixed by moving the `charSprite.x/y = sprite.x/y` sync into `playAnim()` (`syncSpritePosition()`), which both `LocalPlayer` and `RemotePlayer` call every frame. It also calls `syncAttackFX()` to re-anchor any in-flight FX strip and weapon icon to the entity's current position — so swinging while moving looks correct.

If you add a new `Entity` subclass with its own movement code path, make sure it flows through something that calls `playAnim()` every frame, or its visible sprite (and any FX) won't move.

**Faking motion the sprite sheet doesn't have**: for a screen-space animation that isn't in the art (a dash, a knockback flinch), tween a separate offset field on the Entity instead of the real `sprite.x/y` — the server-authoritative position never moves, but `syncSpritePosition()` can add the offset to the visible `charSprite` each frame.

## Verifying frame order without a browser

The user usually has `npm run dev` already running (holding ports 5173/2567), and the in-chrome tools are often unavailable — so you frequently *can't* attach a live preview. For animation work you rarely need to.

To confirm a frame *sequence* is right, extract the exact frames straight from the sprite PNG with a `sharp` one-liner and view them:

```js
node -e "const s=require('sharp');(async()=>{const seq=[/*frame indices*/];/* extract 32px cells at col=f%COLS,row=(f/COLS|0) — COLS=15 for humanoid sheets — resize x4 nearest, composite side by side */})()"
```

Then `Read` the output image. This catches drop-first / hold-a-frame / reverse mistakes immediately. Pair with `npx tsc --noEmit -p client/tsconfig.json` + `npm run build` for correctness.

Only reach for a live browser when you need to judge *timing/feel* (tween speeds, step distance), and even then the user can eyeball it faster than you can attach.
