import {
  InputMessage, CharacterClass, CharacterType, CharacterConfig, getCharacterConfig,
  WeaponId, Weapon, WeaponInstance, WeaponMod, WEAPON_REGISTRY, AMMO_REGISTRY,
  PLAYER_BODY_PROFILE, PLAYER_ATTACK_AFFECTS, Facing, Attack, foldStat,
} from "shared";
import { PlayerState, UpgradeSlotState } from "../schema/PlayerState";
import { WeaponSlotState } from "../schema/WeaponSlotState";
import { Entity } from "./Entity";
import { Spell, SpellCaster, Caster, AimPoint, AttackStats, weaponSpell } from "../spells";
import { Upgrade, StatContributor } from "../upgrades";
import { PhysicsWorld } from "../physics/PhysicsWorld";

/** A player's folded stats: base character config + every StatContributor it holds.
 *  Recomputed on change, never per tick — the fold is cheap but it is not free, and
 *  more importantly a cached value is one obvious number to inspect when balancing. */
interface PlayerStats {
  maxHp: number;
  speed: number;
  damageFlat: number;
  damagePct: number;
  armorFlat: number;
  armorPct: number;
  lifestealPct: number;
}

export class Player extends Entity implements Caster {
  state: PlayerState;
  readonly charConfig: CharacterConfig;
  // Wielded weapon INSTANCES (not registry templates): each carries its own
  // modifiers, so two players — or two slots — holding "a broadsword" can differ.
  // Named `weapons` rather than `inventory` because other item lists are coming.
  readonly weapons: WeaponInstance[] = [];
  /** Run-scoped boons. Active abilities will live in this same list. */
  readonly upgrades: Upgrade[] = [];
  private activeIndex = 0;
  // Monotonic, scoped to this player — enough to tell two identical weapons apart,
  // which is all the uid is for (spell cache key + the client's acquire diff).
  private uidCounter = 0;
  private stats: PlayerStats;
  lastInput: InputMessage = { dx: 0, dy: 0, attack: false };
  // Runs the active weapon's spell (the swing/shot lifecycle) — the same shared
  // runner bosses use. Attacks are just zero-wind-up spells now.
  private readonly spellCaster = new SpellCaster();
  // One persistent Spell per owned weapon INSTANCE (built on first use), so its
  // per-swing dedupe state lives with that specific weapon. Keyed by uid rather
  // than weapon id so two copies of the same weapon don't share a RehitGate.
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
    this.state = new PlayerState();
    this.state.x = startX;
    this.state.y = startY;
    this.state.characterClass = characterClass;
    this.state.characterType = characterType;
    this.state.activeWeaponIndex = 0;

    this.stats = this.foldStats();
    this.state.health = this.stats.maxHp;
    this.state.maxHp = this.stats.maxHp;

    const startTemplate = resolveTemplate(weaponId) ?? resolveTemplate(this.charConfig.defaultWeaponId)!;
    this.addWeapon(startTemplate);
    this.attachBody(physics, startX, startY, PLAYER_BODY_PROFILE);
  }

  // ── Folded stats (base + every contributor) ──────────────────────────────────
  // Upgrades are the only contributors today; worn equipment will join this list
  // without the fold itself changing, which is why it iterates a generic array.
  private get contributors(): StatContributor[] {
    return this.upgrades;
  }

  private foldStats(): PlayerStats {
    const sum = (pick: (c: StatContributor) => number) =>
      this.contributors.reduce((acc, c) => acc + pick(c), 0);

    return {
      maxHp: Math.max(1, Math.round(foldStat(this.charConfig.maxHp, sum(c => c.maxHpFlat), sum(c => c.maxHpPct)))),
      speed: foldStat(this.charConfig.speed, sum(c => c.speedFlat), sum(c => c.speedPct)),
      damageFlat: sum(c => c.damageFlat),
      damagePct: sum(c => c.damagePct),
      armorFlat: sum(c => c.armorFlat),
      armorPct: sum(c => c.armorPct),
      lifestealPct: sum(c => c.lifestealPct),
    };
  }

  /** Re-fold after the contributor list changes. A max-HP increase GRANTS the
   *  delta to current health rather than preserving the percentage: preserving
   *  the ratio would heal a nearly-dead player almost nothing, making a +max-HP
   *  pick feel worse than a plain heal at the exact moment it should feel good. */
  private recomputeStats(): void {
    const prevMax = this.stats.maxHp;
    this.stats = this.foldStats();
    const delta = this.stats.maxHp - prevMax;
    if (delta > 0) this.state.health += delta;
    this.state.health = Math.min(this.state.health, this.stats.maxHp);
    this.state.maxHp = this.stats.maxHp;
  }

  get maxHp(): number {
    return this.stats.maxHp;
  }

  get speed(): number {
    return this.stats.speed;
  }

  /** The active weapon instance — derived from the weapon list + active slot. */
  get weapon(): WeaponInstance {
    return this.weapons[this.activeIndex] ?? this.weapons[0];
  }

  // ── Caster interface (x/y/emitHitSource/spawnProjectile come from Entity) ─────
  get facing(): Facing {
    return this.state.facing;
  }
  get attackAffects(): number {
    return PLAYER_ATTACK_AFFECTS;
  }

  /** Stage 3 of the attack pipeline: the player's own offensive scaling. This is
   *  the ONLY override of the pipeline in the game — every weapon, ability, and
   *  shot routes through it, so an upgrade reaches all of them at once. */
  override scaleAttack(base: AttackStats): AttackStats {
    return {
      damage: foldStat(base.damage, this.stats.damageFlat, this.stats.damagePct),
      knockback: base.knockback,
    };
  }

  /** Stage 4, incoming: armor mitigates before the hit lands. Floored at 1 so no
   *  amount of stacking makes a player untouchable. Knockback is deliberately NOT
   *  mitigated — being shoved is a positioning problem, not a damage one. */
  override takeHit(attack: Attack): number {
    const reduced = attack.damage * (1 - this.stats.armorPct) - this.stats.armorFlat;
    return super.takeHit({ ...attack, damage: Math.max(1, reduced) });
  }

  /** Lifesteal. Called with the damage actually dealt, so it can't be gamed by
   *  overkill or by hitting something that mitigated most of the blow. */
  onDamageDealt(damage: number): void {
    if (this.stats.lifestealPct <= 0 || damage <= 0) return;
    this.heal(damage * this.stats.lifestealPct);
  }

  heal(amount: number): void {
    this.state.health = Math.min(this.stats.maxHp, this.state.health + amount);
  }

  /** Cycle the active weapon by `delta` (wraps). Does NOT reset the attack — you
   *  can't switch mid-swing to fire faster (the in-flight cast keeps running). */
  switchWeapon(delta: number): void {
    const n = this.weapons.length;
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

  /** Mint a weapon instance from a template and add it. Duplicates are allowed —
   *  two broadswords with different rolls are two different weapons, which is the
   *  whole point of instancing. Returns the new instance. */
  addWeapon(template: Weapon, mods: WeaponMod[] = []): WeaponInstance {
    const inst = new WeaponInstance(template, `w${this.uidCounter++}`, mods);
    this.weapons.push(inst);
    this.state.weapons.push(slotStateFor(inst));
    if (this.weapons.length === 1) {
      this.state.weaponId = inst.id;
    }
    return inst;
  }

  /** True when an unmodified copy of this template is already held. Distinct from
   *  "owns this weapon at all": once weapons roll modifiers, a second copy of the
   *  same template is a genuinely different weapon and shouldn't be refused. */
  ownsUnmodified(templateId: string): boolean {
    return this.weapons.some(w => w.id === templateId && !w.isModified);
  }

  /** Grant an upgrade and re-fold. */
  addUpgrade(upgrade: Upgrade): void {
    this.upgrades.push(upgrade);
    const slot = new UpgradeSlotState();
    slot.id = upgrade.id;
    slot.name = upgrade.name;
    slot.description = upgrade.description;
    this.state.upgrades.push(slot);
    this.recomputeStats();
  }

  // The persistent Spell for a weapon instance (built once, cached so its swing
  // dedupe state persists across swings). The spell reads its weapon's stats live,
  // so a modifier acquired after this was built still applies.
  private spellFor(inst: WeaponInstance): Spell {
    let spell = this.weaponSpells.get(inst.uid);
    if (!spell) {
      spell = weaponSpell(inst);
      this.weaponSpells.set(inst.uid, spell);
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

    this.move(input.dx, input.dy, this.stats.speed);

    // Advance an in-flight attack; then — the same tick it finishes — a held/pressed
    // attack may start the next one, so the cadence is exactly the weapon's cooldown.
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

/** Look up a weapon template, rejecting anything that isn't a real weapon id.
 *  The join-time weapon id arrives from the client, so it is untrusted input. */
export function resolveTemplate(id: string | undefined): Weapon | undefined {
  if (!id) return undefined;
  return WEAPON_REGISTRY[id];
}

/** Project a weapon instance onto the wire: resolved stats, plus the mod labels
 *  that explain them. See WeaponSlotState for why it isn't the modifiers. */
export function slotStateFor(inst: WeaponInstance): WeaponSlotState {
  const slot = new WeaponSlotState();
  slot.uid = inst.uid;
  slot.weaponId = inst.id;
  slot.damage = inst.damage;
  slot.attackCooldownMs = Math.round(inst.attackCooldownMs);
  slot.attackForce = inst.attackForce;
  const ammo = inst.ammoId ? AMMO_REGISTRY[inst.ammoId] : undefined;
  if (ammo) {
    // The shot's damage is the ammo's plus the weapon's, matching what the ranged
    // spell actually fires — so the panel and the projectile can't disagree.
    slot.ammoDamage = ammo.damage + inst.damage;
    slot.ammoSpeed = ammo.speed;
    slot.ammoPierce = ammo.pierce;
    slot.ammoKnockback = ammo.knockback;
  }
  for (const label of inst.modLabels) {
    slot.modLabels.push(label);
  }
  return slot;
}
