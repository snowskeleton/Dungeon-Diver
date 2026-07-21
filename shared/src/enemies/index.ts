// Enemy definitions are object-oriented classes on the server
// (server/src/entities/enemies + /bosses), not data configs. All that's shared
// is the identifier union + facing mode.
export * from "./base";
// Hurt bounds MEASURED from each enemy's spritesheet (and the player's), generated
// by assets/generate-enemy-hurtboxes.ts. Shared because the server hit-tests
// against them and the client's H overlay draws them.
export * from "./hurtBounds.generated";
