// Headless check for the Phase-0 combat substrate: the single CombatSystem
// resolver applied over hit sources (player melee swings, enemy contact hitboxes,
// projectiles), replacing the old hardcoded GameRoom passes. Boots the real
// PhysicsWorld + Player + Enemy + Projectile, runs the exact gather+resolve step
// GameRoom.tick now runs, and asserts damage, knockback, and team-filtering all
// behave. Run: npx ts-node --transpile-only src/verify-combat.ts
import { TILE, Layer, SERVER_TICK_MS, WEAPON_REGISTRY, AMMO_REGISTRY, PLAYER_ATTACK_AFFECTS, ENEMY_ATTACK_AFFECTS, PLAYER_PROJECTILE_AFFECTS, ENEMY_PROJECTILE_AFFECTS, Staff } from "shared";
import { weaponSpell } from "./spells/weaponSpell";
import { PhysicsWorld } from "./physics/PhysicsWorld";
import { Player } from "./entities/Player";
import { Enemy } from "./entities/Enemy";
import { GooGreen } from "./entities/enemies/goos";
import { Projectile } from "./entities/Projectile";
import { CombatSystem } from "./combat/CombatSystem";
import { HitSource } from "./combat/HitSource";

const COLS = 60, ROWS = 40;
const newPhysics = () => new PhysicsWorld(
  Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => TILE.FLOOR)) as any,
  COLS, ROWS,
);
const combat = new CombatSystem();

let allPass = true;
function check(name: string, cond: boolean, detail: string) {
  allPass &&= cond;
  console.log(`${cond ? "✅" : "❌"} ${name.padEnd(42)} ${detail}`);
}

// Run one combat step exactly as GameRoom.tick does: drain each entity's queued
// effects into hit sources + spawned projectiles, advance projectiles, resolve
// once against both team groups.
function resolveStep(
  physics: PhysicsWorld,
  players: Map<string, Player>,
  enemies: Map<string, Enemy>,
  projectiles: Projectile[],
) {
  const sources: HitSource[] = [];
  const drain = (ownerId: string, affects: number, effects: ReturnType<Player["drainEffects"]>) => {
    for (const e of effects) {
      if (e.kind === "hit") sources.push(e.source);
      else if (e.kind === "projectile") projectiles.push(new Projectile(physics, AMMO_REGISTRY[e.ammoId], e.x, e.y, e.angle, ownerId, e.opts?.inert ? 0 : affects, e.opts?.lifetimeMs));
    }
  };
  players.forEach((p, sid) => drain(sid, PLAYER_ATTACK_AFFECTS, p.drainEffects()));
  enemies.forEach((e, id) => {
    const c = e.contactHitSource(id);
    if (c) sources.push(c);
    drain(id, ENEMY_ATTACK_AFFECTS, e.drainEffects());
  });
  projectiles.forEach((p) => p.tick(SERVER_TICK_MS));
  projectiles.forEach((p) => { if (!p.dead) sources.push(p.hitSource()); });
  combat.resolve(sources, [
    { layer: Layer.PLAYER, targets: players as any },
    { layer: Layer.ENEMY, targets: enemies as any },
  ]);
}

// ── Scenario 1: melee swing damages + knocks back the enemy in front; the enemy's
//    own contact hitbox damages the adjacent player; neither hits its own team. ──
{
  const physics = newPhysics();
  const px = 300, py = 300;
  const player = new Player(physics, px, py, "knight", "guy", "broadsword");
  player.state.facing = "right";
  // Enemy 12px to the right: inside the broadsword arc AND inside contact range (14).
  const enemy = new GooGreen(physics, px + 12, py);
  const players = new Map([["p1", player]]);
  const enemies = new Map([["e1", enemy]]);

  const broadsword = WEAPON_REGISTRY["broadsword"];
  const enemyHp0 = enemy.state.health;
  const playerHp0 = player.state.health;

  player.applyInput({ dx: 0, dy: 0, attack: true }, SERVER_TICK_MS); // start a swing
  resolveStep(physics, players, enemies, []);

  check("melee damages enemy", enemy.state.health === enemyHp0 - broadsword.damage,
    `enemyHp ${enemyHp0}→${enemy.state.health} (−${broadsword.damage})`);
  check("melee knocks back enemy", enemy.state.stunned === true,
    `stunned=${enemy.state.stunned}`);
  check("enemy contact damages player", player.state.health === playerHp0 - enemy["attackDamage"],
    `playerHp ${playerHp0}→${player.state.health}`);

  // Continue the SAME swing (attack held): the hurtbox is emitted again, but the
  // swing's gate dedupes so the enemy isn't re-hit, and the enemy's contact
  // cooldown holds so it can't re-hit the player either.
  const enemyHp1 = enemy.state.health;
  const playerHp1 = player.state.health;
  player.applyInput({ dx: 0, dy: 0, attack: true }, SERVER_TICK_MS);
  resolveStep(physics, players, enemies, []);
  check("melee hits once per swing", enemy.state.health === enemyHp1, `enemyHp still ${enemy.state.health}`);
  check("enemy contact respects cooldown", player.state.health === playerHp1, `playerHp still ${player.state.health}`);
}

// ── Scenario 2: a player-owned arrow damages an enemy but never the owner. ──
{
  const physics = newPhysics();
  const px = 300, py = 300;
  const player = new Player(physics, px, py, "knight", "guy", "broadsword");
  const enemy = new GooGreen(physics, px + 60, py); // downrange to the right
  const players = new Map([["p1", player]]);
  const enemies = new Map([["e1", enemy]]);
  const arrow = AMMO_REGISTRY["arrow"];
  const proj = new Projectile(physics, arrow, px + 10, py, 0, "p1", PLAYER_PROJECTILE_AFFECTS);

  const enemyHp0 = enemy.state.health;
  const playerHp0 = player.state.health;
  // A few ticks for the arrow to sweep into the enemy.
  for (let t = 0; t < 20 && !proj.dead; t++) resolveStep(physics, players, enemies, [proj]);

  check("arrow damages enemy", enemy.state.health === enemyHp0 - arrow.damage,
    `enemyHp ${enemyHp0}→${enemy.state.health} (−${arrow.damage})`);
  check("arrow spares its owner", player.state.health === playerHp0,
    `playerHp ${player.state.health}`);
}

// ── Scenario 3 (Phase 1): a knockback-carrying enemy projectile now shoves AND
//    hitstuns the player, freezing their input while the stun lasts. ──
{
  const physics = newPhysics();
  const px = 300, py = 300;
  const player = new Player(physics, px, py, "knight", "guy", "broadsword");
  player.state.facing = "down";
  const players = new Map([["p1", player]]);
  const enemies = new Map<string, Enemy>();
  const boulder = AMMO_REGISTRY["boulder"]; // knockback 5
  const proj = new Projectile(physics, boulder, px - 40, py, 0, "e1", ENEMY_PROJECTILE_AFFECTS);

  const playerHp0 = player.state.health;
  for (let t = 0; t < 20 && !player.state.stunned; t++) resolveStep(physics, players, enemies, [proj]);

  check("boulder damages player", player.state.health === playerHp0 - boulder.damage,
    `playerHp ${playerHp0}→${player.state.health}`);
  check("player is stunned by knockback", player.state.stunned === true && player.isStunned,
    `stunned=${player.state.stunned}`);

  // While stunned, applyInput is frozen — moving right must NOT change facing.
  player.applyInput({ dx: 1, dy: 0, attack: false }, SERVER_TICK_MS);
  check("stunned player input frozen", player.state.facing === "down",
    `facing=${player.state.facing}`);

  // Run the stun down; once clear, input works again.
  for (let t = 0; t < 220 && player.isStunned; t++) player.applyInput({ dx: 0, dy: 0, attack: false }, SERVER_TICK_MS);
  player.applyInput({ dx: 1, dy: 0, attack: false }, SERVER_TICK_MS);
  const facingAfter: string = player.state.facing;
  check("player recovers after stun", !player.isStunned && facingAfter === "right",
    `stunned=${player.state.stunned} facing=${facingAfter}`);
}

// ── Scenario 4 (Phase 4): player MELEE cadence — one swing per press, the swing
//    window == the weapon's attack cooldown, and a re-press swings again. ──
{
  const physics = newPhysics();
  const player = new Player(physics, 300, 300, "knight", "guy", "broadsword");
  player.state.facing = "right";
  const windowTicks = Math.ceil(WEAPON_REGISTRY["broadsword"].attackCooldownMs / SERVER_TICK_MS); // 10

  let swings = 0;
  let lastSeq = player.state.attackSeq;
  const step = (attack: boolean) => {
    player.applyInput({ dx: 0, dy: 0, attack }, SERVER_TICK_MS);
    if (player.state.attackSeq !== lastSeq) { swings++; lastSeq = player.state.attackSeq; }
  };

  for (let t = 0; t < windowTicks * 2; t++) step(true); // hold across two windows
  check("melee: held = a single swing", swings === 1, `swings=${swings}`);
  check("melee: swing ends after its window", player.state.isAttacking === false, `isAttacking=${player.state.isAttacking}`);
  step(false); // release
  step(true);  // re-press
  check("melee: re-press swings again", swings === 2, `swings=${swings}`);
}

// ── Scenario 5 (Phase 4): player RANGED cadence — auto-fires while held at exactly
//    the weapon's cooldown interval, and facing locks mid-hold. ──
{
  const physics = newPhysics();
  const player = new Player(physics, 300, 300, "ranger", "guy", "shortbow");
  const interval = Math.ceil(WEAPON_REGISTRY["shortbow"].attackCooldownMs / SERVER_TICK_MS); // 7

  const shotTicks: number[] = [];
  for (let t = 0; t < interval * 4; t++) {
    player.applyInput({ dx: 0, dy: 0, attack: true }, SERVER_TICK_MS);
    for (const e of player.drainEffects()) if (e.kind === "projectile") shotTicks.push(t);
  }
  // Over 4 intervals, held fire lands 4 shots, one every `interval` ticks.
  check("ranged: auto-fires while held", shotTicks.length === 4, `shots=${shotTicks.length} at [${shotTicks}]`);
  const gaps = shotTicks.slice(1).map((t, i) => t - shotTicks[i]);
  check("ranged: fire interval = cooldown", gaps.every((g) => g === interval), `gaps=[${gaps}] expect ${interval}`);

  // Facing locks while the fire button is held (first press aims; then frozen).
  const p2 = new Player(physics, 300, 300, "ranger", "guy", "shortbow");
  p2.applyInput({ dx: 1, dy: 0, attack: true }, SERVER_TICK_MS);  // press → aim right
  p2.applyInput({ dx: 0, dy: -1, attack: true }, SERVER_TICK_MS); // held + move up → locked
  check("ranged: facing locks while held", p2.state.facing === "right", `facing=${p2.state.facing}`);
}

// ── Scenario 6: the Mage's staff is a ranged caster — attacking conjures the
//    staff's elemental bolt (see ammo/bolts). Damage comes from the BOLT, not the
//    staff: like bows, a staff carries damage 0 and controls only fire rate + which
//    ammo, so balance lives on the ammo. ──
{
  const physics = newPhysics();
  const px = 300, py = 300;
  const player = new Player(physics, px, py, "mage", "guy", "oak-staff");
  const enemy = new GooGreen(physics, px + 90, py); // downrange to the right
  const players = new Map([["p1", player]]);
  const enemies = new Map([["e1", enemy]]);
  const projectiles: Projectile[] = [];
  const bolt = AMMO_REGISTRY["magic-bolt"];

  const hp0 = enemy.state.health;
  // Press aiming right, then hold while the bolt travels downrange.
  for (let t = 0; t < 25 && enemy.state.health === hp0; t++) {
    player.applyInput({ dx: t === 0 ? 1 : 0, dy: 0, attack: true }, SERVER_TICK_MS);
    resolveStep(physics, players, enemies, projectiles);
  }

  check("staff: casting conjures a bolt", projectiles.length > 0, `spawned=${projectiles.length}`);
  check("staff: bolt carries the damage", enemy.state.health === hp0 - bolt.damage,
    `enemyHp ${hp0}→${enemy.state.health} (−${bolt.damage})`);
  check("staff: staff itself deals none", WEAPON_REGISTRY["oak-staff"].damage === 0,
    `staffDamage=${WEAPON_REGISTRY["oak-staff"].damage}`);
}

// Each staff conjures its own element — the per-staff differentiation.
{
  const expected: Record<string, string> = {
    "oak-staff": "magic-bolt",
    "cane": "magic-bolt",
    "arcane-staff": "arcane-bolt",
    "ruby-staff": "flame-bolt",
    "emerald-staff": "verdant-bolt",
    "crystal-wand": "frost-bolt",
  };
  const wrong = Object.entries(expected)
    .filter(([id, ammoId]) => WEAPON_REGISTRY[id]?.ammoId !== ammoId)
    .map(([id, ammoId]) => `${id}≠${ammoId}`);
  check("staff: each staff fires its element", wrong.length === 0,
    wrong.length ? wrong.join(",") : `all ${Object.keys(expected).length} mapped`);
}

// ── Scenario 7: the AOE spell path stays wired for the staff's planned nova
//    ability. No weapon uses an AoeSpec today (staves now shoot bolts), so this
//    guards weaponSpell's AOE branch against rotting before the ability lands. ──
{
  const novaStaff = new Staff({
    id: "test-nova-staff",
    name: "Nova Staff (test)",
    aoe: { radius: 76, windUpMs: 260, blastMs: 130 },
  });
  const spell = weaponSpell(novaStaff);
  check("AOE: still builds a wind-up + blast from an AoeSpec",
    spell.windUpMs === 260 && spell.activeMs === 130,
    `windUp=${spell.windUpMs} active=${spell.activeMs}`);
}

console.log(allPass ? "\n✅ COMBAT SUBSTRATE OK" : "\n❌ COMBAT SUBSTRATE FAILED");
process.exit(allPass ? 0 : 1);
