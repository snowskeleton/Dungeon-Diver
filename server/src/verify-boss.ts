// Headless integration check for every boss's moveset. Its output is a GOLDEN
// REGRESSION BASELINE — anything touching the combat/spell/attack path must leave
// it byte-identical (see CLAUDE.md § Headless verification).
// For every boss type: boots the real PhysicsWorld + Boss + Projectile, drives
// Boss.tick against a stationary player at its preferred range, and asserts the
// boss telegraphs, fires, and its shots damage the player but NOT a bystander
// enemy. Run: npx ts-node --transpile-only src/verify-boss.ts
import { TILE, SERVER_TICK_MS, Layer, canAffect, shapeHitsPoint, ENEMY_PROJECTILE_AFFECTS, AMMO_REGISTRY } from "shared";
import { PhysicsWorld } from "./physics/PhysicsWorld";
import { BOSSES } from "./entities/bosses";
import { GooGreen } from "./entities/enemies/goos";
import { Projectile } from "./entities/Projectile";
import { PlayerState } from "./schema/PlayerState";

const COLS = 60, ROWS = 40;

let allPass = true;
for (const BossClass of BOSSES) {
  const type = BossClass.type;
  const map = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => TILE.FLOOR));
  const physics = new PhysicsWorld(map as any, COLS, ROWS);
  const bx = 900, by = 600;
  const boss = new BossClass(physics, bx, by);
  // Player parked at the boss's comfortable range so it holds still and fires.
  const player = new PlayerState();
  player.x = bx + 150; player.y = by; player.health = 100;
  const players = new Map<string, PlayerState>([["p1", player]]);
  const bystander = new GooGreen(physics, bx + 150, by + 24);

  const projectiles: Projectile[] = [];

  let sawTelegraph = false, shots = 0;
  for (let t = 0; t < 160; t++) {
    boss.tick(players, SERVER_TICK_MS);
    if (boss.state.telegraph) sawTelegraph = true;
    // The boss queued its effects during tick: hit sources (spin/whirl/tremor) and
    // projectile spawns (volleys, tremor shards). Drain and apply them.
    for (const e of boss.drainEffects()) {
      if (e.kind === "hit") {
        const src = e.source;
        if (canAffect(src.affects, Layer.PLAYER) && shapeHitsPoint(src.shape, player.x, player.y) && src.claim("p1")) player.health -= src.attack.damage;
        if (canAffect(src.affects, Layer.ENEMY) && shapeHitsPoint(src.shape, bystander.state.x, bystander.state.y) && src.claim("b1")) bystander.takeDamage(src.attack.damage);
      } else if (e.kind === "projectile") {
        shots++;
        const affects = e.opts?.inert ? 0 : ENEMY_PROJECTILE_AFFECTS;
        projectiles.push(new Projectile(physics, AMMO_REGISTRY[e.ammoId], e.x, e.y, e.angle, "boss", affects, e.opts?.lifetimeMs));
      }
    }
    for (const proj of projectiles) {
      proj.tick(SERVER_TICK_MS);
      if (proj.dead) continue;
      const src = proj.hitSource();
      if (canAffect(proj.affects, Layer.PLAYER) && shapeHitsPoint(src.shape, player.x, player.y) && src.claim("p1")) player.health -= proj.cfg.damage;
      if (canAffect(proj.affects, Layer.ENEMY) && shapeHitsPoint(src.shape, bystander.state.x, bystander.state.y) && src.claim("b1")) bystander.takeDamage(proj.cfg.damage);
    }
  }
  // A boss must telegraph, damage the player (by shot OR melee/AOE), and never
  // friendly-fire the bystander enemy of its own team.
  const pass = sawTelegraph && player.health < 100 && bystander.state.health === 60;
  allPass &&= pass;
  console.log(`${pass ? "✅" : "❌"} ${type.padEnd(20)} shots=${String(shots).padStart(2)} telegraph=${sawTelegraph} playerHp=${player.health} bystanderHp=${bystander.state.health}`);
}
console.log(allPass ? "\n✅ ALL BOSSES PASS" : "\n❌ SOME BOSSES FAILED");
process.exit(allPass ? 0 : 1);
