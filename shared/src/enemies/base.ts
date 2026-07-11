// Enemy identifiers shared across client + server. The actual enemy definitions
// (stats + behavior) are object-oriented classes on the server
// (server/src/entities/enemies + /bosses); the client renders them from its own
// visual registry (client/src/enemies). All that has to be shared is the id
// union (Colyseus syncs it as a string; the client keys visuals off it) and the
// facing mode each enemy's art uses.

export type EnemyType =
  // Horizontal, single-row strips
  | "goo-green"
  | "goo-blue"
  | "goo-gold"
  | "bat"
  | "brown-bat"
  | "eye-bat"
  | "gold-eye"
  | "smushroom"
  | "float-eye"
  | "swarm-1"
  | "swarm-2"
  | "swarm-3"
  | "rat"
  // Horizontal, multi-row sheets
  | "spider"
  | "frog-flower"
  | "frog-flower-black"
  | "float-skull"
  | "float-skull-teal"
  | "float-skull-pink"
  // Directional (up/right/down/left rows)
  | "bones"
  | "bones-blader"
  | "kultist"
  | "armor-lancer"
  | "beast"
  | "axe-beast"
  | "mace-beast"
  | "sword-beast"
  | "fang"
  | "hood-fang"
  // Bosses — placed only in the boss room, never in the normal spawn pool
  | "turtle-dragon"
  | "wyvern"
  | "wyvern-green"
  | "wyvern-grey"
  | "centaur-knight"
  | "big-beast"
  | "tengu-mask"
  | "batwing-buttstomper";

/** "horizontal" art has one side view, mirrored with flipX (goos, bats, spiders).
 *  "directional" art has an up/right/down/left row per facing (bones, beasts).
 *  Each enemy class declares which its art uses; the client visual def must match. */
export type EnemyFacingMode = "horizontal" | "directional";
