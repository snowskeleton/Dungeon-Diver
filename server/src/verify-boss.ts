// Headless integration check for the boss projectile path (Stages 0–2).
// For every boss type: boots the real PhysicsWorld + Boss + Projectile, drives
// Boss.tick against a stationary player at its preferred range, and asserts the
// boss telegraphs, fires, and its shots damage the player but NOT a bystander
// enemy. Run: npx ts-node --transpile-only src/verify-boss.ts
import { TILE, SERVER_TICK_MS, Layer, canAffect, ENEMY_PROJECTILE_AFFECTS, AMMO_REGISTRY } from "shared";
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
  const spawn = (ammoId: string, x: number, y: number, angle: number) =>
    projectiles.push(new Projectile(physics, AMMO_REGISTRY[ammoId], x, y, angle, "boss", ENEMY_PROJECTILE_AFFECTS));

  let sawTelegraph = false, shots = 0;
  for (let t = 0; t < 160; t++) {
    const before = projectiles.length;
    boss.tick(players, SERVER_TICK_MS, () => {}, spawn);
    shots += projectiles.length - before;
    if (boss.state.telegraph) sawTelegraph = true;
    for (const proj of projectiles) {
      proj.tick(SERVER_TICK_MS);
      if (proj.dead) continue;
      if (canAffect(proj.affects, Layer.PLAYER) && proj.tryHit("p1", player.x, player.y)) player.health -= proj.cfg.damage;
      if (canAffect(proj.affects, Layer.ENEMY) && proj.tryHit("b1", bystander.state.x, bystander.state.y)) bystander.takeDamage(proj.cfg.damage);
    }
  }
  const pass = sawTelegraph && shots > 0 && player.health < 100 && bystander.state.health === 60;
  allPass &&= pass;
  console.log(`${pass ? "✅" : "❌"} ${type.padEnd(20)} shots=${String(shots).padStart(2)} telegraph=${sawTelegraph} playerHp=${player.health} bystanderHp=${bystander.state.health}`);
}
console.log(allPass ? "\n✅ ALL BOSSES PASS" : "\n❌ SOME BOSSES FAILED");
process.exit(allPass ? 0 : 1);
