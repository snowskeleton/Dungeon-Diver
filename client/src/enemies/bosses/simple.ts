import { boss } from "./factory";

// Bosses that still only animate their locomotion clip (no ability-driven rows
// yet). Sheet layouts live in spriteGeometry.ts. Mirrors the plain-boss classes
// in entities/bosses/.

export const centaurKnight = boss("centaur-knight", "Centaur Knight");
export const bigBeast = boss("big-beast", "Big Beast");
export const batwingButtstomper = boss("batwing-buttstomper", "Batwing Buttstomper");
