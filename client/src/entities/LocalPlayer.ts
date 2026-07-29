import Phaser from "phaser";
import { Room } from "colyseus.js";
import {
  InputMessage, CharacterClass, CharacterType, Character, getCharacter,
  WeaponId, Weapon, WeaponView, WeaponSlotView, UpgradeSlotView, WEAPON_REGISTRY, Facing,
  GameStateView, PlayerStateView, ShopStateView, ShopItemStateView, OfferStateView, RewardStateView, ChestStateView,
  PLAYER_HURT_BOUNDS,
} from "shared";
import { Entity } from "./Entity";
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

export class LocalPlayer extends Entity implements DebugDrawable {
  readonly room: Room;
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
  private lastInput: InputMessage = { dx: 0, dy: 0, attack: false, ability: false };
  private facing: Facing = "down";
  private prevAttack = false;
  // Attack visuals are driven by the server (authoritative about which presses
  // actually become attacks) so cooldown-rejected presses don't restart the
  // swing clip and held-fire replays the bow each shot — matching RemotePlayer.
  /** When the current swing's animation began (performance.now()), so the debug
   *  overlay can ask the weapon for the hurtbox of the frame on screen right now.
   *  -Infinity until the first swing, which reads as "animation long over". */
  private swingStartedAt = -Infinity;
  // Mid melee wind-up (holding the cocked-back pose before the strike) — suppresses
  // the debug hurtbox and marks where the swing arc's clock restarts.
  private windingUp = false;
  private serverAttacking = false;
  private lastAttackSeq = -1;
  hp: number;
  downed = false;
  reviveProgress = 0;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    room: Room,
    inputSource: InputSource,
    characterClass: CharacterClass = "knight",
    characterType: CharacterType = "guy",
  ) {
    const character = getCharacter(characterClass);
    const visualDef = CLIENT_CHARACTER_VISUAL_REGISTRY[characterType];
    super(scene, x, y, 0x63b3ed, character.maxHp);
    this.character = character;
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
      this.handleActions();
    }

    if (
      input.dx !== this.lastInput.dx ||
      input.dy !== this.lastInput.dy ||
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
      if (input.dx > 0) this.facing = "right";
      else if (input.dx < 0) this.facing = "left";
      else if (input.dy > 0) this.facing = "down";
      else if (input.dy < 0) this.facing = "up";
    }
    this.prevAttack = input.attack;

    const isMoving = input.dx !== 0 || input.dy !== 0;
    const action = this.serverAttacking ? "attack" : isMoving ? "walk" : "idle";
    this.playAnim(action, this.facing);
    this.renderMovementFX();
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
    // A new attackSeq means the server accepted a fresh attack — restart the
    // swing/bow clip even if isAttacking never dropped (held-fire).
    if (attackSeq !== this.lastAttackSeq) {
      this.setPendingComboSwing(weaponId, state.comboStep, state.hardSwing);
      if (this.lastAttackSeq !== -1) this.retriggerAttack();
      this.lastAttackSeq = attackSeq;
      this.swingStartedAt = performance.now();
    }
    // Hold the cocked-back first swing frame for both melee poses: the swing's own
    // wind-up BEFORE the blow (windingUp) and the heavy charge held AFTER it. No
    // weapon yet (before the first supply pickup) means nothing to pose.
    if (this.weapon) this.setChargePose(...meleeWindupPose(state, this.weapon));
    // The swing arc's animation clock starts at the STRIKE (the end of the wind-up),
    // not the press — so the debug hurtbox lines up with the frame the resolver
    // actually hit against. attackSeq set it at the press for fast (0ms) weapons.
    const wasWindingUp = this.windingUp;
    this.windingUp = state.windingUp;
    if (wasWindingUp && !this.windingUp) this.swingStartedAt = performance.now();
    // Active weapon changed (switch or acquire) — hot-swap the visuals + local
    // weapon so attack FX / facing-lock follow the new weapon.
    if (weaponId !== this.activeWeaponId) {
      const w = WEAPON_REGISTRY[weaponId as WeaponId];
      if (w) {
        this.activeWeaponId = weaponId;
        this.weapon = w;
        this.swapWeapon(w.fxType, w.id, w.rangedStyle);
      }
    }
    this.setPosition(state.x, state.y);
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
