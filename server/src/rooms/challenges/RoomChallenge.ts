import { EnemyClass } from "../../entities/Enemy";

/** The slice of GameRoom a challenge is allowed to touch. Deliberately tiny, the
 *  same way `Caster` (server/src/spells) is the tiny interface a Spell needs — it
 *  keeps challenges out of GameRoom's internals and makes them testable alone. */
export interface ChallengeContext {
  readonly roomId: string;
  /** Enemies in this room that are not yet dying. */
  livingEnemyCount(roomId: string): number;
  spawnEnemyInRoom(roomId: string, cls: EnemyClass): void;
  /** The floor's rabble pool, honouring any debug enemy selection. */
  enemyPool(): EnemyClass[];
  /** Rank-and-file count for one room at the current floor/player count. */
  enemiesPerRoom(): number;
  /** Drop a reward pedestal at this room's centre. No-op if one is already there,
   *  so a challenge can't grant twice. */
  dropReward(roomId: string): void;
  /** True while at least one living player stands in the room — lets a timer wait
   *  to start until the party actually arrives. */
  playersInRoom(roomId: string): boolean;
}

/** A per-room objective. One subclass per challenge, stats and behaviour on the
 *  class and compiler-checked — no id→config table, same as Enemy and Upgrade.
 *  GameRoom picks subclasses in one exhaustive switch on RoomType. */
export abstract class RoomChallenge {
  /** The whole line the client banner shows, e.g. "Wave 2 / 3" or "Time 0:32".
   *  A single pre-formatted string rather than a progress/goal pair: a countdown
   *  and a step counter don't read the same way, and this keeps the wire shape and
   *  the banner fixed as more challenges land. Synced only when it changes, so a
   *  per-tick timer still only pushes once a second. */
  abstract get bannerText(): string;

  get isComplete(): boolean {
    return true;
  }

  /** An enemy belonging to this room just started dying. Called BEFORE the
   *  room-clear check, which is what lets a challenge keep the room locked by
   *  putting more enemies in it (see WaveChallenge). */
  onEnemyDown(_ctx: ChallengeContext): void {}

  /** Per-tick hook for time-based challenges. */
  tick(_dtMs: number, _ctx: ChallengeContext): void {}
}
