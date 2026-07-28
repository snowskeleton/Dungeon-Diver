import {
  InputMessage, CharacterClass, CharacterType, Character, getCharacter,
  Weapon, WeaponInstance, WeaponMod, WEAPON_REGISTRY, AMMO_REGISTRY,
  PLAYER_BODY_PROFILE, PLAYER_ATTACK_AFFECTS, Facing, Attack, foldStat,
  ComboSwing, DEFAULT_COMBO_WINDOW_MS, DEFAULT_CHARGE_HOLD_MS,
  canClassUseWeapon,
} from "shared";
import { PlayerState, UpgradeSlotState } from "../schema/PlayerState";
import { WeaponSlotState } from "../schema/WeaponSlotState";
import { Entity } from "./Entity";
import { Spell, SpellCaster, Caster, AimPoint, AttackStats, weaponSpell } from "../spells";
import { Upgrade, StatContributor } from "../upgrades";
import { PhysicsWorld } from "../physics/PhysicsWorld";

/** A player's folded stats: base Character stats + every StatContributor it holds.
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
  readonly character: Character;
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
  // Melee combo state. comboIndex walks 0→1→2→0 across consecutive swings; it
  // resets to the first swing whenever the chain window lapses (see advanceCombo).
  // lastSwingAt is the caster-clock time the previous melee swing began.
  private comboIndex = 0;
  private lastSwingAt = -Infinity;
  // The chain grace beyond the weapon's cooldown, in ms. A per-player preference
  // the client sends from its Options; defaults until one arrives.
  private comboWindowMs = DEFAULT_COMBO_WINDOW_MS;
  // Deferred melee: a press holds a wind-up (charging) that fires on release.
  // chargeMs accumulates the hold; past chargeHoldMs the release is a hard swing.
  // pendingHard records which kind the swing now in flight is, for meleeCombo.
  private charging = false;
  private chargeMs = 0;
  private chargeHoldMs = DEFAULT_CHARGE_HOLD_MS;
  // hardQueued: the button was released past the charge threshold, so a hard swing
  // is waiting to fire the moment the weapon is free (its cooldown may still run).
  private hardQueued = false;
  private pendingHard = false;

  constructor(
    physics: PhysicsWorld,
    startX: number,
    startY: number,
    characterClass: CharacterClass = "knight",
    characterType: CharacterType = "guy",
  ) {
    super();
    this.character = getCharacter(characterClass);
    this.state = new PlayerState();
    this.state.x = startX;
    this.state.y = startY;
    this.state.characterClass = characterClass;
    this.state.characterType = characterType;
    this.state.activeWeaponIndex = 0;

    this.stats = this.foldStats();
    this.state.health = this.stats.maxHp;
    this.state.maxHp = this.stats.maxHp;

    // Players start EMPTY-HANDED — no default weapon, no starting weapon pick. The
    // first weapon is claimed from a supply-room pedestal on floor 1 (see
    // LootDirector.spawnSupply). `state.weaponId` stays "" until then.
    this.attachBody(physics, startX, startY, PLAYER_BODY_PROFILE);
  }

  /** Whether this player's class is allowed to equip the given weapon (D9/D18).
   *  The permission lives on the class; this just asks it. */
  canEquip(weaponId: string): boolean {
    return canClassUseWeapon(this.character.id, weaponId);
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
      maxHp: Math.max(1, Math.round(foldStat(this.character.maxHp, sum(c => c.maxHpFlat), sum(c => c.maxHpPct)))),
      speed: foldStat(this.character.speed, sum(c => c.speedFlat), sum(c => c.speedPct)),
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

  /** The active weapon instance, or `undefined` when the player holds none (before
   *  they claim their first supply-room weapon). Callers that attack must guard. */
  get weapon(): WeaponInstance | undefined {
    return this.weapons[this.activeIndex] ?? this.weapons[0];
  }

  // ── Caster interface (x/y/emitHitSource/spawnProjectile come from Entity) ─────
  get facing(): Facing {
    return this.state.facing;
  }
  get attackAffects(): number {
    return PLAYER_ATTACK_AFFECTS;
  }

  /** The swing this attack is on, for the melee spell (Caster.meleeCombo): the
   *  heavy swing when the release was a hold, otherwise the current combo step.
   *  Both were chosen when the swing was released, so this reads the variant — FX
   *  + damage/knockback multipliers — for the swing now in flight. */
  meleeCombo(inst: WeaponInstance): ComboSwing {
    if (this.pendingHard) return inst.hardSwing;
    const swings = inst.comboSwings;
    return swings[this.comboIndex % swings.length];
  }

  /** Set this player's melee tuning (ms). Both come from the client's Options and
   *  are clamped so a bad value can't disable or unboundedly stretch either. */
  setMeleeTuning(comboWindowMs: number, chargeHoldMs: number): void {
    if (Number.isFinite(comboWindowMs)) this.comboWindowMs = Math.max(0, Math.min(2000, comboWindowMs));
    if (Number.isFinite(chargeHoldMs)) this.chargeHoldMs = Math.max(50, Math.min(3000, chargeHoldMs));
  }

  /** Advance (or reset) the melee combo for a swing released at caster-clock `now`.
   *  The chain continues only when the gap since the last swing is within the
   *  weapon's cooldown plus the grace window; otherwise it restarts at swing 0. */
  private advanceCombo(now: number): void {
    const graceExpired = now - this.lastSwingAt > this.weapon!.attackCooldownMs + this.comboWindowMs;
    const len = this.weapon!.comboSwings.length;
    this.comboIndex = graceExpired ? 0 : (this.comboIndex + 1) % len;
    this.lastSwingAt = now;
    this.state.comboStep = this.comboIndex;
  }

  /** Run melee for this tick. A press fires a regular swing IMMEDIATELY (no
   *  deferred wind-up — that's what made taps feel gooey), and if the button stays
   *  held past `chargeHoldMs` a single hard swing is armed and fires on release.
   *  So: tap = swing now; hold-after-the-tap = charge, release = heavy. Combos
   *  still come from distinct taps (each rising edge advances the chain). */
  private updateMelee(attackHeld: boolean, risingEdge: boolean, dtMs: number, aim: AimPoint): void {
    const now = this.spellCaster.now;
    const spell = this.spellFor(this.weapon!);

    // Fresh press: swing right away and begin charging a hard follow-up.
    if (risingEdge && !this.spellCaster.busy && spell.isReady(now)) {
      this.fireSwing(false, now, aim, dtMs);
      this.charging = true;
      this.chargeMs = 0;
      return;
    }

    if (this.charging) {
      if (attackHeld) {
        this.chargeMs += dtMs;
      } else {
        // Released. Arm the heavy only if it was held past the threshold; either
        // way the regular swing already went out on the press.
        if (this.chargeMs >= this.chargeHoldMs) this.hardQueued = true;
        this.charging = false;
        this.chargeMs = 0;
      }
    }

    // The telegraph shows only once the initial swing's animation is done — during
    // the swing the client is playing it, and the charge pose would fight it.
    const armed = this.charging && this.chargeMs >= this.chargeHoldMs;
    this.state.charging = this.charging && !this.spellCaster.busy;
    this.state.chargeHard = armed && !this.spellCaster.busy;

    // A queued hard swing fires as soon as the weapon is free (the initial swing's
    // cooldown may still be running when the button is released).
    if (this.hardQueued && !this.spellCaster.busy && spell.isReady(now)) {
      this.hardQueued = false;
      this.fireSwing(true, now, aim, dtMs);
    }
  }

  /** Drop a charge / queued hard swing without firing (stun, downed, or a swap to
   *  a non-melee weapon mid-hold). Idempotent. */
  private cancelCharge(): void {
    if (!this.charging && !this.hardQueued) return;
    this.charging = false;
    this.chargeMs = 0;
    this.hardQueued = false;
    this.state.charging = false;
    this.state.chargeHard = false;
  }

  /** Fire a melee swing this tick — hard (charged) or the next combo step. */
  private fireSwing(hard: boolean, now: number, aim: AimPoint, dtMs: number): void {
    this.pendingHard = hard;
    this.state.hardSwing = hard;
    this.state.attackSeq = (this.state.attackSeq + 1) % 65536;
    if (hard) {
      // A heavy swing is its own move — it doesn't extend the tap combo. Reset so
      // the next tap starts a fresh chain, and stamp lastSwingAt for that timing.
      this.comboIndex = 0;
      this.state.comboStep = 0;
      this.lastSwingAt = now;
    } else {
      this.advanceCombo(now);
    }
    const spell = this.spellFor(this.weapon!);
    this.spellCaster.begin(spell, aim);
    // Advance one tick now. A fast weapon (windUp 0) strikes this very tick so taps
    // stay snappy; a slower one enters its wind-up hold and strikes once it elapses.
    this.spellCaster.update(this, dtMs, aim);
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
    this.state.weaponId = this.weapons[this.activeIndex].id;
  }

  /** Equip a specific weapon slot by index (the inventory menu clicks a row).
   *  Out-of-range indices are ignored. Like switchWeapon, does not reset a swing. */
  selectWeapon(index: number): void {
    if (!Number.isInteger(index)) return;
    if (index < 0 || index >= this.weapons.length) return;
    this.activeIndex = index;
    this.state.activeWeaponIndex = this.activeIndex;
    this.state.weaponId = this.weapons[this.activeIndex].id;
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

  /** Enter/leave the downed state. Downed freezes the player (no control, no
   *  velocity) and resets the revive bar; standing back up clears both. Health is
   *  managed by the caller — a revive restores it, entering downed leaves it at 0. */
  setDowned(downed: boolean): void {
    this.state.downed = downed;
    this.state.reviveProgress = 0;
    if (downed) {
      this.state.isAttacking = false;
      this.move(0, 0, 0);
    }
  }

  applyInput(input: InputMessage, dtMs: number): void {
    // A downed player is frozen — no movement, no attack, no facing change —
    // until a teammate revives them (GameRoom step 10). Zero the movement intent
    // so a held key from before they fell doesn't keep the body drifting.
    if (this.state.downed) {
      this.move(0, 0, 0);
      this.cancelCharge();
      this.prevAttack = false;
      return;
    }

    this.spellCaster.tickClock(dtMs);

    // Hitstun freezes control — movement, attack, facing all pause — while the
    // knockback impulse (carried by commitVelocity) sweeps the player. The in-flight
    // cast is frozen too. prevAttack is tracked so a held attack doesn't auto-fire
    // the instant stun ends.
    if (this.updateStun(dtMs)) {
      this.cancelCharge();
      this.prevAttack = input.attack;
      return;
    }

    const risingEdge = input.attack && !this.prevAttack;
    const weapon = this.weapon;
    const spell = weapon ? this.spellFor(weapon) : undefined;

    // Ranged weapons freeze facing while held so you can strafe under your aim —
    // except the first press frame, which still turns you to aim.
    const facingLocked = weapon?.isRanged && input.attack && !risingEdge;
    if (!facingLocked) {
      if (input.dx > 0) this.state.facing = "right";
      else if (input.dx < 0) this.state.facing = "left";
      else if (input.dy > 0) this.state.facing = "down";
      else if (input.dy < 0) this.state.facing = "up";
    }

    this.move(input.dx, input.dy, this.stats.speed);

    // Advance an in-flight attack; then — the same tick it finishes — the next one
    // may start, so the cadence is exactly the weapon's cooldown. With no weapon
    // (before the first supply pickup) there is nothing to cast, so the attack block
    // is skipped and the player just moves.
    const aim = this.facingAim();
    if (this.spellCaster.busy) {
      this.spellCaster.update(this, dtMs, aim);
    }
    if (!weapon || !spell) {
      // No weapon yet — drop any charge and do nothing else.
      this.cancelCharge();
    } else if (!weapon.isRanged && !weapon.isAoe) {
      // Melee: tap swings now, holding past the threshold arms a hard swing on release.
      this.updateMelee(input.attack, risingEdge, dtMs, aim);
    } else {
      // A wind-up left over from before a swap to this ranged/AOE weapon is dropped.
      this.cancelCharge();
      // Ranged/AOE fire immediately — held for "hold" fire mode, once per press for
      // "press". They never combo, so their swing is always the neutral first step.
      const wantsToFire = spell.fireMode === "hold" ? input.attack : risingEdge;
      if (!this.spellCaster.busy && wantsToFire && spell.isReady(this.spellCaster.now)) {
        this.state.attackSeq = (this.state.attackSeq + 1) % 65536;
        this.comboIndex = 0;
        this.state.comboStep = 0;
        this.state.hardSwing = false;
        this.spellCaster.begin(spell, aim);
        this.spellCaster.update(this, dtMs, aim); // zero wind-up: strike this tick
      }
    }
    // isAttacking tracks the cast: true through the swing/shot window (drives the
    // client attack animation), false when idle. charging is the deferred heavy
    // wind-up AFTER a swing; windingUp is the swing's own wind-up BEFORE the blow
    // (a melee swing holds the weapon's cooldown as a cocked-back pose). Both are
    // melee-only poses the client reads; ranged/AOE never set them.
    this.state.isAttacking = this.spellCaster.busy;
    const isMelee = !!weapon && !weapon.isRanged && !weapon.isAoe;
    this.state.windingUp = isMelee && this.spellCaster.windingUp;

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
