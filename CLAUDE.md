@AGENTS.md

# Engine architecture — read before editing game.js

Top-down procedural roguelike shooter. The engine is intentionally small and
lives entirely in `game.js` (AGENTS.md forbids editing other files; the
platform forbids `import`/`require`). Modularity comes from clearly delimited
sections, the weapon/mod/perk/enemy registries as the single source of truth,
and a fixed-timestep simulation.

The player is a single triangle. Each level is a procgen room of cover blocks;
clear the enemies, walk into the portal, repeat. Every `ALTAR_EVERY` levels
the room is replaced by an altar with three random boons (mod / perk / heal).

## Section layout in game.js

```
1.  Config & constants     — W/H, TILE, COLS/ROWS, TICK_RATE, NOISE_GUNSHOT, ALTAR_EVERY
2.  Cabinet input          — CABINET_KEYS (preserve verbatim) + held/pressed
3.  Registries             — WEAPONS, MODS, PERKS, ENEMIES (single source of truth)
4.  Phaser bootstrap       — config + new Phaser.Game(...) + create()
5.  Map gen + LOS          — emptyMap, genLevel, hasLOS, pickFreeTile
6.  Game flow              — goTitle, startRun, enterLevel, spawnAltar, nextLevel, gameOver
7.  Player                 — makePlayer, controlPlayer, fireOnce, perk multipliers
8.  Enemies + AI           — makeEnemy, emitNoise, updateAI, findCoverSpot
9.  Physics                — moveEntity, collidesWalls, updateBullets, explode
10. Combat                 — damageEnemy, killEnemy, damagePlayer
11. Pickups & altar        — takePickup, controlAltar, applyChoice
12. Tick loop              — runTick, updateParticles
13. Render                 — render, drawMap/Player/Enemies/SightCones/Bullets/HUD
14. Audio                  — blip + sfx*
15. Utils / storage        — angDiff, lerpAngle, loadBest, saveBest
```

Keep functions ≤ ~40 lines. If a function grows past that, extract a helper
*in the same section*.

## Registries — the single source of truth

Adding content = appending one row to a registry, no other code edits needed
unless the behavior is genuinely new.

### WEAPONS
```js
{ dmg, rate, mag, reload, spread, range, speed, n, trigger, bcol, name,
  exp?, pierce?, bounce?, vamp?, crit?, knock?, silent? }
```
- `rate`: ticks between shots (60/s).
- `trigger`: `'auto'` (hold P1_1), `'semi'` (tap), `'burst3'` (tap → 3-round burst).
- `n`: bullets per shot (pellets for shotgun).
- `exp`: blast radius on bullet impact.
- `pierce`: pass-through count (sniper has 3 by default).
- Optional fields are populated by **mods** at runtime (`MODS.<id>.apply(w)`).

### MODS
`{ name, desc, apply(w) }`. `apply` mutates a *weapon instance* (returned by
`makeWeaponInst`). Mods are stackable and stored in `w.mods`. Adding a new mod
= add the row + ensure its read-side hook exists in `fireOnce` /
`updateBullets` / `damageEnemy`.

### PERKS
`{ name, desc }` only — perk effects live in the player helpers
(`playerSpeed`, `playerMaxHp`, `playerDmgMul`, `playerRangeMul`,
`playerReloadMul`, `playerMagMul`) plus a few inline checks
(`hasPerk('vampire')` in `killEnemy`, `hasPerk('dodge')` in bullet vs player,
`hasPerk('multi')` in `fireOnce`, `hasPerk('ghost')` in `updateAI`,
`hasPerk('regen')` in `controlPlayer`). Adding a new perk = add the row + the
read-side hook in the relevant helper.

### ENEMIES
`{ hp, weapon, speed, sight, cone, hear, coverIQ, col, r, react, fly?, score }`.
- `weapon`: id from WEAPONS — built once per spawn via `makeWeaponInst`.
- `sight` / `cone`: detection cone (radius px / full-cone radians).
- `hear`: noise pickup radius. `0` means deaf (drones).
- `coverIQ` (0..1): probability the enemy seeks cover when reloading.
- `fly: true` ignores cover blocks for movement (drones).

## Fixed-timestep simulation

`update(time)` accumulates real time and dispatches `runTick()` at
`TICK_RATE = 60`. Movement, cooldowns, AI cadence, bullet life are all
per-tick. `MAX_TICKS_PER_FRAME = 5` prevents spiral-of-death after the tab
returns from background. **Never multiply movement by frame `dt`** in the
tick path — velocities are already per-tick.

## Player struct (`makePlayer`)

- `x, y, vx, vy, facing` — kinematic state. Aim equals last movement direction.
- `hp, maxHp` — `maxHp` is recomputed from perks via `playerMaxHp()`.
- `weapons[]` (max 2) + `weaponIdx` — pickup with empty slot adds, otherwise
  swaps the active weapon. `P1_3` cycles when no pickup is in range.
- `perks[]` — list of perk ids. Effects read live from registry helpers.
- `iframes` — short post-hit invuln (18 ticks).
- `burstLeft, burstTimer` — drives 3-round-burst trigger weapons.

## AI state machine (`updateAI`)

States: `patrol → alert → engage`. Transitions are alert-driven:

- **patrol**: walk between random walkable tiles, idle look-around. Sight cone
  fills `e.alert` toward 1 when LOS to player + within cone + within `sight`.
- **alert**: heard a gunshot or partially saw the player. Turn toward
  `lastSeen`, walk there. Drops back to patrol when alert decays to ~0.
- **engage**: full alert. Maintain `preferredRange`, take cover when reloading
  if `coverIQ` rolls succeed. Lost LOS → walks to last seen, falls back to
  alert if it gets there with no contact.

`findCoverSpot` samples 24 candidate offsets around the enemy (3 rings × 8
directions) and picks the closest walkable spot whose LOS to the player is
**blocked**. Cheap and good-enough; tune by adding more rings if needed.

`emitNoise(x, y, radius, source)` is called by `fireOnce` whenever a
non-silent weapon fires. Drones (`fly: true`) ignore noise.

## LOS

`hasLOS(map, x0, y0, x1, y1)` walks the segment in 6-px steps and reports
blocked if any sample falls inside a solid tile. Used by AI sight, cover
search, and (intentionally NOT) by bullets — bullets do their own per-tick
tile check so they can resolve mid-flight.

## Bullets

Single flat array `bullets[]`. Each bullet carries `pierce`, `bounce`, `exp`,
`vamp`, `knock`, `crit`, owner tag (`'p'`/`'e'`), and a `hits` Set so a single
piercing bullet can't double-hit the same target.

`updateBullets` resolves wall collision (with optional bounce), then iterates
the right team for hit detection. Bullets terminate on out-of-bounds, life
expiry, wall hit (or on bounce exhaustion), or after exhausting pierce.

## Cover system

There is **no separate cover/half-cover layer**. A solid tile blocks both
movement, sight (LOS), and bullets. To make cover meaningful, the map gen
scatters small wall clusters (1–3 tiles each) inside the room. `coverIQ`
makes individual enemies value cover differently — drones have 0, snipers 1.

## Render path

Single Phaser `Graphics` object cleared and redrawn each frame. Order:
background → grid → walls → pickups → portal → altar circles → enemies →
player → bullets → explosions → particles → sight cones → HUD bar.

The HUD is a single Phaser `Text` updated each frame
(`HP / WEAPON / AMMO / MODS / LV / SCORE / PERKS`). The center `msgText` is
used for level transitions, altar prompts, and end-of-run text.

## Pickup logic (P1_3)

Single button. Nearest pickup within `PICKUP_R + 6` wins. If there is no
pickup in range and you carry 2 weapons, P1_3 cycles the active weapon. At
altars, P1_3 takes the closest podium boon.

## Storage

`window.platanusArcadeStorage` persists `trigon-best` = `{ best: <levelN> }`.
Validated on read because the platform may change shape. Score is run-local.

## Files you can edit

`game.js`, `metadata.json`, `cover.png`, **and this `CLAUDE.md`**. Nothing
else (per AGENTS.md).
