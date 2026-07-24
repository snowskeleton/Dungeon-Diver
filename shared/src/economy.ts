// The run economy: one shared party purse, fed by gold that enemies drop and
// spent at the shop and shrine. The design intent is stated here as constants and
// everything else is DERIVED from them, so enemy counts, room counts, and party
// size can all change without anyone re-pricing anything by hand.
//
// See roadmap.html "Currency". The two load-bearing intentions:
//   • A floor's gold is BUDGETED, not per-enemy-priced. We decide how much a
//     player should be able to spend per floor and back out a total budget; the
//     SpawnDirector then divides that budget across whatever it actually spawned,
//     weighted by each enemy's `goldWeight`. No id→gold table.
//   • Tier costs are FIXED and the per-floor budget is FLAT across floors. What
//     scales with depth is the shop's QUALITY, so "one item per floor" stays true
//     on floor 9 and prices stay learnable.

/** How much gold one player is expected to be able to spend per floor. The whole
 *  budget is reverse-engineered from this number. */
export const TARGET_SPEND_PER_PLAYER_PER_FLOOR = 100;

/** What fraction of a floor's enemies the design assumes a party actually clears.
 *  Rushing past the rest is the cost of speed — that shortfall is what makes
 *  descending early a real choice rather than a free one. */
export const TARGET_CLEAR_FRACTION = 0.7;

/** The gold made available on a floor, per player. Killing everything yields this;
 *  clearing only `TARGET_CLEAR_FRACTION` of it yields the target spend. */
export function floorGoldBudget(players: number): number {
  const perPlayer = Math.round(TARGET_SPEND_PER_PLAYER_PER_FLOOR / TARGET_CLEAR_FRACTION);
  return perPlayer * Math.max(1, players);
}

/** The three fixed shop price tiers. A shop's three pedestals take these in
 *  ascending order of weapon quality — cheap / mid / premium — so a player learns
 *  "left is affordable, right is the splurge" once and it holds every floor. */
export const SHOP_TIERS = [50, 100, 150] as const;

/** The shop is the ONLY thing gold buys. Reward pedestals (shrine, boss, timed-clear)
 *  and chests are earned, so they are always free — a shrine used to charge 50g and it
 *  read as the game asking you to pay for a reward you had already won. Don't reintroduce
 *  a price on anything but a shop pedestal; add a new gold SINK as a new shop-like thing
 *  instead. */

/** How long (ms) a dropped coin lies still before it starts homing toward a
 *  nearby player. Walking over one collects it immediately regardless. */
export const COIN_IDLE_MS = 3000;

/** Homing speed (px/sec) once a coin is pulling toward a player. A coin homes
 *  toward the nearest player from anywhere on the floor once its idle passes —
 *  there is deliberately no distance gate, so the whole floor's gold comes to you. */
export const COIN_MAGNET_SPEED = 260;

/** How close (px, center-to-center) a player must be to sweep up a coin. */
export const COIN_PICKUP_RADIUS = 16;

/** Split a gold amount into individual coin values for the drop, so a fat reward
 *  scatters a few coins rather than one lump — but capped so a high-value kill
 *  never buries the floor in pickups. Greedy over fixed denominations. */
export function coinDenominations(amount: number): number[] {
  if (amount <= 0) return [];
  const coins: number[] = [];
  let remaining = Math.round(amount);
  for (const denom of [25, 10, 5, 1]) {
    while (remaining >= denom && coins.length < MAX_COINS_PER_DROP - 1) {
      coins.push(denom);
      remaining -= denom;
    }
  }
  // Whatever's left rides on one final coin, so the total is always exact even
  // when the cap is hit.
  if (remaining > 0) coins.push(remaining);
  return coins;
}

const MAX_COINS_PER_DROP = 5;
