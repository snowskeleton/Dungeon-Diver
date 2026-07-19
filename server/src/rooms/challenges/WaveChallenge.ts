import { RoomChallenge, ChallengeContext } from "./RoomChallenge";

/** Total waves, including the one the normal floor spawn already placed. */
const WAVE_COUNT = 3;

/** A room that refills. Wave 1 is spawned by GameRoom's ordinary rank-and-file
 *  pass, so the room locks and reads exactly like a combat room on entry; each
 *  time the last enemy falls the next wave arrives instead of the door opening.
 *
 *  FloorManager needs no special case for this. Its clear rule is "every enemy in
 *  the room's set is dying", and `onEnemyDown` runs BEFORE that check — the fresh
 *  wave is already in the set by the time it evaluates, so the room simply stays
 *  locked. The last wave adds nothing and the room clears normally. */
export class WaveChallenge extends RoomChallenge {
  private wave = 1;
  // Set when the LAST wave is downed, not when the last wave is spawned — the
  // banner and the tick-skip guard both key off this, and the player is still
  // very much in a fight during wave 3.
  private done = false;

  get bannerText(): string {
    return `Wave ${this.wave} / ${WAVE_COUNT}`;
  }

  get isComplete(): boolean {
    return this.done;
  }

  onEnemyDown(ctx: ChallengeContext): void {
    if (this.done) return;
    // livingEnemyCount excludes anything already dying, and the caller flags the
    // dying enemy before we run, so zero here means "that was the last of the wave".
    if (ctx.livingEnemyCount(ctx.roomId) > 0) return;

    if (this.wave >= WAVE_COUNT) {
      this.done = true;
      return;
    }

    this.wave++;
    const pool = ctx.enemyPool();
    if (pool.length === 0) return;
    // Each wave lands one heavier than the last, so the room escalates rather
    // than repeating. Built off enemiesPerRoom() so floor scaling and the debug
    // count knob both still apply.
    const count = ctx.enemiesPerRoom() + (this.wave - 1);
    for (let i = 0; i < count; i++) {
      ctx.spawnEnemyInRoom(ctx.roomId, pool[Math.floor(Math.random() * pool.length)]);
    }
  }
}
