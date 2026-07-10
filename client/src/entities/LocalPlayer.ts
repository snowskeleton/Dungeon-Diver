import Phaser from "phaser";
import { Room } from "colyseus.js";
import { InputMessage, CharacterClass, CharacterType, CharacterConfig, getCharacterConfig, WeaponId, Weapon, WEAPON_REGISTRY, Facing } from "shared";
import { Entity } from "./Entity";
import { InputSource, InputActions } from "../input/InputSource";
import { CLIENT_CHARACTER_VISUAL_REGISTRY } from "../characters";
import { DebugDrawable, DebugShape, DEBUG_COLORS } from "../debug/DebugDraw";
import { meleeHurtboxShapes } from "../debug/hurtboxShapes";
import { AcquireFX, ACQUIRE_MS } from "./AcquireFX";
import { InventoryMenu } from "../ui/InventoryMenu";

// Must match GameRoom BUY_RADIUS so the client prompt appears exactly when the
// server will accept the purchase.
const SHOP_BUY_RADIUS = 40;

export class LocalPlayer extends Entity implements DebugDrawable {
  readonly room: Room;
  readonly inputSource: InputSource;
  readonly charConfig: CharacterConfig;
  // The active weapon, swapped when the server reports an activeWeaponIndex change.
  weapon: Weapon;
  private activeWeaponId: string;
  private prevActions: InputActions = { prevSlot: false, nextSlot: false, toggleMenu: false, interact: false };
  private menuOpen = false;
  private invMenu = new InventoryMenu();
  // Owned weapon ids as last seen — a newly-appearing id triggers the acquire
  // flourish. Seeded with the starting weapon so joining doesn't fire it.
  private knownInventory: string[];
  // While now < this, the player's input is frozen (Zelda item-get beat).
  private inputLockedUntil = 0;
  // The shop pedestal this player is currently standing on (if any) — drives the
  // store stats card and the interact-to-buy action. Must match server BUY_RADIUS.
  nearbyShopItem: { roomId: string; itemIndex: number; weaponId: string; cost: number } | null = null;
  private lastInput: InputMessage = { dx: 0, dy: 0, attack: false };
  private facing: Facing = "down";
  private prevAttack = false;
  // Attack visuals are driven by the server (authoritative about which presses
  // actually become attacks) so cooldown-rejected presses don't restart the
  // swing clip and held-fire replays the bow each shot — matching RemotePlayer.
  private serverAttacking = false;
  private lastAttackSeq = -1;
  hp: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    room: Room,
    inputSource: InputSource,
    characterClass: CharacterClass = "knight",
    characterType: CharacterType = "guy",
    weaponId?: WeaponId,
  ) {
    const cfg = getCharacterConfig(characterClass);
    const visualDef = CLIENT_CHARACTER_VISUAL_REGISTRY[characterType];
    const resolvedWeaponId = weaponId ?? cfg.defaultWeaponId;
    const weapon = WEAPON_REGISTRY[resolvedWeaponId] ?? WEAPON_REGISTRY["broadsword"];
    super(scene, x, y, 0x63b3ed, cfg.maxHp);
    this.charConfig = cfg;
    this.weapon = weapon;
    this.activeWeaponId = weapon.id;
    this.knownInventory = [weapon.id];
    this.hp = cfg.maxHp;
    this.room = room;
    this.inputSource = inputSource;
    this.setupCharacter(visualDef.spriteConfig, weapon.fxType, weapon.id, weapon.rangedStyle);
  }

  update() {
    // During the acquire flourish (or any input lock) the player is frozen in
    // place: zero the input and skip shop/menu actions.
    const locked = performance.now() < this.inputLockedUntil;
    const input = locked ? { dx: 0, dy: 0, attack: false } : this.inputSource.read();
    if (!locked) {
      this.updateShopProximity();
      this.handleActions();
    }

    if (
      input.dx !== this.lastInput.dx ||
      input.dy !== this.lastInput.dy ||
      input.attack !== this.lastInput.attack
    ) {
      this.room.send("input", input);
      this.lastInput = { ...input };
    }

    // Mirror the server's facing rule (Player.applyInput) so the local sprite
    // faces the same way with no round-trip: a held ranged weapon freezes facing
    // (after the first frame) so strafing keeps your aim; movement still turns
    // you otherwise.
    const risingEdge = input.attack && !this.prevAttack;
    const facingLocked = this.weapon.isRanged && input.attack && !risingEdge;
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
  }

  // Edge-detect the discrete controls (cycle weapon, open/close the pause menu)
  // into one-shot actions. Runs every frame regardless of pause so the menu can
  // be closed and weapons switched while the world is frozen.
  private handleActions() {
    const a = this.inputSource.readActions();
    if (a.nextSlot && !this.prevActions.nextSlot) this.room.send("switchWeapon", { delta: 1 });
    if (a.prevSlot && !this.prevActions.prevSlot) this.room.send("switchWeapon", { delta: -1 });
    if (a.toggleMenu && !this.prevActions.toggleMenu) this.toggleInventoryMenu();
    if (a.interact && !this.prevActions.interact && this.nearbyShopItem) {
      this.room.send("buy", {
        roomId: this.nearbyShopItem.roomId,
        itemIndex: this.nearbyShopItem.itemIndex,
      });
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
    const ps = (this.room.state as any).players.get(this.room.sessionId);
    if (!ps) return;
    this.invMenu.show(Array.from(ps.inventory) as string[], ps.activeWeaponIndex, () => this.setMenuPaused(false));
    this.setMenuPaused(true);
  }

  private setMenuPaused(paused: boolean) {
    this.menuOpen = paused;
    this.room.send("setPause", { paused });
  }

  // Find the nearest unpurchased shop pedestal within buy range of this player.
  private updateShopProximity() {
    const shops = (this.room.state as any).shops;
    if (!shops) { this.nearbyShopItem = null; return; }
    let best: LocalPlayer["nearbyShopItem"] = null;
    let bestDist = SHOP_BUY_RADIUS * SHOP_BUY_RADIUS;
    shops.forEach((shop: any, roomId: string) => {
      shop.items.forEach((item: any, idx: number) => {
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

  syncFromServer(x: number, y: number, hp: number, isAttacking: boolean, attackSeq: number, weaponId: string, inventory: string[]) {
    this.hp = hp;
    this.serverAttacking = isAttacking;
    this.checkAcquired(inventory);
    // A new attackSeq means the server accepted a fresh attack — restart the
    // swing/bow clip even if isAttacking never dropped (held-fire).
    if (attackSeq !== this.lastAttackSeq) {
      if (this.lastAttackSeq !== -1) this.retriggerAttack();
      this.lastAttackSeq = attackSeq;
    }
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
    this.setPosition(x, y);
    this.updateHpBar(hp);
  }

  // Fire the Zelda-style acquire flourish for any weapon that's newly in the
  // inventory since the last sync, and briefly freeze the player.
  private checkAcquired(inventory: string[]) {
    for (const id of inventory) {
      if (this.knownInventory.includes(id)) continue;
      new AcquireFX(this.scene, this.sprite, id);
      this.inputLockedUntil = performance.now() + ACQUIRE_MS;
    }
    this.knownInventory = [...inventory];
  }

  collectDebugShapes(): DebugShape[] {
    return [
      this.bodyDebugCircle(DEBUG_COLORS.playerBody),
      ...meleeHurtboxShapes(this.weapon, this.sprite.x, this.sprite.y, this.facing, this.lastInput.attack),
    ];
  }
}
