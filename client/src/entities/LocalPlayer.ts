import Phaser from "phaser";
import {
  InputMessage, CharacterClass, CharacterType, Character, getCharacter,
  Weapon, WeaponView, WeaponSlotView, UpgradeSlotView, resolveWeapon, Facing, facingFromInput,
  GameStateView, PlayerStateView, ShopStateView, ShopItemStateView, OfferStateView, RewardStateView, ChestStateView, DroppedWeaponStateView,
  PLAYER_HURT_BOUNDS, FOOT_OFFSET, ComboSwing, swingDurationMs,
} from "shared";
import { Entity } from "./Entity";
import { RoomLike } from "../net/RoomLike";
import { InputSource, InputActions } from "../input/InputSource";
import { CLIENT_CHARACTER_VISUAL_REGISTRY } from "../characters";
import { DebugDrawable, DebugShape, DEBUG_COLORS, hurtBoxShape } from "../debug/DebugDraw";
import { meleeHurtboxShapes } from "../debug/hurtboxShapes";
import { meleeWindupPose } from "./meleeWindupPose";
import { AcquireFX } from "./AcquireFX";
import { InventoryMenu } from "../ui/InventoryMenu";
import { OfferPicker, OfferChoiceView } from "../ui/OfferPicker";
import { viewFromSlot } from "../ui/weaponStats";
import { loadOptions } from "../options/gameOptions";

// Must match GameRoom BUY_RADIUS so the client prompt appears exactly when the
// server will accept the purchase.
const SHOP_BUY_RADIUS = 40;

// Prediction reconciliation threshold. Below this, a gap between predicted and
// server position is just the latency lead (the client leads the server by ~one
// round-trip) and is left to stand — correcting it would fight the prediction and
// bring the lag right back. Above it, the client genuinely mispredicted (knockback,
// enemy separation, a teleport) and snaps to the server. Sized well above the
// worst-case steady-state lead so normal play NEVER snaps (a snap on the lead is
// what makes prediction feel like it isn't working).
const RECONCILE_SNAP_PX = 48;

export class LocalPlayer extends Entity implements DebugDrawable {
  readonly room: RoomLike;
  /** The same room state, typed. The server's schema classes `implements` these
   *  views, so a renamed @type field fails the server build instead of silently
   *  reading undefined here. One cast, at the boundary. */
  private readonly roomState: GameStateView;
  readonly inputSource: InputSource;
  readonly character: Character;
  // The active weapon, swapped when the server reports an activeWeaponIndex change.
  weapon?: Weapon;
  private activeWeaponId: string;
  private prevActions: InputActions = { prevSlot: false, nextSlot: false, toggleMenu: false, interact: false };
  private menuOpen = false;
  private invMenu = new InventoryMenu();
  private offerPicker = new OfferPicker();
  // The reward pedestal this player is standing on, if this player still has a pick
  // left and at least one card is unclaimed. `consumed` is the set of card indices a
  // teammate already took, so the picker greys them out.
  nearbyOffer: {
    roomId: string;
    choices: OfferChoiceView[];
    consumed: Set<number>;
  } | null = null;
  // Per-instance uids of the weapons last seen — a newly-appearing uid triggers
  // the acquire flourish. Populated on the first sync (which carries the starting
  // weapon), with `sawFirstSync` suppressing the flourish for that batch.
  private knownWeaponUids = new Set<string>();
  // Upgrades are append-only and carry no uid, so a newly-appeared one is any slot
  // past this many — the count seen on the last sync. Same first-sync suppression
  // as weapons, sharing `sawFirstSync`.
  private knownUpgradeCount = 0;
  private sawFirstSync = false;
  // While now < this, the player's input is frozen (Zelda item-get beat).
  private inputLockedUntil = 0;
  // The shop pedestal this player is currently standing on (if any) — drives the
  // store stats card and the interact-to-buy action. Must match server BUY_RADIUS.
  nearbyShopItem: { roomId: string; itemIndex: number; weaponId: string; cost: number } | null = null;

  // The unclaimed room-clear reward pedestal this player is standing on (if any).
  // Carries only the room id — the reward key into state.rewards — since a single
  // claim consumes the whole pedestal (no per-card choice like an offer).
  nearbyReward: { roomId: string } | null = null;

  // The unclaimed floor-1 supply pedestal this player is standing on (if any).
  // Keyed by pedestal id into state.supplies. Not owner-locked — the server
  // class-gates the claim and flashes an error if this class can't use it.
  nearbySupply: { supplyId: string } | null = null;

  // The unopened maze chest this player is standing on (if any). Carries only the
  // room id — a chest's contents are never synced, so there is nothing to preview.
  nearbyChest: { roomId: string } | null = null;

  // The dropped weapon this player is standing on (if any). Keyed by drop id into
  // state.droppedWeapons. Not class-filtered here — the prompt shows for anyone and
  // the server refuses (with an on-screen error) if this class can't use it.
  nearbyDropped: { dropId: string } | null = null;
  private lastInput: InputMessage = { dx: 0, dy: 0, attack: false, ability: false };
  private facing: Facing = "down";
  private prevAttack = false;
  // ── Local melee animation (fully client-owned) ───────────────────────────────
  // A MELEE swing's visuals are simulated HERE from local input, running the exact same
  // clock the server's MeleeWeaponSpell does: wind-up = the weapon's (modified)
  // attackCooldownMs, strike = swingDurationMs(fxType), combo grace = comboWindowMs,
  // hard-swing hold = chargeHoldMs — every number read from `shared` (or the synced
  // slot), so client and server CAN'T drift. The server stays authoritative for the only
  // two things that cross the wire: DAMAGE (the `hits` broadcast) and POSITION (reconciled
  // in syncFromServer). We deliberately DON'T read the server's animation fields
  // (isAttacking / windingUp / attackSeq / comboStep / hardSwing) for our OWN melee sprite
  // — rendering round-tripped animation state is what made the swing feel laggy and forced
  // the old predict-then-reconcile kludge. RemotePlayer still renders those fields (it's
  // showing the server's view of a DIFFERENT player): predict-self, interpolate-others.
  // RANGED / AOE weapons stay server-driven (projectile travel already hides their latency,
  // and hold-fire cadence is the server's to own) — see the non-melee branch of syncFromServer.
  private meleePhase: "none" | "windup" | "strike" = "none";
  private prevMeleePhase: "none" | "windup" | "strike" = "none";
  private phaseStartedAt = 0;
  private phaseDurationMs = 0;
  // The swing now in flight (chosen when it fires): its FX strip, combo index, hard flag.
  private curSwing: ComboSwing | null = null;
  private curComboStep = 0;
  private curHard = false;
  // Combo chain: index walks 0→1→2→0 across taps within the grace window; lastSwingAt is
  // when the previous swing began (wall clock). Mirrors Player.advanceCombo exactly.
  private comboIndex = 0;
  private lastSwingAt = -Infinity;
  // Deferred heavy: a held press past chargeHoldMs arms a hard swing that fires on release.
  private charging = false;
  private chargeStartedAt = 0;
  private hardQueued = false;
  // A fresh press that couldn't fire (weapon mid-swing) is remembered until this time, so
  // an early tap still lands the moment the weapon frees up. 0 = nothing buffered.
  private bufferedUntil = 0;
  // The active weapon's synced (mod-adjusted) attack cooldown — the wind-up hold length.
  // Read from the synced slot so an attack-speed roll shortens the local wind-up too.
  private activeAttackCooldownMs = 0;
  // Server-driven attack flag, used ONLY to animate ranged/AOE weapons (their swing/shot
  // visuals stay authoritative). Melee ignores it — the local machine owns that sprite.
  private serverAttacking = false;
  private lastAttackSeq = -1;
  /** When the current swing's arc animation began (performance.now()), so the debug overlay
   *  reads the hurtbox of the frame actually on screen. -Infinity = no swing has struck yet. */
  private swingStartedAt = -Infinity;
  // True while holding the cocked wind-up pose (before the blade comes out) — suppresses
  // the debug hurtbox and marks where the swing arc's clock restarts.
  private windingUp = false;
  hp: number;
  downed = false;
  reviveProgress = 0;

  // Client-side movement prediction. `predicted` is the visual position we render
  // and steer locally each frame; `serverPos` is the last authoritative position we
  // reconcile against. moveSpeed/speedMultiplier are the synced pace we integrate at.
  private readonly walkableAt: (x: number, y: number) => boolean;
  private predicted = { x: 0, y: 0 };
  private serverPos = { x: 0, y: 0 };
  private moveSpeed = 0;
  private speedMultiplier = 1;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    room: RoomLike,
    inputSource: InputSource,
    characterClass: CharacterClass = "knight",
    characterType: CharacterType = "guy",
    walkableAt: (x: number, y: number) => boolean = () => true,
  ) {
    const character = getCharacter(characterClass);
    const visualDef = CLIENT_CHARACTER_VISUAL_REGISTRY[characterType];
    super(scene, x, y, 0x63b3ed, character.maxHp);
    this.character = character;
    this.walkableAt = walkableAt;
    this.predicted = { x, y };
    this.serverPos = { x, y };
    this.moveSpeed = character.speed;
    // Empty-handed at spawn — the first weapon is claimed from a supply pedestal,
    // so no weapon FX render until syncFromServer swaps one in.
    this.weapon = undefined;
    this.activeWeaponId = "";
    this.hp = character.maxHp;
    this.room = room;
    this.roomState = room.state as GameStateView;
    this.inputSource = inputSource;
    this.setupCharacter(visualDef.spriteConfig, null, undefined, undefined);
    // Tell the server this player's melee tuning (combo window + charge hold) —
    // client Options that govern server-authoritative timing.
    const opts = loadOptions();
    this.room.send("meleeTuning", { comboWindowMs: opts.comboWindowMs, chargeHoldMs: opts.chargeHoldMs, attackBufferMs: opts.attackBufferMs });
  }

  update() {
    // During the acquire flourish (or any input lock) the player is frozen in
    // place: zero the input and skip shop/menu actions.
    const locked = performance.now() < this.inputLockedUntil;
    const input = locked ? { dx: 0, dy: 0, attack: false, ability: false } : this.inputSource.read();
    if (!locked) {
      this.updateShopProximity();
      this.updateOfferProximity();
      this.updateRewardProximity();
      this.updateSupplyProximity();
      this.updateChestProximity();
      this.updateDroppedProximity();
      this.handleActions();
    }

    // Analog sticks jitter every frame, so send only on a MEANINGFUL move change
    // (or any button edge) — otherwise a held stick floods the socket at 60 Hz for
    // sub-degree wobble the server can't act on anyway.
    const MOVE_EPS = 0.03;
    if (
      Math.abs(input.dx - this.lastInput.dx) > MOVE_EPS ||
      Math.abs(input.dy - this.lastInput.dy) > MOVE_EPS ||
      input.attack !== this.lastInput.attack ||
      input.ability !== this.lastInput.ability
    ) {
      this.room.send("input", input);
      this.lastInput = { ...input };
    }

    // Mirror the server's facing rule (Player.applyInput) so the local sprite
    // faces the same way with no round-trip: a held ranged weapon freezes facing
    // (after the first frame) so strafing keeps your aim; movement still turns
    // you otherwise.
    const risingEdge = input.attack && !this.prevAttack;
    const facingLocked = !!this.weapon?.isRanged && input.attack && !risingEdge;
    if (!facingLocked) {
      this.facing = facingFromInput(input.dx, input.dy, this.facing);
    }
    this.prevAttack = input.attack;

    // Simulate the local player's melee swing from this frame's input — the same
    // wind-up→strike clock the server runs, so it animates instantly and can't drift.
    // Must run before the action/pose are chosen below.
    const now = performance.now();
    this.updateLocalMelee(input.attack && !locked, risingEdge && !locked, now);

    // Client-side prediction: move the sprite locally THIS frame instead of waiting
    // for the input→server→broadcast round-trip, so control feels instant. The
    // server stays authoritative — syncFromServer reconciles (and snaps on any real
    // divergence: knockback, a wall the prediction missed, a teleport).
    this.predictMovement(input);
    this.setPosition(this.predicted.x, this.predicted.y);

    const isMoving = input.dx !== 0 || input.dy !== 0;
    // The local melee machine drives the pose (cocked wind-up / heavy charge) and fires the
    // swing arc; applyMeleePose does that and reports whether the arc is on screen. Ranged/AOE
    // stay server-driven via serverAttacking. Nothing here is authoritative — damage + position are.
    const meleeStriking = this.applyMeleePose(now);
    const w = this.weapon;
    const rangedFiring = !!w && (w.isRanged || w.isAoe) && this.serverAttacking;
    const action = meleeStriking || rangedFiring ? "attack" : isMoving ? "walk" : "idle";
    this.playAnim(action, this.facing);
    this.renderMovementFX();
  }

  // ── Local melee state machine ────────────────────────────────────────────────
  // A direct mirror of the server's Player.updateMelee, run for VISUALS only. A tap fires a
  // swing immediately (a rear-back wind-up, then the arc); holding past chargeHoldMs arms a
  // single heavy that fires on release; an early tap that can't fire yet is buffered. Every
  // duration is the same `shared` number the server uses, so the on-screen swing lines up
  // with the authoritative one. Only melee weapons run this — ranged/AOE stay server-driven.
  private updateLocalMelee(attackHeld: boolean, risingEdge: boolean, now: number) {
    const w = this.weapon;
    if (!w || w.isRanged || w.isAoe || this.downed || this.roomState.paused) {
      this.resetMelee();
      return;
    }
    this.tickMeleePhase(now);
    const busy = this.meleePhase !== "none";
    const opts = loadOptions();

    // Age out any buffered press.
    if (this.bufferedUntil && now > this.bufferedUntil) this.bufferedUntil = 0;

    // Fresh press: swing right away and begin charging a heavy follow-up. If the weapon is
    // still mid-swing, remember the press for attackBufferMs so an early tap isn't lost.
    if (risingEdge) {
      if (!busy) {
        this.fireSwingLocal(false, now);
        this.charging = true;
        this.chargeStartedAt = now;
        return;
      }
      this.bufferedUntil = now + opts.attackBufferMs;
    }

    // Release past the hold threshold arms the heavy (the initial tap already went out).
    if (this.charging && !attackHeld) {
      if (now - this.chargeStartedAt >= opts.chargeHoldMs) this.hardQueued = true;
      this.charging = false;
    }

    // A buffered press fires as a fresh swing the moment the weapon frees up.
    if (this.bufferedUntil && !busy) {
      this.bufferedUntil = 0;
      this.fireSwingLocal(false, now);
      this.charging = true;
      this.chargeStartedAt = now;
      return;
    }
    // A queued heavy fires as soon as the weapon is free (it does not start its own charge).
    if (this.hardQueued && !busy) {
      this.hardQueued = false;
      this.fireSwingLocal(true, now);
    }
  }

  // Advance the wind-up → strike → done timeline. Wind-up holds the cocked pose for the
  // weapon's cooldown; the strike plays the arc for the FX strip's own length.
  private tickMeleePhase(now: number) {
    if (this.meleePhase === "none") return;
    if (now - this.phaseStartedAt < this.phaseDurationMs) return;
    if (this.meleePhase === "windup") {
      this.meleePhase = "strike";
      this.phaseStartedAt = now;
      this.phaseDurationMs = swingDurationMs(this.curSwing!.fxType);
    } else {
      this.meleePhase = "none";
    }
  }

  // Begin a swing: choose the combo/hard variant, then enter the wind-up hold.
  private fireSwingLocal(hard: boolean, now: number) {
    const w = this.weapon!;
    if (hard) {
      this.curHard = true;
      this.curSwing = w.hardSwing;
      this.curComboStep = 0;
      this.comboIndex = 0; // a heavy is its own move — the next tap starts a fresh chain
    } else {
      this.advanceCombo(now);
      this.curHard = false;
      this.curComboStep = this.comboIndex;
      this.curSwing = w.comboSwings[this.comboIndex % w.comboSwings.length];
    }
    this.lastSwingAt = now;
    this.meleePhase = "windup";
    this.phaseStartedAt = now;
    this.phaseDurationMs = this.windUpMs();
  }

  /** The chain continues only when the gap since the last swing is within the weapon's
   *  cooldown plus the grace window; otherwise it restarts at swing 0. Mirrors the server. */
  private advanceCombo(now: number) {
    const w = this.weapon!;
    const graceExpired = now - this.lastSwingAt > this.windUpMs() + loadOptions().comboWindowMs;
    this.comboIndex = graceExpired ? 0 : (this.comboIndex + 1) % w.comboSwings.length;
  }

  /** The wind-up hold length = the active weapon's mod-adjusted cooldown (synced per slot),
   *  falling back to the template default before the first sync lands. */
  private windUpMs(): number {
    return this.activeAttackCooldownMs || this.weapon!.attackCooldownMs;
  }

  /** Drop any in-flight swing / charge (weapon swap to non-melee, downed, or paused). */
  private resetMelee() {
    this.meleePhase = "none";
    this.charging = false;
    this.hardQueued = false;
    this.bufferedUntil = 0;
    this.windingUp = false;
  }

  /** Drive the melee pose from the machine and fire the swing arc's strip the frame it
   *  strikes. Returns true while the strike arc is on screen (so update() plays the attack
   *  clip). A no-op for ranged/AOE weapons — those keep their server-driven visuals. */
  private applyMeleePose(now: number): boolean {
    const w = this.weapon;
    if (!w || w.isRanged || w.isAoe) {
      this.windingUp = false;
      return false;
    }
    // Strike edge: pick the strip for the swing in flight, restart the arc clock, and force
    // the one-shot attack clip to (re)play even mid-combo (retrigger clears the edge latch).
    if (this.meleePhase === "strike" && this.prevMeleePhase !== "strike") {
      this.setPendingComboSwing(w.id, this.curComboStep, this.curHard);
      this.retriggerAttack();
      this.swingStartedAt = now;
    }
    this.prevMeleePhase = this.meleePhase;

    // Two cocked-back poses share the wind-up frame: an in-flight swing's own rear-back
    // (windup), and a held heavy charging AFTER a swing (telegraph, shown only while idle).
    const windingUp = this.meleePhase === "windup";
    const telegraph = this.meleePhase === "none" && this.charging;
    const hardPose = windingUp
      ? this.curHard
      : telegraph && now - this.chargeStartedAt >= loadOptions().chargeHoldMs;
    const swing = windingUp
      ? this.curSwing
      : hardPose ? w.hardSwing : w.comboSwings[0];
    this.setChargePose(windingUp || telegraph, hardPose, swing ?? null);
    this.windingUp = windingUp;
    return this.meleePhase === "strike";
  }

  // Integrate the local player's position from this frame's input, mirroring the
  // server's normalize-then-move with a per-axis wall stop (so we don't predict
  // through walls and rubber-band). Suspended while the room is paused or this
  // player is downed — those are server-driven, so we just track the server.
  private predictMovement(input: InputMessage) {
    if (this.downed || this.roomState.paused) {
      this.predicted = { x: this.serverPos.x, y: this.serverPos.y };
      return;
    }
    const len = Math.hypot(input.dx, input.dy);
    const speed = this.moveSpeed * this.speedMultiplier;
    if (len === 0 || speed <= 0) return;
    const dt = Math.min(this.scene.game.loop.delta, 100) / 1000; // clamp a hitch
    const step = speed * dt;
    const ux = (input.dx / len) * step;
    const uy = (input.dy / len) * step;
    // Per-axis, tested at the FOOT point the server collides from.
    const nx = this.predicted.x + ux;
    if (this.walkableAt(nx, this.predicted.y + FOOT_OFFSET)) this.predicted.x = nx;
    const ny = this.predicted.y + uy;
    if (this.walkableAt(this.predicted.x, ny + FOOT_OFFSET)) this.predicted.y = ny;
  }

  // Edge-detect the discrete controls (cycle weapon, open/close the pause menu)
  // into one-shot actions. Runs every frame regardless of pause so the menu can
  // be closed and weapons switched while the world is frozen.
  private handleActions() {
    const a = this.inputSource.readActions();
    if (a.nextSlot && !this.prevActions.nextSlot) this.room.send("switchWeapon", { delta: 1 });
    if (a.prevSlot && !this.prevActions.prevSlot) this.room.send("switchWeapon", { delta: -1 });
    if (a.toggleMenu && !this.prevActions.toggleMenu) this.toggleInventoryMenu();
    if (a.interact && !this.prevActions.interact) {
      // A room may hold a shrine offer, a shop, AND a room-clear reward pedestal,
      // so the order here is a tiebreak; the reward pedestal is claimed first as the
      // more consequential, free interaction.
      if (this.nearbyOffer) {
        this.openOfferPicker();
      } else if (this.nearbyReward) {
        this.room.send("claimReward", { roomId: this.nearbyReward.roomId });
      } else if (this.nearbySupply) {
        this.room.send("claimSupply", { supplyId: this.nearbySupply.supplyId });
      } else if (this.nearbyChest) {
        this.room.send("chestOpen", { roomId: this.nearbyChest.roomId });
      } else if (this.nearbyDropped) {
        this.room.send("pickupWeapon", { dropId: this.nearbyDropped.dropId });
      } else if (this.nearbyShopItem) {
        this.room.send("buy", {
          roomId: this.nearbyShopItem.roomId,
          itemIndex: this.nearbyShopItem.itemIndex,
        });
      }
    }
    this.prevActions = a;
  }

  // Open/close the inventory+stats menu (pauses the room while open).
  private toggleInventoryMenu() {
    if (this.invMenu.isOpen) {
      this.invMenu.hide();
      this.setMenuPaused(false);
      return;
    }
    this.openInventoryMenu();
  }

  /** Open the inventory. Public because the pause menu offers it as an entry —
   *  the menu key is no longer the only way in. */
  openInventoryMenu() {
    if (this.invMenu.isOpen) return;
    const ps = (this.room.state as any).players.get(this.room.sessionId);
    if (!ps) return;
    this.invMenu.show(
      Array.from(ps.weapons) as WeaponSlotView[],
      ps.activeWeaponIndex,
      Array.from(ps.upgrades) as UpgradeSlotView[],
      { flat: ps.damageFlat ?? 0, pct: ps.damagePct ?? 0 },
      () => this.setMenuPaused(false),
      (index) => this.room.send("selectWeapon", { index }),
    );
    this.setMenuPaused(true);
  }

  /** Close the topmost open overlay, if any, and report whether we did.
   *
   *  Escape used to quit the run unconditionally — "you can pause, but you can
   *  never unpause" (playtest B3), and it killed a live session. Escape now peels
   *  overlays off one at a time and only reaches the quit path on bare gameplay.
   *
   *  Dismissing the offer picker is allowed and simply takes nothing: the pedestal
   *  is not consumed (the server only grants on an `offerPick` message), so the
   *  choice stays there to walk back into. */
  closeTopOverlay(): boolean {
    if (this.offerPicker.isOpen) {
      this.offerPicker.hide();
      this.setMenuPaused(false);
      return true;
    }
    if (this.invMenu.isOpen) {
      this.invMenu.hide();
      this.setMenuPaused(false);
      return true;
    }
    return false;
  }

  /** Freeze/unfreeze the whole room. Public because the pause menu is owned by
   *  GameScene (one per screen) but the pause itself is a message on a player's
   *  own connection — there is one pause concept, not one per overlay. */
  setRoomPaused(paused: boolean) {
    this.setMenuPaused(paused);
  }

  private setMenuPaused(paused: boolean) {
    this.menuOpen = paused;
    this.room.send("setPause", { paused });
  }

  // Find the nearest unpurchased shop pedestal within buy range of this player.
  private updateShopProximity() {
    const shops = this.roomState.shops;
    if (!shops) { this.nearbyShopItem = null; return; }
    let best: LocalPlayer["nearbyShopItem"] = null;
    let bestDist = SHOP_BUY_RADIUS * SHOP_BUY_RADIUS;
    shops.forEach((shop: ShopStateView, roomId: string) => {
      shop.items.forEach((item: ShopItemStateView, idx: number) => {
        if (item.purchased) return;
        const dx = this.sprite.x - item.x;
        const dy = this.sprite.y - item.y;
        const d = dx * dx + dy * dy;
        if (d <= bestDist) {
          bestDist = d;
          best = { roomId, itemIndex: idx, weaponId: item.weaponId, cost: item.cost };
        }
      });
    });
    this.nearbyShopItem = best;
  }

  // Nearest unclaimed reward pedestal within range. Same radius as the shop so the
  // interact prompt behaves identically for both.
  private updateOfferProximity() {
    const offers = this.roomState.offers;
    if (!offers) { this.nearbyOffer = null; return; }
    let best: LocalPlayer["nearbyOffer"] = null;
    let bestDist = SHOP_BUY_RADIUS * SHOP_BUY_RADIUS;
    offers.forEach((offer: OfferStateView, roomId: string) => {
      // Nothing to offer this player if they've already taken their one pick, or
      // every card is spent (a 4th player after the party drained the set).
      const consumed = new Set(Array.from(offer.consumed) as number[]);
      const claimedBy = Array.from(offer.claimedBy) as string[];
      if (claimedBy.includes(this.room.sessionId)) return;
      if (consumed.size >= offer.choices.length) return;
      const dx = this.sprite.x - offer.x;
      const dy = this.sprite.y - offer.y;
      const d = dx * dx + dy * dy;
      if (d <= bestDist) {
        bestDist = d;
        best = {
          roomId,
          choices: Array.from(offer.choices) as OfferChoiceView[],
          consumed,
        };
      }
    });
    this.nearbyOffer = best;
  }

  // Nearest unclaimed room-clear reward pedestal within range. Same radius again,
  // so every in-world interaction in the game shares one reach.
  private updateRewardProximity() {
    const rewards = this.roomState.rewards;
    if (!rewards) { this.nearbyReward = null; return; }
    let best: LocalPlayer["nearbyReward"] = null;
    let bestDist = SHOP_BUY_RADIUS * SHOP_BUY_RADIUS;
    rewards.forEach((reward: RewardStateView, roomId: string) => {
      if (reward.claimed) return;
      const dx = this.sprite.x - reward.x;
      const dy = this.sprite.y - reward.y;
      const d = dx * dx + dy * dy;
      if (d <= bestDist) {
        bestDist = d;
        best = { roomId };
      }
    });
    this.nearbyReward = best;
  }

  // Nearest unclaimed supply pedestal within range. Same radius again. Not filtered
  // by class here — the prompt shows for anyone, and the server refuses (with an
  // on-screen error) if this class can't use the weapon.
  private updateSupplyProximity() {
    const supplies = this.roomState.supplies;
    if (!supplies) { this.nearbySupply = null; return; }
    let best: LocalPlayer["nearbySupply"] = null;
    let bestDist = SHOP_BUY_RADIUS * SHOP_BUY_RADIUS;
    supplies.forEach((reward: RewardStateView, supplyId: string) => {
      if (reward.claimed) return;
      const dx = this.sprite.x - reward.x;
      const dy = this.sprite.y - reward.y;
      const d = dx * dx + dy * dy;
      if (d <= bestDist) {
        bestDist = d;
        best = { supplyId };
      }
    });
    this.nearbySupply = best;
  }

  // Nearest unopened maze chest within range. Same radius again, so every in-world
  // interaction in the game shares one reach.
  private updateChestProximity() {
    const chests = this.roomState.chests;
    if (!chests) { this.nearbyChest = null; return; }
    let best: LocalPlayer["nearbyChest"] = null;
    let bestDist = SHOP_BUY_RADIUS * SHOP_BUY_RADIUS;
    chests.forEach((chest: ChestStateView, roomId: string) => {
      if (chest.opened) return;
      const dx = this.sprite.x - chest.x;
      const dy = this.sprite.y - chest.y;
      const d = dx * dx + dy * dy;
      if (d <= bestDist) {
        bestDist = d;
        best = { roomId };
      }
    });
    this.nearbyChest = best;
  }

  // Nearest dropped weapon within range. Same radius again, so every in-world
  // interaction in the game shares one reach. Not class-filtered here — the server
  // gates the pickup and flashes an error if this class can't use it.
  private updateDroppedProximity() {
    const dropped = this.roomState.droppedWeapons;
    if (!dropped) { this.nearbyDropped = null; return; }
    let best: LocalPlayer["nearbyDropped"] = null;
    let bestDist = SHOP_BUY_RADIUS * SHOP_BUY_RADIUS;
    dropped.forEach((drop: DroppedWeaponStateView, dropId: string) => {
      const dx = this.sprite.x - drop.x;
      const dy = this.sprite.y - drop.y;
      const d = dx * dx + dy * dy;
      if (d <= bestDist) {
        bestDist = d;
        best = { dropId };
      }
    });
    this.nearbyDropped = best;
  }

  // Open the reward picker: pause the room (same handshake the inventory menu
  // uses), then send the pick and unpause. The server re-validates proximity and
  // refuses a second claim, so a stale click can't double-grant.
  private openOfferPicker() {
    if (this.offerPicker.isOpen || !this.nearbyOffer) return;
    const { roomId, choices, consumed } = this.nearbyOffer;
    this.setMenuPaused(true);
    this.offerPicker.show(choices, consumed, this.activeWeaponView(), (index) => {
      this.room.send("offerPick", { roomId, choiceIndex: index });
      this.setMenuPaused(false);
    });
  }

  /** The local player's currently-active weapon as a WeaponView, so a pickup
   *  preview can show each stat relative to it. Null when empty-handed (the
   *  floor-1 supply room) — there is nothing to compare against yet. */
  activeWeaponView(): WeaponView | null {
    const ps = (this.room.state as GameStateView).players.get(this.room.sessionId);
    if (!ps) return null;
    const slot = Array.from(ps.weapons)[ps.activeWeaponIndex] as WeaponSlotView | undefined;
    return slot ? viewFromSlot(slot) : null;
  }

  syncFromServer(state: PlayerStateView) {
    const { weaponId, attackSeq } = state;
    this.hp = state.health;
    this.downed = state.downed;
    this.reviveProgress = state.reviveProgress;
    this.setDowned(state.downed);
    this.serverAttacking = state.isAttacking;
    this.ingestMovementState(state);
    this.checkAcquired(Array.from(state.weapons), Array.from(state.upgrades) as UpgradeSlotView[]);
    // Melee swing visuals are owned by the local machine (updateLocalMelee / applyMeleePose)
    // and IGNORE these server animation fields — that's what makes your own swing instant and
    // drift-free. Ranged/AOE keep their authoritative visuals: a new attackSeq restarts the
    // bow/cast clip (even when isAttacking never dropped on held-fire), and the wind-up pose
    // follows the synced flags. `this.weapon` is still the pre-swap weapon on a swap frame,
    // which is exactly whose animation this state belongs to.
    const melee = !!this.weapon && !this.weapon.isRanged && !this.weapon.isAoe;
    if (!melee) {
      if (attackSeq !== this.lastAttackSeq) {
        this.setPendingComboSwing(weaponId, state.comboStep, state.hardSwing);
        if (this.lastAttackSeq !== -1) this.retriggerAttack();
        this.swingStartedAt = performance.now();
      }
      if (this.weapon) this.setChargePose(...meleeWindupPose(state, this.weapon));
      const wasWindingUp = this.windingUp;
      this.windingUp = state.windingUp;
      if (wasWindingUp && !this.windingUp) this.swingStartedAt = performance.now();
    }
    // Track the sequence for both paths so a later swap to a ranged weapon can't replay a
    // stale seq as a phantom shot.
    this.lastAttackSeq = attackSeq;
    // The active weapon's tint rides on its slot (a rolled modifier's colour), and its
    // mod-adjusted cooldown drives the local wind-up hold (windUpMs) — both read from the
    // active slot so the held icon and swing timing match the composed weapon.
    const activeSlot = state.weapons.at(state.activeWeaponIndex);
    if (activeSlot) this.activeAttackCooldownMs = activeSlot.attackCooldownMs;
    const tint = activeSlot && activeSlot.tint >= 0 ? activeSlot.tint : null;
    // Active weapon changed (switch or acquire) — hot-swap the visuals + local
    // weapon so attack FX / facing-lock follow the new weapon.
    if (weaponId !== this.activeWeaponId) {
      const w = resolveWeapon(weaponId);
      if (w) {
        this.activeWeaponId = weaponId;
        this.weapon = w;
        this.swapWeapon(w.fxType, w.id, w.rangedStyle, tint);
        // A different weapon drops any in-flight local swing and resets the combo chain —
        // its cooldown and combo don't carry over from the last one.
        this.resetMelee();
        this.comboIndex = 0;
        this.lastSwingAt = -Infinity;
        this.prevMeleePhase = "none";
      }
    } else {
      this.setWeaponTint(tint);
    }
    // Reconcile prediction against the authoritative position. The client owns its
    // visual position frame-to-frame (setPosition happens in update from `predicted`);
    // here we only correct it. Small gaps are the legitimate latency lead and are
    // left alone; a large gap is a real divergence the client couldn't predict
    // (knockback, enemy separation, a teleport/blink, a wall we clipped) — snap.
    this.serverPos = { x: state.x, y: state.y };
    this.moveSpeed = state.moveSpeed || this.character.speed;
    this.speedMultiplier = state.speedMultiplier ?? 1;
    if (Math.hypot(state.x - this.predicted.x, state.y - this.predicted.y) > RECONCILE_SNAP_PX) {
      this.predicted = { x: state.x, y: state.y };
      this.setPosition(state.x, state.y);
    }
    // Track the SYNCED max HP so +max-HP upgrades move the bar's full mark — the
    // character base is only the starting value, and leaving it fixed made a
    // buffed player's bar read past full (looked like HP grew without limit).
    if (state.maxHp) this.maxHp = state.maxHp;
    this.updateHpBar(state.health);
  }

  // Fire the Zelda-style acquire flourish for any weapon or upgrade that's newly
  // held since the last sync, and briefly freeze the player.
  //
  // Weapons are keyed on the per-instance uid, NOT the weapon id: two broadswords
  // with different rolls are two different weapons, and an id-based diff would
  // silently swallow the second pickup. Pruning to the current set also means a
  // future drop-weapon would re-flourish if you picked the same one back up.
  //
  // Upgrades have no uid but their array is append-only, so anything past
  // `knownUpgradeCount` is new — this handles duplicate ids (two Ferocitys) that a
  // Set would swallow. An upgrade flourish carries the buff's description so the
  // player learns what it does at the moment of the pick.
  private checkAcquired(weapons: WeaponSlotView[], upgrades: UpgradeSlotView[]) {
    for (const slot of weapons) {
      if (this.knownWeaponUids.has(slot.uid)) continue;
      this.knownWeaponUids.add(slot.uid);
      // The starting weapon is already in the first sync — don't flourish it.
      if (!this.sawFirstSync) continue;
      // The flourish (icon + text panel) plays, but the player is NOT frozen —
      // stopping movement for the acquire beat felt like a hitch.
      AcquireFX.weapon(this.scene, this.sprite, slot);
    }
    this.knownWeaponUids = new Set(weapons.map(w => w.uid));

    for (let i = this.knownUpgradeCount; i < upgrades.length; i++) {
      // Any upgrades in the first sync are pre-owned — don't flourish them.
      if (!this.sawFirstSync) continue;
      AcquireFX.upgrade(this.scene, this.sprite, upgrades[i]);
    }
    this.knownUpgradeCount = upgrades.length;

    this.sawFirstSync = true;
  }

  collectDebugShapes(): DebugShape[] {
    return [
      this.bodyDebugCircle(DEBUG_COLORS.playerBody),
      hurtBoxShape(PLAYER_HURT_BOUNDS, this.sprite.x, this.sprite.y),
      ...(this.weapon && !this.windingUp
        ? meleeHurtboxShapes(this.weapon, this.sprite.x, this.sprite.y, this.facing, performance.now() - this.swingStartedAt)
        : []),
    ];
  }
}
