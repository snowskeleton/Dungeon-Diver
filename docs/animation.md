# Character animation

Read this before touching character sprites, attack visuals, or hurt/flash behavior.

Player characters ("humanoids": guy, gal, skeleton, skeleton-mage) share one pipeline across three files:

- **`client/src/entities/HumanoidSprites.ts`** — the shared sheet layout every humanoid PNG follows (15 cols × 4 rows at 32×32px: rows 0–3 = Up/Right/Down/Left; cols 0–3 idle, 4–7 walk, 8–11 attack, 12 stunned/hurt, 13 burned, 14 bleeding), the clip definitions, and `makeHumanoidSpriteConfig(type)` which builds a `CharacterSpriteConfig` — the `resolveAnim(action, facing)` / `hurtAnim(facing)` lookup functions `Entity` drives. Every sheet has a **dedicated left-facing row**, so `usesFlipX: false` — no mirroring. `Entity` still supports mirroring through the `usesFlipX` flag if a future sheet needs it.
- **`client/src/characters/index.ts`** — `CLIENT_CHARACTER_VISUAL_REGISTRY` maps each `CharacterType` to `{ preload, defineAnimations, spriteConfig }`. `GameScene` iterates it in `preload()`/`create()` (deduped by texture key), so a new character skin touches only this file plus the `CharacterType` union.
- **`client/src/entities/Entity.ts` → `setupCharacter(spriteConfig, weaponType)` + `playAnim(action, facing)`** — the single per-frame driver, called by both `LocalPlayer` and `RemotePlayer`. Short sequence: sync sprite position → hurt flash (interrupts everything, early-returns) → resolve effective action → set clip → play attack FX.

Enemies do **not** go through this path — `EnemyEntity` calls `useRawSprite()` and drives its clips from `CLIENT_ENEMY_REGISTRY` (`client/src/enemies/index.ts`): a `preload`/`defineAnimations`/`resolve(state)`/`displayW`-`displayH` bundle per enemy (plus an optional `airborne` flag). `resolve(state)` returns the clip key to play — or a **static frame** to hold — plus whether to mirror, given the enemy's full render state (dying, facing, and for bosses its `abilityId`/`telegraph`/`channeling`, and for flyers its `airHeight`). That's how the turtle spin and the wyvern dive swap to their special rows. For `airborne` enemies `EnemyEntity` also lifts the sprite by `airHeight` and draws a scaled ground shadow. Clip-definition helpers shared by both paths live in `client/src/entities/SpriteClips.ts`.

## The one-shot-clip trap (bit us twice — read before touching attack/hurt)

Looping clips use `repeat: -1`; attack and hurt use `repeat: 0` (play once). Phaser sets `anims.isPlaying = false` the instant a one-shot *finishes*, which is **indistinguishable from "never started."** A naive "replay if `!isPlaying`" therefore restarts the clip every frame for as long as the input (held Space) still says "attack" — looping an animation meant to fire once.

The fix pattern, used for the body clip (`wasAttacking`/`attackAnimDone` → `resolveEffectiveAction`, falls back to idle once done) and the attack FX (`updateAttackFX` only fires on the `startedAttack` rising edge): **edge-detect the rising edge of the action, track completion explicitly, and don't re-fire until the action goes false then true again.** Any new one-shot (a spell cast, a dodge) needs this same treatment.

## Who decides an attack happened: the server, via `attackSeq`

Not the local keypress. The *cooldown-gated* fire logic lives only in `Player.applyInput()` (server), which bumps `state.attackSeq` once per accepted attack. Both `RemotePlayer` and `LocalPlayer` drive their swing/hurt visuals off that seq: on a seq change they call `retriggerAttack()` (resets `wasAttacking` so the next `playAnim("attack")` is a fresh `startedAttack` → restarts the body clip + replays the attack FX/bow), and pass `action = isAttacking ? "attack" : …`.

**Do not** revive the old "local player animates straight from `input.attack`" shortcut — it desynced from the server's cooldown, so held-fire replayed the bow only once and cooldown-rejected presses restarted the swing clip every frame. Trade-off: the local swing shows ~1 tick (50ms) after the press (position was already server-driven, so it's consistent); if that ever needs to feel instant, add client-side cooldown prediction rather than going back to raw-input animation.

Two related server rules in the same method:
- **Melee swings on press, then charges** — a press fires a regular swing **immediately** (so taps feel snappy, not gooey), and holding the button past the threshold arms a single **charged hard swing** that fires on release (see the melee section above); **ranged auto-fires while held**.
- **Facing is frozen while a ranged weapon is held** (after the first frame) so you can strafe/back-pedal and keep firing your aimed direction. `LocalPlayer` mirrors that exact facing rule locally so the sprite matches with no round-trip — **if you change one, change both.**

## Melee timing: the weapon's cooldown is a VISIBLE wind-up, not a dead cooldown

A melee weapon no longer spends its `attackCooldownMs` as an invisible re-fire lockout.
Instead a swing is a **wind-up hold → swing arc**: on press the character instantly
snaps to the cocked-back first swing frame (immediate feedback that the input landed) and
**holds it for `attackCooldownMs`**, then plays the swing arc that carries the hitbox. The
active phase is just the FX animation's own length (`swingDurationMs`). So
`attackCooldownMs` is a pure **feel dial** — it dictates the wind-up hold and nothing else
— and the **total cadence is `attackCooldownMs + swingDurationMs`** (a hammer with a long
cooldown visibly rears back; a dagger with a short one barely pauses). This is deliberately
**not** cadence-first: the cooldown number is no longer the weapon's rate of fire, so DPS
reasoning has to add the arc length back in — a trade taken so the number tunes telegraph
in isolation, with balance a later separate pass.

- Server: `MeleeWeaponSpell` (`server/src/spells/weaponSpell.ts`) uses
  `windUpMs = attackCooldownMs` and `activeMs = swingDurationMs`, both as live getters so
  an attack-speed mod still shrinks the wind-up.
- The wind-up phase is synced as `PlayerState.windingUp`; the client holds the cocked-back
  first frame during it via the **same** `setChargePose` machinery the heavy charge uses
  (`meleeWindupPose` picks the args for both poses). When it flips false the swing arc's
  attack FX plays on the rising edge.
- Consequence: the blow lands `windUpMs` later than the press (a heavy telegraph for slow
  weapons). This is deliberate — it's what makes weapon speed *readable*. Tune it by
  changing a weapon's `attackCooldownMs`; the arc length comes from the FX art.

## Melee: tap swings now, hold-then-release adds a hard swing

Melee fires the regular swing **on the button press**, immediately — waiting for
release made every tap feel gooey. Charging the heavy is then gated behind *keeping the
button held after that first swing*:

- **press** → a **regular** swing fires this tick (advances the combo below);
- **keep holding** past the threshold → a single **hard** (charged) swing is armed
  (`PlayerState.chargeHard`) and fires when you **release**. `chargeHard` flips true at
  the threshold so the client telegraphs that the heavy is armed (a warm tint on the
  hold pose); nothing auto-fires — you release to swing.

The charge telegraph only appears **once the initial swing's animation is done**
(`state.charging` is suppressed while the swing's cast is still busy, so the swing plays
out first and then transitions into the held pose). While charging, the client holds the
swing's **first animation frame** with the weapon cocked back
(`Entity.renderChargePose` + `WeaponVisual.showWindup`). The hold threshold is a
universal Option (`chargeHoldMs`, default `DEFAULT_CHARGE_HOLD_MS`), sent to the server
alongside the combo window.

If the button is released past the threshold while the initial swing's cooldown is still
running (a fast weapon that charges before it's ready to swing again), the hard swing is
**queued** (`Player.hardQueued`) and fires the moment the weapon is free.

The hard swing is **weapon-tunable** like the combo: `Weapon.hardSwing` (default = the
combo finisher — wider strip, ×1.25 damage/knockback) built from `hardDamageMult` /
`hardKnockbackMult` (numeric getters the weapon-balance tool edits). A hard swing is its
own move — it resets the tap combo rather than extending it. Server flow:
`Player.updateMelee` fires the press swing and runs the charge, `fireSwing` chooses the
variant and sets `PlayerState.hardSwing`, which the client reads on the `attackSeq`
change to draw the heavy strip. Ranged/AOE weapons are unchanged — they fire on
press/hold, never charge.

## Melee combo (first → reverse → finisher)

Consecutive melee swings (taps) chain a three-hit combo: a plain swing, the same arc
**mirrored** (a backswing), then a **wider finisher** that hits harder. Wait longer
than the grace window and it drops back to the first swing.

- **The combo is defined on the weapon**, MIT-style, not in a lookup table.
  `Weapon.comboSwings` (`shared/src/weapons/base.ts`) returns the three
  `ComboSwing`s — each an `{ fxType, mirrored, damageMult, knockbackMult }` — built
  from the weapon's own `fxType` (the finisher uses `longFxVariant`) and its
  per-swing multiplier getters (`comboNDamageMult` / `comboNKnockbackMult`, plain
  numbers so the weapon-balance tool edits them; a weapon or a category base can
  buff just one swing). Ranged/AOE weapons carry the getters but never combo.
- **The step lives on the player and is server-authoritative.** `Player`
  (`server/src/entities/Player.ts`) walks `comboIndex` 0→1→2→0 as it accepts
  melee swings and resets it when the gap since the last swing exceeds the
  weapon's cooldown plus the grace window (`advanceCombo`). It exposes the current
  swing to the melee spell via `Caster.meleeCombo`, so `weaponSpell`'s melee
  effect picks the right hurtbox (`Weapon.comboHurtbox`, which mirrors via
  `fxHurtboxAt(..., mirrored)`) and folds the multipliers into the blow.
- **The step crosses the wire as `PlayerState.comboStep`** (beside `attackSeq`),
  so the client draws the matching strip. On an `attackSeq` change,
  `LocalPlayer`/`RemotePlayer` call `Entity.setPendingComboSwing(weaponId,
  comboStep)`; the FX layer (`playAttackFX`) flips the strip with `setFlipY` for a
  backswing and swaps to the finisher's wider strip. `HeldWeaponVisual` keeps one
  strip sprite per FX type the weapon can swing.
- **The grace window is a client Option** (`comboWindowMs`, default
  `DEFAULT_COMBO_WINDOW_MS`). It governs server-authoritative timing, so — unlike
  every other option — `LocalPlayer` sends it to the room (`"comboWindow"`) on
  join and `Player.setComboWindow` clamps it.

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
