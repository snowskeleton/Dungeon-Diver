// The player-facing changelog. This is the SINGLE SOURCE OF TRUTH — the in-game
// changelog viewer (client/src/ui/ChangelogViewer.ts) renders straight from it,
// so there is no second copy to keep in sync.
//
// HOW TO MAINTAIN IT (see also the changelog memory note):
//   • The top entry is always the WORKING version, `released: false`, version
//     "Unreleased". Add a line to its `changes` as you land each change.
//   • Keep it readable, not noisy: one line per player-visible change, grouped by
//     `kind`. Squash/rewrite in-progress lines as things evolve during a version —
//     the log describes what shipped, not every intermediate commit.
//   • When the user calls a release, FREEZE the top entry: set a real `version`
//     (semver) + `date`, `released: true`, then unshift a fresh
//     { version: "Unreleased", released: false, changes: [] } on top for the next
//     cycle.
//   • Newest version first in the array; the viewer shows them in this order.

export type ChangeKind = "fix" | "balance" | "feature" | "ui";

export interface ChangelogChange {
  kind: ChangeKind;
  /** One player-facing line. No trailing period needed. */
  text: string;
}

export interface ChangelogVersion {
  /** Semver once released, or "Unreleased" while it's the working version. */
  version: string;
  /** ISO date (YYYY-MM-DD) once released; omit while unreleased. */
  date?: string;
  released: boolean;
  changes: ChangelogChange[];
}

export const KIND_LABELS: Record<ChangeKind, string> = {
  fix: "Fixed",
  balance: "Balance",
  feature: "New",
  ui: "UI",
};

// Newest first.
export const CHANGELOG: ChangelogVersion[] = [
  {
    version: "Unreleased",
    released: false,
    changes: [
      { kind: "feature", text: "Full controller support: P1 can now play solo on a gamepad (left stick moves, A attacks, B uses your movement ability, LB/RB switch weapons, X interacts, Menu/Start opens the inventory) and can swap between the pad and keyboard mid-run. Each couch player claims the next controller" },
      { kind: "feature", text: "The left stick now moves you in 16 directions (up from 8) for finer, crisper steering, and your facing follows the stick's dominant direction (push mostly-west and you face west, mostly-north and you face up)" },
      { kind: "fix", text: "Movement now responds instantly to your input instead of lagging a beat behind: your character is drawn where you're steering right away (client-side prediction) and quietly reconciled with the server, so starting, stopping, and turning feel immediate — most noticeable on a controller" },
      { kind: "feature", text: "Controls can be rebound for BOTH devices: the rebind screen now has a Keyboard/Mouse column and a Controller column, and on-screen button prompts show the right glyph for whichever device you last used" },
      { kind: "feature", text: "Menus are now controller-navigable end to end — the D-pad or left stick moves a highlight, A selects, B backs out — from the title screen through the lobby, shops, and pause menu (entering a room code or name still needs a keyboard)" },
      { kind: "feature", text: "Enemies now telegraph and attack instead of just bumping you: the beasts hold and swing their own weapons with a wind-up, the eye-bat spirals in and dives, the frog crouches then leaps and slams, the smushroom gasses you with a lingering cloud (and a parting cloud when it dies), and the snake coils then lunges" },
      { kind: "feature", text: "New enemies: skeletons that swing a heavy blade, and skeleton-mages that hex you with staff bolts from range" },
      { kind: "balance", text: "Armed enemies now telegraph clearly and pace their attacks: each rears its weapon back before striking (heavier weapons wind up longer) and waits between swings, so their attacks are readable and dodgeable instead of a blur. The skeleton-mage visibly charges each bolt rather than streaming them, and now hurls a green hex bolt (its own projectile, tuned separately from your Mage's)" },
      { kind: "balance", text: "Most enemies no longer hurt you just by touching — their damage is in the telegraphed attack, so you can read and dodge it. Getting knocked back also interrupts an enemy mid-wind-up" },
      { kind: "balance", text: "Your starting weapon can now be any weapon your class can wield, not just the type unique to your class" },
      { kind: "feature", text: "Each class now has a movement ability on its own cooldown (default Shift): the Knight Charges — a rushing slam that damages and knocks back anything in its path, kicking up a trail of dust; the Mage Blinks — vanishing in a puff and reappearing a short hop away, through bars and over gaps; the Rogue Dashes — a brief invulnerable dodge that slips through enemies; the Ranger Vaults — an arcing leap that sails over ground attacks and fire (but flying enemies can still catch you mid-air) and lands in a puff of dust" },
      { kind: "ui", text: "A small cooldown bar fills beneath you while a movement ability recharges and vanishes once it's ready" },
      { kind: "ui", text: "New Options toggle: a performance meter in the bottom-right corner showing live FPS and network latency" },
      { kind: "balance", text: "The movement abilities are a touch slower and shorter, so they're easier to aim and place than the first pass" },
      { kind: "feature", text: "You can now carry at most two weapons. Picking up a new one puts it in your hand; if both slots are full, the weapon you were holding drops to the floor — walk over any dropped weapon (yours or a teammate's) and interact to pick it back up" },
      { kind: "balance", text: "Room buffs are much smaller now. You still get one nearly every room, but each is a gentler nudge — power comes from stacking many, not from a few big jumps" },
      { kind: "fix", text: "You can no longer squeeze through the diagonal gap where two obstacles touch at a corner — those pinch points are now solid, so you can't clip through (or get wedged behind) cover" },
      { kind: "fix", text: "The stairs down can no longer spawn inside the boss room, and you must clear a room's fight before its stairs or trap will take you down" },
      { kind: "fix", text: "Enemies knocked hard into a wall can no longer end up stuck outside the room where you can't reach them — they're pulled back into play" },
      { kind: "fix", text: "Your health bar no longer reads past full after +max-HP upgrades; the bar's full mark now follows your real max health" },
      { kind: "fix", text: "The run now correctly ends at floor 10 — stairs and traps can't carry you past it" },
      { kind: "fix", text: "Traps that drop you a floor now start you at the new floor's entrance and show it correctly on the minimap" },
      { kind: "ui", text: "Picking up an item no longer briefly freezes you in place — the \"item get\" text still shows, but you keep moving" },
      { kind: "ui", text: "A claimed reward pedestal now disappears completely instead of leaving a faint ghost behind" },
      { kind: "ui", text: "Duplicate upgrades collapse into one line with a count (e.g. \"Keen Edge x3\") in the inventory" },
      { kind: "ui", text: "The inventory now shows a weapon's actual damage after your buffs (base → actual), not just its base" },
      { kind: "ui", text: "Minimap rooms are spaced further apart with clear lines between them, so you can tell which rooms actually connect" },
      { kind: "fix", text: "Maze treasure chests no longer physically block the path — walk through them and open on approach, so a chest can never seal off a room's only exit" },
      { kind: "fix", text: "Ranged weapons (bows, staves, thrown weapons) now fire correctly while standing flush against a wall instead of the shot dying on spawn" },
      { kind: "fix", text: "You can no longer walk out of a room while its fight is still active (this leaked through the north exit)" },
      { kind: "balance", text: "Far fewer weapon drops: shop rooms are rarer and ordinary room-clear rewards no longer roll weapons, so weapon swaps are a real choice again" },
      { kind: "ui", text: "Shop, reward, and offer screens now show green/red up/down arrows comparing a weapon's stats to the one you're holding" },
      { kind: "ui", text: "Buffs now show a short description of what they do when you pick them up (and in the inventory screen), not just a name" },
      { kind: "feature", text: "Melee weapons now wind up before they strike: pressing attack instantly rears the weapon back and holds it for the weapon's speed, then swings — heavy weapons telegraph clearly, light ones stay snappy, and your input always shows immediate feedback" },
      { kind: "feature", text: "Attacks now buffer: press slightly early during a swing and the next hit still fires the instant the weapon is free, so fast combos no longer need frame-perfect timing (tunable, or off, via the new Attack buffer option)" },
      { kind: "balance", text: "First pass as weapon speed/damage balance. Didn't touch knockback" },
    ],
  },
];
