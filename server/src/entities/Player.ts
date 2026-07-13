import {
  InputMessage, CharacterClass, CharacterType, CharacterConfig, getCharacterConfig,
  WeaponId, Weapon, WEAPON_REGISTRY, PLAYER_BODY_PROFILE, PLAYER_ATTACK_AFFECTS, Facing,
} from "shared";
import { PlayerState } from "../schema/PlayerState";
import { Entity } from "./Entity";
import { Spell, SpellCaster, Caster, AimPoint, weaponSpell } from "../spells";
import { PhysicsWorld } from "../physics/PhysicsWorld";

export class Player extends Entity implements Caster {
  state: PlayerState;
  readonly charConfig: CharacterConfig;
  // Owned weapon ids + the index of the active one. `weapon` derives from these
  // so all existing `player.weapon` reads transparently follow the active slot.
  readonly inventory: string[] = [];
  private activeIndex = 0;
  lastInput: InputMessage = { dx: 0, dy: 0, attack: false };
  // Runs the active weapon's spell (the swing/shot lifecycle) — the same shared
  // runner bosses use. Attacks are just zero-wind-up spells now.
  private readonly spellCaster = new SpellCaster();
  // One persistent Spell per owned weapon (built on first use), so its per-swing
  // dedupe state lives with it.
  private readonly weaponSpells = new Map<string, Spell>();
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

  // ── Caster interface (x/y/emitHitSource/spawnProjectile come from Entity) ─────
  get facing(): Facing {
    return this.state.facing;
  }
  get attackAffects(): number {
    return PLAYER_ATTACK_AFFECTS;
  }

  /** Cycle the active weapon by `delta` (wraps). Does NOT reset the attack — you
   *  can't switch mid-swing to fire faster (the in-flight cast keeps running). */
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

  // The persistent Spell for a weapon (built once, cached so its swing dedupe state
  // persists across swings).
  private spellFor(weapon: Weapon): Spell {
    let spell = this.weaponSpells.get(weapon.id);
    if (!spell) {
      spell = weaponSpell(weapon);
      this.weaponSpells.set(weapon.id, spell);
    }
    return spell;
  }

  // A point in the facing direction — a ranged spell turns it into the shot angle.
  private facingAim(): AimPoint {
    const d = 100;
    switch (this.state.facing) {
      case "right": return { x: this.state.x + d, y: this.state.y };
      case "left":  return { x: this.state.x - d, y: this.state.y };
      case "down":  return { x: this.state.x, y: this.state.y + d };
      case "up":    return { x: this.state.x, y: this.state.y - d };
    }
  }

  applyInput(input: InputMessage, dtMs: number): void {
    this.spellCaster.tickClock(dtMs);

    // Hitstun freezes control — movement, attack, facing all pause — while the
    // knockback impulse (carried by commitVelocity) sweeps the player. The in-flight
    // cast is frozen too. prevAttack is tracked so a held attack doesn't auto-fire
    // the instant stun ends.
    if (this.updateStun(dtMs)) {
      this.prevAttack = input.attack;
      return;
    }

    const risingEdge = input.attack && !this.prevAttack;
    const weapon = this.weapon;
    const spell = this.spellFor(weapon);

    // Ranged weapons freeze facing while held so you can strafe under your aim —
    // except the first press frame, which still turns you to aim.
    const facingLocked = weapon.isRanged && input.attack && !risingEdge;
    if (!facingLocked) {
      if (input.dx > 0) this.state.facing = "right";
      else if (input.dx < 0) this.state.facing = "left";
      else if (input.dy > 0) this.state.facing = "down";
      else if (input.dy < 0) this.state.facing = "up";
    }

    this.move(input.dx, input.dy, this.charConfig.speed);

    // Advance an in-flight attack; then — the same tick it finishes — a held/pressed
    // attack may start the next one, so the cadence matches the old attack cooldown.
    const aim = this.facingAim();
    if (this.spellCaster.busy) {
      this.spellCaster.update(this, dtMs, aim);
    }
    if (!this.spellCaster.busy) {
      const wantsToFire = spell.fireMode === "hold" ? input.attack : risingEdge;
      if (wantsToFire && spell.isReady(this.spellCaster.now)) {
        this.state.attackSeq = (this.state.attackSeq + 1) % 65536;
        this.spellCaster.begin(spell, aim);
        this.spellCaster.update(this, dtMs, aim); // zero wind-up: strike this tick
      }
    }
    // isAttacking tracks the cast: true through the swing/shot window (drives the
    // client attack animation), false when idle.
    this.state.isAttacking = this.spellCaster.busy;

    this.prevAttack = input.attack;
  }
}
