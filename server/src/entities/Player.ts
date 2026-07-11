import { InputMessage, CharacterClass, CharacterType, CharacterConfig, getCharacterConfig, WeaponId, Weapon, WEAPON_REGISTRY, PLAYER_BODY_PROFILE } from "shared";
import { PlayerState } from "../schema/PlayerState";
import { Entity } from "./Entity";
import { PhysicsWorld } from "../physics/PhysicsWorld";

export class Player extends Entity {
  state: PlayerState;
  readonly charConfig: CharacterConfig;
  // Owned weapon ids + the index of the active one. `weapon` derives from these
  // so all existing `player.weapon` reads transparently follow the active slot.
  readonly inventory: string[] = [];
  private activeIndex = 0;
  lastInput: InputMessage = { dx: 0, dy: 0, attack: false };
  // Set true on the tick a new swing/shot starts; GameRoom reads it to spawn a
  // projectile for ranged weapons, then clears it.
  justAttacked = false;
  private attackCooldown: number = 0;
  private hitThisSwing = new Set<string>();
  // Previous tick's attack-button state, for rising-edge detection (melee fires
  // once per press; ranged auto-fires while held).
  private prevAttack = false;

  constructor(
    physics: PhysicsWorld,
    startX: number,
    startY: number,
    characterClass: CharacterClass = "knight",
    characterType: CharacterType = "guy",
    weaponId?: WeaponId,
  ) {
    super();
    this.charConfig = getCharacterConfig(characterClass);
    const resolvedWeaponId = weaponId ?? this.charConfig.defaultWeaponId;
    const startWeapon = WEAPON_REGISTRY[resolvedWeaponId] ?? WEAPON_REGISTRY["broadsword"];
    this.inventory.push(startWeapon.id);
    this.state = new PlayerState();
    this.state.x = startX;
    this.state.y = startY;
    this.state.health = this.charConfig.maxHp;
    this.state.characterClass = characterClass;
    this.state.characterType = characterType;
    this.state.weaponId = startWeapon.id;
    this.state.inventory.push(startWeapon.id);
    this.state.activeWeaponIndex = 0;
    this.attachBody(physics, startX, startY, PLAYER_BODY_PROFILE);
  }

  get maxHp(): number {
    return this.charConfig.maxHp;
  }

  /** The active weapon — derived from the inventory + active slot. */
  get weapon(): Weapon {
    return WEAPON_REGISTRY[this.inventory[this.activeIndex]] ?? WEAPON_REGISTRY["broadsword"];
  }

  /** Cycle the active weapon by `delta` (wraps). Does NOT reset attackCooldown —
   *  switching mid-cooldown can't be used to fire faster. */
  switchWeapon(delta: number): void {
    const n = this.inventory.length;
    if (n <= 1) return;
    this.activeIndex = (((this.activeIndex + delta) % n) + n) % n;
    this.state.activeWeaponIndex = this.activeIndex;
    this.state.weaponId = this.weapon.id;
  }

  /** Spend HP (store purchases). Never lethal — floors at 1 (callers also gate
   *  on health > cost). Direct state edit: no knockback/death, unlike takeDamage. */
  spendHp(amount: number): void {
    this.state.health = Math.max(1, this.state.health - amount);
  }

  /** Add a weapon to the inventory. Returns true if it was newly acquired
   *  (already-owned weapons are ignored, so the acquire FX fires only once). */
  addWeapon(id: string): boolean {
    if (this.inventory.includes(id)) return false;
    this.inventory.push(id);
    this.state.inventory.push(id);
    return true;
  }

  applyInput(input: InputMessage, dtMs: number): void {
    const risingEdge = input.attack && !this.prevAttack;
    // While a ranged weapon is held down we freeze facing so you can strafe /
    // back away while keeping your aim — except on the first frame of the press,
    // which still turns you toward the direction you're moving so you can aim.
    const facingLocked = this.weapon.isRanged && input.attack && !risingEdge;
    if (!facingLocked) {
      if (input.dx > 0) this.state.facing = "right";
      else if (input.dx < 0) this.state.facing = "left";
      else if (input.dy > 0) this.state.facing = "down";
      else if (input.dy < 0) this.state.facing = "up";
    }

    this.move(input.dx, input.dy, this.charConfig.speed);

    if (this.attackCooldown > 0) {
      this.attackCooldown -= dtMs;
      if (this.attackCooldown <= 0) {
        this.state.isAttacking = false;
        this.attackCooldown = 0;
      }
    }

    // Ranged weapons auto-fire while the button is held; melee only fires on the
    // rising edge, so you can't hold to chain-swing.
    const wantsToFire = this.weapon.isRanged ? input.attack : risingEdge;
    if (wantsToFire && this.attackCooldown <= 0) {
      this.state.isAttacking = true;
      this.state.attackSeq = (this.state.attackSeq + 1) % 65536;
      this.hitThisSwing.clear();
      this.attackCooldown = this.weapon.attackCooldownMs;
      this.justAttacked = true;
    }

    this.prevAttack = input.attack;
  }

  // Fire direction in radians derived from facing (right=0, down=+π/2,
  // left=π, up=−π/2). Matches screen coords where +y points down.
  getShotAngle(): number {
    switch (this.state.facing) {
      case "right": return 0;
      case "down":  return Math.PI / 2;
      case "left":  return Math.PI;
      case "up":    return -Math.PI / 2;
    }
  }

  tryHitEnemy(enemyId: string, ex: number, ey: number): boolean {
    if (this.hitThisSwing.has(enemyId)) return false;
    if (!this.hitsEnemy(ex, ey)) return false;
    this.hitThisSwing.add(enemyId);
    return true;
  }

  getAttackHitbox(): { x: number; y: number; w: number; h: number } | null {
    if (!this.state.isAttacking) return null;
    const box = this.weapon.getHurtbox(this.state.x, this.state.y, this.state.facing);
    if (!box || box.shape !== "rect") return null;
    return { x: box.x, y: box.y, w: box.w, h: box.h };
  }

  hitsEnemy(ex: number, ey: number): boolean {
    const box = this.getAttackHitbox();
    if (!box) return false;
    return (
      ex >= box.x && ex <= box.x + box.w &&
      ey >= box.y && ey <= box.y + box.h
    );
  }
}
