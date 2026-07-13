# Boss Design — Movesets & Abilities

Design doc for the 8 bosses. **This is a gameplay spec, not an implementation guide** —
it describes what each attack *should feel like*, deliberately ignoring what the engine
currently supports (we'll grow the engine to fit). Numbers (telegraph lengths, damage,
cooldowns) are starting intuitions to tune, not commitments.

This doc also seeds the in-game **bestiary**: each boss's role blurb + ability list is the
text in its class's `static lore` / `static abilities` fields (see Bestiary integration below),
read back by the book UI.

---

## Design philosophy

The whole point of a boss is that **a perfect player takes no damage.** Every hit a boss
lands should be a hit the player *could have read and dodged*. That means:

- **No passive contact damage.** Touching a boss's body does not hurt (at most a light,
  damageless shove so you can't stand inside it). All damage comes from discrete,
  *announced* attacks. This is the biggest departure from the small enemies, which are
  fine as flat contact threats.
- **Every attack has three beats:**
  1. **Wind-up (telegraph)** — a clearly readable tell: a distinct pose/animation frame,
     a ground marker, a color/glow flash, a charge sound. Long enough to react to.
  2. **Strike** — the active hitbox exists for a short, definite window.
  3. **Recovery** — the boss is briefly committed/vulnerable. This is the player's
     **punish window** — dodging well should be *rewarded* with a damage opening, not just
     survival.
- **Attacks aim where you are or were,** then commit — so movement beats them. Homing, if
  used, is slow enough to juke.
- **Telegraph length is the difficulty knob.** We tune the same attack from "generous" on
  an early floor to "tight" on a deep one without redesigning it.

### Aim tracking, then lock (how aimed attacks stay dodgeable)

An aimed attack must **not** fire at your exact position on the strike frame — if it does,
moving during the wind-up buys you nothing and the attack is undodgeable. Instead the boss
**tracks you for most of the wind-up, then locks an aim point some milliseconds before
firing**, so the tail of the tell is your window to step off the line.

This is `aimLockMs` on `Spell` (and the `volley()` builder), in
`server/src/spells/` (the `SpellCaster` freezes the aim `aimLockMs` before the strike):

- For the first `windUpMs − aimLockMs`, the boss follows your position into its aim point.
- For the final `aimLockMs`, the aim is frozen — the shot lands where you *were*.
- `aimLockMs: 0` reproduces the old "snaps to you at the instant of firing" feel (no dodge
  window) — avoid it for slow, telegraphed attacks; it's only appropriate for a fast,
  short-tell shot that's *meant* to punish standing still (e.g. the Grey Wyvern's quick
  strike).

**Rule of thumb:** the slower and more telegraphed the attack, the larger the `aimLockMs`.
The Turtle Dragon's boulder belch uses `aimLockMs: 400` on a 900 ms wind-up. When adding an
aimed attack to any boss (or a future ranged enemy), set a non-zero `aimLockMs` unless you
specifically want an unavoidable snap-shot.

*(Future polish: surface the locked aim point as a ground marker so the freeze is visible,
not just felt.)*

### Telegraph vocabulary (shared visual language)

| Telegraph | Meaning | Example FX |
|---|---|---|
| **Line indicator** | a straight-line attack is coming along this ray | thin bright line in facing dir |
| **Ground marker** (circle) | an AOE will land here; often grows/fills as it locks | expanding ring / shadow |
| **Charge glow** | boss is winding up a big committed move | body flash, particles gathering |
| **Airborne shadow** | boss is above the arena; shadow shows where it will land | dark ellipse under flight path |
| **Cast rings** | a spell is being conjured; count = number of projectiles | orbiting orbs / runes |

### Phase decisions (per boss, per your call — mix of both)

| Boss | Structure |
|---|---|
| Turtle Dragon | **2 phases** (enrage at 50%) |
| Fire / Green / Grey Wyvern | **Flat rotation** + a low-HP desperation move |
| Centaur Knight | **2 phases** (drops to relentless charging at 50%) |
| Big Beast | **2 phases** (enrage at 40%) |
| Batwing Buttstomper | **3 phases** (ground → aerial → frenzy) |
| Tengu Mask | **Summon-gated** (invulnerable during Stoneface until adds die) |

---

## 🐢 Turtle Dragon — *the Bulwark*
**Role:** slow, armored area-denial tank. Punishes greed; rewards patience and reading its
two big committed moves. **Sprite rows:** idle / walk / spin / damage.

A wall of a boss. It has huge knockback resistance and doesn't chase hard — it *controls
space* and forces you to fight on its terms, then over-commits so you can strike back.

**Phase 1 (100%–50%)**
- **Shell Spin Dash** *(signature)* — Wind-up (~0.8s): withdraws into shell, rattles, dust
  kicks up. Strike: rockets in a straight line toward your telegraphed position,
  **ricocheting off up to 3 walls** over ~2.5s; immune to knockback while spinning.
  Dodge: step off the line, then read each bounce. Recovery: on its final bounce it
  bursts out dizzy and **stunned ~1.5s (exposed head)** — the prime punish window.
- **Tremor Slam** — Wind-up (~0.7s): rears up on hind legs. Strike: slams down and sends
  **four cracks racing outward along the cardinal directions** (line hazards). Dodge:
  stand on a diagonal / between the cracks.
- **Boulder Belch** — lobs 1–3 rocks that arc to **growing ground markers**, then burst
  (Explosion 32×32). Dodge: leave the marked circles before they land.

**Phase 2 (below 50%) — enrage**
- Spin Dash gains extra ricochets and **chains into a second spin** if it still has line of
  sight (shorter recovery — punish is tighter).
- Tremor Slam fires **eight cracks** (cardinals + diagonals) — you must move *through* the
  slam's origin ring rather than stand still.

---

## 🐉 Wyvern (Fire) — *the Scorch*
**Role:** mobile aerial zoner. Stays airborne and at range, raining projectiles; only
drops low (meleeable) during recovery windows. High knockback resistance. **Sprite rows:**
flap / breath. **Structure:** flat rotation + a desperation dive under ~25% HP.

- **Fire Breath Cone** — Wind-up (~0.9s): inhales, head glows, a **cone telegraph** fans
  out in its facing. Strike: sweeps a cone of flame and **leaves 2–3 Looping-Fire hazard
  tiles** burning for ~4s. Dodge: exit the cone (easiest around the sides); then avoid the
  fire puddles it leaves.
- **Fireball Volley** — lobs 3 fireballs at your position with slight lead; each blooms a
  small flame on impact. Dodge: move perpendicular, keep flowing.
- **Strafing Hover** — repositions around the arena; every few cycles it **swoops low**
  (its only easily-meleed moment). Reward for staying close during the swoop.
- **Fire Dive** *(desperation, <25%)* — marks a player, dives along a fiery trail, then is
  **grounded and exposed ~1.5s**. Big punish, big risk.

## 🐉 Green Wyvern (Poison) — *the Blight*
Same silhouette, an **attrition/zoning** twist — it fills the floor with hazards so you're
always moving.
- **Acid Spit** — arcing globs that leave **lingering poison puddles** (slow + damage-over-
  time) where they land. Dodge the globs *and* the puddles.
- **Miasma Drop** — flaps down a **spreading gas cloud** at a marked spot that lingers ~6s;
  area you simply can't stand in.
- **Toxic Breath Cone** — the fire cone's cousin; the residue puddle **slows** instead of
  burning, setting up its other attacks.
- *Desperation:* **Death Cloud** — blankets a large ring, leaving only a moving safe gap to
  track.

## 🐉 Grey Wyvern (Lightning) — *the Tempest*
The **fastest, most precise** of the trio — deepest floor. Punishes slow reactions with
short, sharp telegraphs.
- **Chain Lightning Strike** — marks 2–3 ground spots that **bolt down after only ~0.7s**
  (fast tell — punishes standing still). Bolt/Lightning FX.
- **Static Burst** — charges (body crackles), then **discharges a ring around itself** —
  melee-range denial. Don't be adjacent when it pops; bait it, then re-engage.
- **Thunder Dash** — blinks a short distance, leaving a **lightning line between start and
  end** for ~0.5s. Dodge the connecting line, not just the endpoints.
- *Desperation:* **Storm Cell** — several bolts strike in a fast marching pattern; read the
  safe lane.

---

## 🐴 Centaur Knight — *the Duelist*
**Role:** honorable martial boss — a real one-on-one duel spanning melee, a committed
charge, and thrown lances. **Sprite rows:** idle / gallop / club / lance. **Structure:**
2 phases (grows more aggressive at 50%).

**Phase 1**
- **Lance Throw** — Wind-up (~0.7s): rears and cocks the lance, **line aim indicator**.
  Strike: hurls a fast lance in a straight line that sticks in the far wall. Sometimes a
  **3-lance fan** (wider, but clear gaps). Dodge: sidestep the line(s).
- **Gallop Charge** — Wind-up (~0.9s): paws the ground, faces you, **line telegraph**.
  Strike: charges across the whole room with heavy knockback. If it **hits a wall it's
  stunned ~1.5s** (punish). Dodge: step off the line — or bait it into a wall for the
  opening.
- **Club Sweep** — up close only. Wind-up (~0.5s): raises the club. Strike: **180° arc**
  in front of it. Dodge: slip behind it or back out of the arc; recovery after the swing
  is a punish window.

**Phase 2 (<50%)** — drops the shield-and-duel pacing for relentless mobility:
- **Charge Feint** — telegraphs a charge, **stutter-steps, then charges** (or double-
  charges) — you must confirm the commit, not flinch at the tell.
- **Lance Rain** — flings several lances skyward that **rain onto marked spots** across the
  arena. Read the safe gaps.
- Gallop and Club cadence tightens.

---

## 🦍 Big Beast — *the Juggernaut*
**Role:** raw-power close/mid bruiser — throws the environment at you and bowls you over.
**Sprite rows:** idle / walk / hit-throw / roll. **Structure:** 2 phases (enrage at 40%).

**Phase 1**
- **Boulder Hurl** — Wind-up: rips a rock from the ground (arms overhead). Strike: throws
  it at your marked position; on impact it **shatters (Explosion) into a few fragment
  projectiles** that scatter outward. Dodge: leave the marker, then mind the shrapnel.
- **Rolling Charge** — curls into a ball (wind-up shake), then **rolls in a curving,
  slowly-homing path** chasing you for ~2s. It turns *slowly* — juke with sharp direction
  changes. Ends by uncurling **dizzy (punish window)**. Reused: it can also **crash into a
  wall** for a bigger stun.
- **Ground Slam** — up close. Wind-up: raises both fists. Strike: **radial shockwave ring**
  with a **safe zone beyond a certain radius**. Dodge: back out of the ring's reach.

**Phase 2 (<40%) — enrage**
- **Seismic Stomps** — a **rhythm sequence**: stomps 3–4 times, each sending a small ring
  outward on a beat. Dodge the pulses in time — a mini bullet-hell cadence.
- Rolling Charge chains into a Boulder Hurl on exit.

---

## 🦇 Batwing Buttstomper — *the Flagship*
**Role:** the spectacle boss — alternates ground bullet-spread with airborne AOE slams.
The most mechanically rich fight and the one that most needs the new airborne + AOE tech.
**Sprite rows:** idle / walk / breath / crouch-jump / flap / stomp. **Structure:** 3 phases.

**Phase 1 — Ground pressure**
- **Orb Spray / Fire Breath** — breathes a **slow fan of magic orbs** (or a fire stream)
  across an arc. The orbs drift outward with gaps — **weave between them** (bullet-hell-
  lite). Dodge: read the spread, thread a gap.
- **Wing Gust** — flaps hard, a **damageless knockback wind** that shoves you back (and can
  push you toward hazards / into the next attack's marker). Pure spacing tool.

**Phase 2 — Aerial (unlocks Buttstomp)**
- **Buttstomp** *(signature)* — Wind-up (~0.8s): crouches, wings flare. **Launches
  airborne (untargetable); an airborne shadow marks a growing ground circle that tracks
  toward a player**, locking after ~1.2s. Then it slams down → **big shockwave AOE** (Big
  Explosion 48×48 + expanding dust ring). Dodge: keep moving while marked; be *outside* the
  ring radius on impact. Recovery: **landing lag ~1s (punish window)**.

**Phase 3 — Frenzy (<33%)**
- **Triple Stomp** — chains **three rapid Buttstomps** hopping across the arena, then an
  Orb Spray as you scatter. The signature combo — the climax of the fight.

---

## 👺 Tengu Mask — *the Trickster*
**Role:** the caster/attention boss — ranged zoning, summons, teleport evasion, illusions,
and a hard invulnerability gate. This is the fight that demands *managing several things at
once*. **Sprite rows:** idle-look / cast(orb, lightning) / cast(split, teleport, summon) /
stoneface. **Structure:** summon-gated phases (see Stoneface).

- **Orb Barrage** — conjures **3–5 magicOrbs that orbit it (cast rings)**, then **launches
  them one at a time** at you in sequence (each glows just before firing). Dodge: weave;
  the staggered fire is readable.
- **Lightning Pillars** — marks several ground spots that **erupt in lightning pillars
  after ~0.8s**, often in a **spreading/marching pattern** — cross the arena reading the
  safe gaps.
- **Teleport** — not an attack: **blinks away (smoke puff both ends)** when you close to
  melee or on a timer. Its anti-melee tool — punish the moment *after* it re-appears,
  before it casts.
- **Mirror Split** — spawns **1–2 illusory copies** that also throw orbs. Only the real one
  can be damaged; it's distinguishable by a subtle tell (e.g. the copies flicker / cast
  slightly out of sync). Adds a target-identification layer.
- **Summon → Stoneface** *(phase gate)* — casts to **spawn a wave of minions**
  (float-skulls / bats), then immediately **turns to stone: fully invulnerable and inert.**
  It stays stone **until its summons are cleared** (or a timeout). Players must fight the
  adds — while dodging any lingering hazards — to break the shell and re-expose it. This is
  the fight's rhythm: an **aggressive casting phase** (orbs / lightning / split) alternating
  with a **defensive summon phase**.

---

## Cross-cutting engine capabilities these movesets imply

Recorded here so the design and the eventual build stay in sync. Roughly ordered by how
many bosses each unlocks:

1. **Boss AI** — a scripted/weighted ability picker with per-ability cooldowns and explicit
   **wind-up → strike → recovery** timing, plus optional **HP-threshold phase switches**.
   Replaces the Goo touch-attack for bosses.
2. **Enemy-owned projectiles** — the existing `Projectile` system hits *enemies*
   (player-fired). Boss breath / lance / orb / boulder / fireball need a **team/owner** so
   projectiles can damage **players**. Unlocks 6 of 8 bosses.
3. **Telegraph primitives** — line indicators, growing ground markers, cast rings; a short
   "danger zone then damage" scheduler. Every boss.
4. **Point-radius / ring AOE damage** — buttstomp, tremor cracks, ground slam, lightning
   pillars, static burst.
5. **Dash / charge movement mode** with an active contact hitbox and wall-stun-on-impact —
   spin, gallop, roll, thunder dash.
6. **Airborne / untargetable state** + ground-target marker — buttstomp (needs a schema
   flag + client render of the shadow).
7. **Summon hook** into the enemy spawner; **invulnerability flag** (Stoneface). Teleport
   already exists via `Entity.teleport()`.
8. **Lingering ground hazards** (fire/poison/gas tiles with a lifetime + on-tick effect) —
   wyverns, some AOE residue.

## Bestiary integration

Each boss section above maps to `static` fields on the boss class (the `BossClass` type in
`server/src/entities/bosses/index.ts` requires them):

```ts
static readonly lore = "…";                              // the role blurb
static readonly abilities = [{ name, desc }, …];         // one entry per move
```

Design lives right next to the moveset on the `Boss` subclass. (These are bestiary *text*,
separate from the runtime `abilities(): Spell[]` moveset — a future cleanup could derive the
text from the spells so they can't drift.)
