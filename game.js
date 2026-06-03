// Platanus Hack 26 — ONE MORE EXTRACTION
// Procedural roguelike top-down shooter. You're a triangle.

// ========================================================================
// 1. CONFIG & CONSTANTS
// ========================================================================
const W = 800, H = 600;
const TILE = 40;
// World dims grow with level (see sizeForLevel). Start values mirror the old constants.
let WORLD_COLS = 60, WORLD_ROWS = 40;
let WORLD_W = WORLD_COLS * TILE;
let WORLD_H = WORLD_ROWS * TILE;
// Generic "stay-clear-from-X" radius scaled by map area. Recomputed per level.
let CLEARANCE = 320;
const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;
const MAX_TICKS_PER_FRAME = 5;
const PLAYER_BASE_HP = 150;
const PLAYER_BASE_SPEED = 2.6;
const PLAYER_R = 11;
const PICKUP_R = 22;
const NOISE_GUNSHOT = 290;
const NOISE_FOOTSTEP = 110;
const SIGHT_FILL_PER_TICK = 1 / 18;
const HACK_DURATION = 360;             // ticks ~ 6 seconds
const BARREL_BLAST = 100;
const BARREL_DMG = 55;

// ========================================================================
// 2. CABINET KEYS (preserve verbatim — physical wiring)
// ========================================================================
// Static map from raw key → arcade code. Only the actually-read codes are
// listed; P2_*, P1_4-6, and START2 were dead config.
const KEY_TO_ARCADE = {
  w:'P1_U', s:'P1_D', a:'P1_L', d:'P1_R',
  u:'P1_1', i:'P1_2', o:'P1_3', Enter:'START1',
};
const held = Object.create(null), pressed = Object.create(null);
window.addEventListener('keydown', (e) => {
  const c = KEY_TO_ARCADE[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (c) { if (!held[c]) pressed[c] = true; held[c] = true; }
});
window.addEventListener('keyup', (e) => {
  const c = KEY_TO_ARCADE[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (c) held[c] = false;
});
function consumePress(c) { const v = pressed[c]; pressed[c] = false; return v; }

// ========================================================================
// 3. REGISTRIES (single source of truth)
// ========================================================================
const WEAPONS = {
  pistol:   { dmg: 14, rate: 16, mag: 12, reload: 50, spread: 0.04, range: 340, speed: 14, n: 1, trigger: 'semi',   bcol: 0xffffff, name: 'PISTOL' },
  shotgun:  { dmg: 7,  rate: 32, mag: 6,  reload: 85, spread: 0.32, range: 220, speed: 13, n: 7, trigger: 'semi',   bcol: 0xffaa44, name: 'SHOTGUN' },
  smg:      { dmg: 5,  rate: 5,  mag: 30, reload: 60, spread: 0.16, range: 250, speed: 14, n: 1, trigger: 'auto',   bcol: 0xfff0a0, name: 'SMG' },
  rifle:    { dmg: 11, rate: 9,  mag: 25, reload: 70, spread: 0.05, range: 380, speed: 16, n: 1, trigger: 'auto',   bcol: 0xffffff, name: 'RIFLE' },
  burst:    { dmg: 13, rate: 24, mag: 24, reload: 65, spread: 0.04, range: 360, speed: 16, n: 1, trigger: 'burst3', bcol: 0xc0e0ff, name: 'BURST RIFLE' },
  sniper:   { dmg: 80, rate: 60, mag: 4,  reload: 95, spread: 0.0,  range: 900, speed: 22, n: 1, trigger: 'semi',   pierce: 3, bcol: 0x66ccff, name: 'SNIPER' },
  lmg:      { dmg: 8,  rate: 4,  mag: 80, reload: 150, spread: 0.18, range: 320, speed: 14, n: 1, trigger: 'auto',  bcol: 0xffe070, name: 'LMG' },
  launcher: { dmg: 30, rate: 55, mag: 3,  reload: 110, spread: 0.0, range: 340, speed: 9,  n: 1, trigger: 'semi',   exp: 90, expDmg: 30, bcol: 0xff7733, name: 'LAUNCHER' },
  flamer:   { dmg: 3,  rate: 3,  mag: 60, reload: 90,  spread: 0.45, range: 140, speed: 4,  n: 3, trigger: 'auto',   bcol: 0xff7722, burn: 110, burnDmg: 2, flame: true, banMods: ['expl', 'ricochet', 'incend', 'poison', 'laser'], name: 'FLAMER' },
};
const WEAPON_IDS = Object.keys(WEAPONS);

const MODS = {
  rapid:    { name: 'RAPID',     desc: '-30% fire delay', apply: w => { w.rate = Math.max(2, w.rate * 0.7 | 0); } },
  magplus:  { name: 'EXT MAG',   desc: '+50% magazine',   apply: w => { w.mag = Math.ceil(w.mag * 1.5); } },
  pierce:   { name: 'PIERCE',    desc: '+1 pierce',       apply: w => { w.pierce = (w.pierce || 0) + 1; } },
  expl:     { name: 'EXPLOSIVE', desc: '+blast radius & dmg', apply: w => { w.exp = (w.exp || 0) + 36; w.expDmg = (w.expDmg || 0) + 10; } },
  vamp:     { name: 'LIFESTEAL', desc: 'heal 8% damage',  apply: w => { w.vamp = (w.vamp || 0) + 0.08; } },
  crit:     { name: 'CRIT',      desc: '+25% headshot (base 5%)', cap: 4, apply: w => { w.crit = (w.crit || 0) + 0.25; } },
  ricochet: { name: 'RICOCHET',  desc: '+1 bounce',       apply: w => { w.bounce = (w.bounce || 0) + 1; } },
  magnum:   { name: 'MAGNUM',    desc: '+40% damage',     apply: w => { w.dmg = w.dmg * 1.4; } },
  silenced: { name: 'SILENCED',  desc: 'no noise',        cap: 1, apply: w => { w.silent = true; } },
  multi:    { name: 'MULTISHOT', desc: '+1 bullet/shot',  apply: w => { w.n = (w.n || 1) + 1; } },
  incend:   { name: 'INCENDIARY',desc: '+burn DOT (short, hot)',  apply: w => { w.burn = (w.burn || 0) + 60;  if (!w.burnDmg) w.burnDmg = 2; } },
  poison:   { name: 'POISON',    desc: '+venom DOT (long, slow)', apply: w => { w.poison = (w.poison || 0) + 160; if (!w.poisonDmg) w.poisonDmg = 1; } },
  laser:    { name: 'LASER',     desc: '+15% range, -50% spread', cap: 1, apply: w => { w.range *= 1.15; w.spread *= 0.5; w.laser = true; } },
};
const MOD_IDS = Object.keys(MODS);

const ENEMIES = {
  grunt:   { hp: 25, weapon: 'pistol',  speed: 1.1, sight: 420, cone: 1.4, col: 0x88aaff, r: 12, react: 25,  score: 5 },
  runner:  { hp: 20, weapon: 'smg',     speed: 1.7, sight: 360, cone: 1.6, col: 0xc9a06a, r: 10, react: 18,  score: 7,  pr: 150 },
  sniper:  { hp: 22, weapon: 'sniper',  speed: 0.9, sight: 720, cone: 1.0, col: 0xcccccc, r: 11, react: 36,  score: 12, pr: 380 },
  bruiser: { hp: 65, weapon: 'shotgun', speed: 0.95,sight: 340, cone: 1.7, col: 0x4d5d2b, r: 16, react: 22,  score: 10, pr: 130 },
  pyro:    { hp: 55, weapon: 'flamer',  speed: 1.05,sight: 320, cone: 1.6, col: 0xff5522, r: 13, react: 20,  score: 14, pr: 110 },
  gunner:  { hp: 75, weapon: 'lmg',     speed: 0.75,sight: 380, cone: 2.0, col: 0x778899, r: 14, react: 30,  score: 15 },
  demo:    { hp: 22, weapon: 'launcher',speed: 1.0, sight: 360, cone: 1.5, col: 0x553388, r: 12, react: 50,  score: 16 },
};
const ENEMY_IDS = Object.keys(ENEMIES);
// Skin tones used as random head-inner color per enemy spawn.
const SKINS = [0xffe0b8, 0xf2cba0, 0xe0a878, 0xc08858, 0xa06838, 0x704020, 0x3a2010];

// ------------------------------------------------------------------------
// Narrative tables (codenames, factions, briefings, chatter, callbacks).
// All strings inline; placeholders {HANDLER} {FACTION} {NAME} {PAST_NAME}
// are filled by renderTemplate().
// ------------------------------------------------------------------------
// Codename + faction tables (used by spawn naming + objText/death screen).
const FIRE_COLS = [0xff4422, 0xff8833, 0xffcc44, 0xffee88];
const POISON_COLS = [0x33aa22, 0x66cc44, 0xaaee55, 0xccff88];
const ADJECTIVES = ['GHOST','BLIND','SILENT','HOLLOW','IRON','PALE','GREY','LAST'];
const NOUNS      = ['CARDINAL','ORCHID','VESPER','SPIRE','HARROW','EMBER','OBELISK','SAINT'];
const FACTIONS   = ['THE HOLLOW','OBSIDIAN','BLACK TIDE','GLASSWORKS'];

// ========================================================================
// 4. MATH & HELPER UTILS (used everywhere — keep small + pure)
// ========================================================================
function angDiff(a, b) {
  let d = a - b;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
// Squared distance — saves the sqrt vs Math.hypot when only comparing.
const d2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
// Random element of an array.
const pickFrom = arr => arr[(Math.random() * arr.length) | 0];
// Pixel → tile coord.
const pt = v => (v / TILE) | 0;
// Ephemeral center toast. New calls replace prior — single channel, no queue.
function showToast(text, col) {
  toast.text = text;
  toast.col = col || '#fff';
  toast.t = 150;
  toast.max = 150;
}
// Generic DOT tick — emits a rising particle of `pal` color and applies damage
// every 8 ticks. Used by burn (fire) and poison; both can be active at once.
function tickDot(e, key, pal) {
  if (e.hp <= 0 || !e[key] || e[key] <= 0) return;
  particles.push({
    x: e.x + (Math.random() - 0.5) * 14,
    y: e.y - 4 + (Math.random() - 0.5) * 8,
    vx: (Math.random() - 0.5) * 0.6,
    vy: -0.7 - Math.random() * 0.6,
    life: 18,
    col: pal[(Math.random() * 4) | 0],
    r: 3 + Math.random() * 2,
  });
  if ((e[key] & 7) === 0) {
    e.hp -= e[key + 'Dmg'];
    if (e.hp <= 0) killEnemy(e, key);
  }
  e[key]--;
}
// Size of the world for a given level. Caps prevent runaway memory + camera.
function sizeForLevel(n) {
  return {
    cols: Math.max(60, Math.min(140, 60 + ((n * 1.5) | 0))),
    rows: Math.max(40, Math.min(100, 40 + n)),
  };
}
// Apply a level's world dims globally — must be called BEFORE genLevel.
function applyWorldSize(n) {
  const sz = sizeForLevel(n);
  WORLD_COLS = sz.cols; WORLD_ROWS = sz.rows;
  WORLD_W = WORLD_COLS * TILE; WORLD_H = WORLD_ROWS * TILE;
  CLEARANCE = Math.sqrt(WORLD_COLS * WORLD_ROWS) * TILE * 0.15 | 0;
  if (scene && scene.cameras) scene.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
}
// Tile helpers: tileAt uses 1 (solid) outside the map so out-of-bounds
// always blocks LOS and movement. tileCenter returns world-space [x, y].
function tileAt(m, cx, cy) {
  if (cx < 0 || cy < 0 || cx >= WORLD_COLS || cy >= WORLD_ROWS) return 1;
  return m[cy * WORLD_COLS + cx];
}
const setTile = (m, cx, cy, v) => { m[cy * WORLD_COLS + cx] = v; };
const tileCenter = (cx, cy) => [cx * TILE + TILE / 2, cy * TILE + TILE / 2];
const isSolid = (m, cx, cy) => tileAt(m, cx, cy) === 1;

// ========================================================================
// 5. PHASER BOOTSTRAP
// ========================================================================
const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: W, height: H,
  parent: 'game-root',
  backgroundColor: '#0a0d12',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: { create, update },
});

let g, gHud, hudText, msgText, objText, scene, timerText, toastText, titleText;
let acc = 0, lastT = 0;

let mode = 'title';
let player, bullets = [], enemies = [], pickups = [], particles = [], explosions = [];
let props = [];                          // barrels, terminals, cages
let bloodStains = [];                    // permanent floor splats; FIFO-capped
let corpses = [];                        // dead-enemy bodies, stay rendered until level change
let hostage = null, mission = null, mapRooms = [];
let map, levelN = 1, score = 0, best = 0, portal = null;
let bestScores = [];   // top 5: [{ s: score, lv: level }, ...] sorted desc
let roomsWithItems = new Set();   // rooms that already contain a pickup/objective; one item per room
// Narrative state — picked at startRun, referenced by objText + death screen.
let factionName = 'THE HOLLOW';
let runRoster = [];               // unused codenames left in this run, popped per spawn
let runHistory = [];              // {name, kind, fate, level} for every named entity this run
let frameCount = 0;
let footstepCounter = 0;
// Toast: ephemeral 2-line center message for pickups, detection, breach, mission events.
let toast = { t: 0, max: 0, col: '#ffffff', text: '' };
let musicStarted = false, musTimer = null, musStep = 0;

function create() {
  scene = this;
  g = this.add.graphics();
  gHud = this.add.graphics().setScrollFactor(0).setDepth(900);
  hudText = this.add.text(8, 44, '', { fontFamily: 'monospace', fontSize: '13px', color: '#cfd' })
    .setScrollFactor(0).setDepth(1000);
  objText = this.add.text(W / 2, 116, '', { fontFamily: 'monospace', fontSize: '14px', color: '#ffd060', align: 'center' })
    .setOrigin(0.5, 0).setScrollFactor(0).setDepth(1000);
  msgText = this.add.text(W / 2, 120, '', { fontFamily: 'monospace', fontSize: '17px', color: '#fff', align: 'center' })
    .setOrigin(0.5, 0).setScrollFactor(0).setDepth(1000);
  // Big stealth timer, top-right under the GPS compass.
  timerText = this.add.text(W - 60, 50, '', { fontFamily: 'monospace', fontSize: '24px', color: '#ffd060', align: 'center' })
    .setOrigin(0.5, 0).setScrollFactor(0).setDepth(1000);
  // Toast: short-lived center notice (pickups, detection, hack, mission complete).
  toastText = this.add.text(W / 2, H / 2 - 60, '', { fontFamily: 'monospace', fontSize: '22px', color: '#fff', align: 'center', stroke: '#000', strokeThickness: 3 })
    .setOrigin(0.5).setScrollFactor(0).setDepth(1000);
  // Big title (shown on title/gameover/pause screens).
  titleText = this.add.text(W / 2, 70, '', { fontFamily: 'monospace', fontSize: '36px', color: '#ffd060' })
    .setOrigin(0.5).setScrollFactor(0).setDepth(1000);
  this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
  loadBest();
  goTitle();
}

function update(time) {
  if (lastT === 0) lastT = time;
  acc += time - lastT;
  lastT = time;
  let steps = 0;
  while (acc >= TICK_MS && steps < MAX_TICKS_PER_FRAME) {
    runTick();
    acc -= TICK_MS;
    steps++;
    frameCount++;
  }
  if (player && mode === 'play') {
    const cam = scene.cameras.main;
    cam.scrollX += (player.x - W / 2 - cam.scrollX) * 0.15;
    cam.scrollY += (player.y - H / 2 - cam.scrollY) * 0.15;
  }
  render();
}

// ========================================================================
// 6. MAP GEN + LOS  (BSP rooms+corridors → m: Uint8Array, rooms: list)
// ========================================================================
function hasLOS(m, x0, y0, x1, y1) {
  const steps = Math.max(2, (Math.hypot(x1 - x0, y1 - y0) / 8) | 0);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    if (isSolid(m, pt(x), pt(y))) return false;
  }
  return true;
}

// BSP rooms-and-corridors. Returns map + room list.
function genLevel(n) {
  const m = new Uint8Array(WORLD_COLS * WORLD_ROWS);
  for (let i = 0; i < m.length; i++) m[i] = 1;
  const rooms = [];
  bspGen(m, 1, 1, WORLD_COLS - 2, WORLD_ROWS - 2, 9, rooms);
  carveRect(m, 1, 1, 5, 5);
  carveRect(m, WORLD_COLS - 6, WORLD_ROWS - 6, 5, 5);
  const startR = nearestRoom(rooms, 3, 3);
  const endR = nearestRoom(rooms, WORLD_COLS - 3, WORLD_ROWS - 3);
  if (startR) carveCorridor(m, 3, 3, startR.cx, startR.cy);
  if (endR) carveCorridor(m, WORLD_COLS - 3, WORLD_ROWS - 3, endR.cx, endR.cy);
  // tactical cover inside larger rooms
  const coverPieces = 22 + Math.min(40, n * 2);
  for (let i = 0; i < coverPieces; i++) {
    const r = pickFrom(rooms);
    if (!r || r.w < 5 || r.h < 5) continue;
    const cx = r.x + 1 + (Math.random() * (r.w - 2) | 0);
    const cy = r.y + 1 + (Math.random() * (r.h - 2) | 0);
    if (cx > 0 && cx < WORLD_COLS - 1 && cy > 0 && cy < WORLD_ROWS - 1) {
      if (Math.abs(cx - r.cx) + Math.abs(cy - r.cy) > 1) setTile(m, cx, cy, 1);
    }
  }
  // procedural floor variation flag map (purely visual). Not included in m;
  // we reuse a hash from coords at draw time, so no extra storage.
  return { m, rooms };
}

function bspGen(m, x, y, w, h, minLeaf, rooms) {
  const canSplitV = w >= minLeaf * 2;
  const canSplitH = h >= minLeaf * 2;
  let splitV;
  if (canSplitV && canSplitH) splitV = (w / h > 1.25) ? true : (h / w > 1.25 ? false : Math.random() < 0.5);
  else if (canSplitV) splitV = true;
  else if (canSplitH) splitV = false;
  else {
    const room = carveRoomIn(m, x, y, w, h);
    if (room) rooms.push(room);
    return room;
  }
  let left, right;
  if (splitV) {
    const sp = (minLeaf + Math.random() * (w - minLeaf * 2)) | 0;
    left = bspGen(m, x, y, sp, h, minLeaf, rooms);
    right = bspGen(m, x + sp, y, w - sp, h, minLeaf, rooms);
  } else {
    const sp = (minLeaf + Math.random() * (h - minLeaf * 2)) | 0;
    left = bspGen(m, x, y, w, sp, minLeaf, rooms);
    right = bspGen(m, x, y + sp, w, h - sp, minLeaf, rooms);
  }
  if (left && right) carveCorridor(m, left.cx, left.cy, right.cx, right.cy);
  return left || right;
}

function carveRoomIn(m, x, y, w, h) {
  const pad = 1 + (Math.random() * 2 | 0);
  const rw = Math.max(3, w - pad * 2);
  const rh = Math.max(3, h - pad * 2);
  const slackX = Math.max(0, w - rw - pad);
  const slackY = Math.max(0, h - rh - pad);
  const rx = x + pad + (Math.random() * (slackX - pad + 1) | 0);
  const ry = y + pad + (Math.random() * (slackY - pad + 1) | 0);
  carveRect(m, rx, ry, rw, rh);
  return { x: rx, y: ry, w: rw, h: rh, cx: rx + (rw / 2 | 0), cy: ry + (rh / 2 | 0) };
}

// Single inclusive rectangle carver. Used for rooms (rect), corridors
// (1-tile-thick H/V lines), and the start/exit boxes.
function carve(m, x0, y0, x1, y1) {
  if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
  if (y0 > y1) { const t = y0; y0 = y1; y1 = t; }
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (x > 0 && y > 0 && x < WORLD_COLS - 1 && y < WORLD_ROWS - 1) m[y * WORLD_COLS + x] = 0;
}
function carveRect(m, x, y, w, h) { carve(m, x, y, x + w - 1, y + h - 1); }
function carveCorridor(m, x0, y0, x1, y1) {
  if (Math.random() < 0.5) { carve(m, x0, y0, x1, y0); carve(m, x1, y0, x1, y1); }
  else                     { carve(m, x0, y0, x0, y1); carve(m, x0, y1, x1, y1); }
}

function nearestRoom(rooms, cx, cy) {
  let best = null, bd = 1e9;
  for (const r of rooms) {
    const d = (r.cx - cx) * (r.cx - cx) + (r.cy - cy) * (r.cy - cy);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}

function pickFreeTile(m, awayFromX, awayFromY, minDist) {
  for (let tries = 0; tries < 100; tries++) {
    const cx = 1 + (Math.random() * (WORLD_COLS - 2) | 0);
    const cy = 1 + (Math.random() * (WORLD_ROWS - 2) | 0);
    if (tileAt(m, cx, cy) !== 0) continue;
    const [px, py] = tileCenter(cx, cy);
    if (d2(px, py, awayFromX, awayFromY) < minDist * minDist) continue;
    return [cx, cy];
  }
  return null;
}

// 4-neighbour BFS over the tile grid starting at (sx, sy). Returns an
// Int16Array of walking distances in tiles; -1 = unreachable. Uses an array
// + head index instead of shift() to keep enqueue/dequeue O(1). Runs once
// per level so the constant overhead is irrelevant.
function tileBFS(m, sx, sy) {
  const dist = new Int16Array(WORLD_COLS * WORLD_ROWS).fill(-1);
  if (tileAt(m, sx, sy) !== 0) return dist;
  const idxOf = (x, y) => y * WORLD_COLS + x;
  dist[idxOf(sx, sy)] = 0;
  const q = [sx, sy];
  let head = 0;
  while (head < q.length) {
    const x = q[head++], y = q[head++];
    const d = dist[idxOf(x, y)];
    // 4 neighbours unrolled to avoid a small allocation per step.
    const cands = [x + 1, y, x - 1, y, x, y + 1, x, y - 1];
    for (let k = 0; k < 8; k += 2) {
      const nx = cands[k], ny = cands[k + 1];
      if (nx < 0 || ny < 0 || nx >= WORLD_COLS || ny >= WORLD_ROWS) continue;
      const ni = idxOf(nx, ny);
      if (m[ni] !== 0 || dist[ni] >= 0) continue;
      dist[ni] = d + 1;
      q.push(nx, ny);
    }
  }
  return dist;
}

// True when the room has at most one connected group of floor tiles on the
// ring of cells immediately outside its footprint — i.e. a single corridor
// exit, a real cul-de-sac. Walks the perimeter clockwise and counts
// transitions from non-floor to floor (circularly).
function isRoomLeaf(r, m) {
  const x0 = r.x - 1, y0 = r.y - 1;
  const x1 = r.x + r.w, y1 = r.y + r.h;
  const tiles = [];
  for (let x = x0; x <= x1; x++) tiles.push(x, y0);
  for (let y = y0 + 1; y <= y1; y++) tiles.push(x1, y);
  for (let x = x1 - 1; x >= x0; x--) tiles.push(x, y1);
  for (let y = y1 - 1; y > y0; y--) tiles.push(x0, y);
  const floorAt = (x, y) =>
    x >= 0 && y >= 0 && x < WORLD_COLS && y < WORLD_ROWS &&
    m[y * WORLD_COLS + x] === 0;
  const n = tiles.length / 2;
  let runs = 0;
  for (let i = 0; i < n; i++) {
    const x = tiles[i * 2], y = tiles[i * 2 + 1];
    const p = (i + n - 1) % n;
    const px = tiles[p * 2], py = tiles[p * 2 + 1];
    if (floorAt(x, y) && !floorAt(px, py)) runs++;
  }
  return runs <= 1;
}

// Rank rooms by walking-distance "detour" from the start→exit shortest path.
// Two BFS passes give us, for every floor tile, distance to start (distS)
// and distance to exit (distE). For a room centre, dS + dE − baseline is
// the number of extra steps the player walks when they detour through it.
// Rooms living deep in cul-de-sacs branch get an extra ×1.4 boost so true
// dead-ends rank above pass-through rooms with the same detour.
function offPathRooms(rooms, ax, ay, bx, by) {
  const distS = tileBFS(map, ax, ay);
  const distE = tileBFS(map, bx, by);
  const baseline = distS[by * WORLD_COLS + bx];
  if (baseline < 0) return [...rooms];   // start and exit not connected
  const scored = [];
  for (const r of rooms) {
    const i = r.cy * WORLD_COLS + r.cx;
    const dS = distS[i], dE = distE[i];
    if (dS < 0 || dE < 0) continue;
    let s = dS + dE - baseline;
    if (isRoomLeaf(r, map)) s *= 1.4;
    scored.push({ r, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.map(x => x.r);
}

// ========================================================================
// 7. GAME FLOW + MISSIONS
// ========================================================================
function goTitle() {
  mode = 'title';
  titleText.setText('ONE MORE EXTRACTION');
  const pad = n => ('       ' + n).slice(-7);
  const scores = bestScores.length
    ? '\n────── TOP SCORES ──────\n' + bestScores.map((b, i) => (i + 1) + '.  ' + pad(b.s) + '   lv ' + b.lv).join('\n')
    : '';
  msgText.setText(
    '─ CONTROLS ─\n' +
    'WASD move    U fire    I reload    O pickup\n' +
    'ENTER  start / pause\n\n' +
    '─ INTEL ─\n' +
    'enemies see in cones, hear shots and footsteps\n' +
    'hack terminals to reset alarm and timer\n' +
    'pick up weapons · stack mods · watch your ammo\n' +
    'missions: escape · destroy · rescue · eliminate · hack · heist' +
    scores +
    '\n\n[ START to play ]'
  );
  objText.setText('');
}

function startRun() {
  levelN = 1; score = 0;
  // Fresh narrative state for codename + faction tracking.
  factionName = pickFrom(FACTIONS);
  runRoster = buildRoster(12);
  runHistory = [];
  player = makePlayer();
  enterLevel();
  startMusic();
}

function enterLevel() {
  for (const a of [bullets, particles, explosions, pickups, enemies, props, bloodStains, corpses]) a.length = 0;
  hostage = null; portal = null; mission = null;
  roomsWithItems.clear();
  // Size + camera bounds set BEFORE genLevel so allocations match.
  applyWorldSize(levelN);
  const lvl = genLevel(levelN);
  map = lvl.m; mapRooms = lvl.rooms;
  placePlayerStart();
  mission = chooseMission(levelN);
  spawnEnemies();
  spawnPortal();
  spawnBarrels();
  spawnGuaranteedMod();      // first — claims the deepest cul-de-sac for the MOD
  spawnDeadEndRewards();     // then — fills the next 2-4 off-path rooms with weapon/health/ammo
  setupMission();
  mode = 'play';
  msgText.setText('');
  titleText.setText('');
  toast.t = 0;
  const BRIEFS = { extract:'reach the portal', destroy:'kill all hostiles', rescue:'free the hostage', eliminate:'kill the target', hack:'breach the terminals', heist:'grab the cache' };
  showToast(mission.type.toUpperCase() + '\n' + BRIEFS[mission.type], '#ffd060');
  if (scene && scene.cameras) {
    scene.cameras.main.scrollX = player.x - W / 2;
    scene.cameras.main.scrollY = player.y - H / 2;
  }
}

// Mission registry — each entry implements a small contract:
//   setup(m, n)  spawn props, set targetName, etc.
//   tick(m)      optional, 1×/frame; return 'fail' to lose immediately.
//   complete(m)  pure bool — true means the portal is "armed".
//   objective(m) HUD line.
//   end(m, win)  optional, on level transition / death — flip runHistory fates.
//   baseDeadline number or m=>number (seconds) — universal timer source.
const MISSIONS = {
  extract: {
    setup() {},
    complete: () => true,
    objective: () => 'ESCAPE',
    baseDeadline: 75,
  },
  destroy: {
    setup() {},
    complete: () => enemies.length === 0,
    objective: () => 'DESTROY ' + factionName + ' — ' + enemies.length,
    baseDeadline: 110,
  },
  rescue: {
    setup() { spawnHostage(); },
    tick(m) {
      // Hostage death = mission failure. Returning 'fail' triggers gameOver.
      if (hostage && hostage.hp <= 0) return 'fail';
    },
    complete: m => m.freed && hostage && hostage.hp > 0
      && portal && d2(hostage.x, hostage.y, portal.x, portal.y) < 10000,
    objective: m => 'RESCUE ' + (m.targetName || 'asset') + (m.freed ? ' — escort' : ' — press O'),
    end(m, win) { if (m.targetName) setFate(m.targetName, win ? 'saved' : 'lost'); },
    baseDeadline: 95,
  },
  eliminate: {
    setup() { spawnVIP(); },
    complete: m => m.killed,
    objective: m => 'ELIMINATE ' + (m.targetName || 'target') + (m.killed ? ' — escape' : ''),
    end(m, win) { if (m.targetName && !m.killed) setFate(m.targetName, 'lost'); },
    baseDeadline: 75,
  },
  // HEIST — pick up a glowing cache from a far room and carry it to extract.
  heist: {
    setup(m) {
      const spot = pickRoomFP(CLEARANCE * 2.2, CLEARANCE * 1.25);
      if (!spot) return;
      const name = 'CACHE ' + pickFrom(NOUNS);
      m.targetName = name;
      logTarget(name, 'CACHE');
      props.push({ kind: 'prize', x: spot.x, y: spot.y, name });
      m.carrying = false;
    },
    complete: m => m.carrying,
    objective: m => m.carrying
      ? 'HEIST ' + m.targetName + ' — escape'
      : 'HEIST — find ' + (m.targetName || 'cache'),
    end(m, win) { if (m.targetName) setFate(m.targetName, win ? 'extracted' : 'lost'); },
    baseDeadline: 80,
  },
  hack: {
    setup() { spawnTerminal(); },
    // Terminal progress now ticks globally in runTick (for non-hack levels
    // too, since the filler terminal needs to advance for the stealth reset).
    complete: () => props.every(p => p.kind !== 'terminal' || p.progress >= 1),
    objective: () => {
      const terms = props.filter(p => p.kind === 'terminal');
      const done = terms.filter(p => p.progress >= 1).length;
      if (done === terms.length) return 'HACK ' + done + '/' + terms.length + ' — escape';
      let closest = null, bd = Infinity;
      for (const p of terms) {
        if (p.progress >= 1) continue;
        const dd = d2(player.x, player.y, p.x, p.y);
        if (dd < bd) { bd = dd; closest = p; }
      }
      const pct = closest ? (closest.progress * 100 | 0) : 0;
      return 'HACK ' + done + '/' + terms.length + '  ' + (closest ? closest.name : 'node') + ' ' + pct + '%';
    },
    end(m, win) {
      // Each terminal that didn't reach 100% is marked lost.
      for (const p of props) {
        if (p.kind === 'terminal' && p.progress < 1 && p.name) setFate(p.name, 'lost');
      }
    },
    baseDeadline: () => 60 + 25 * props.filter(p => p.kind === 'terminal').length,
  },
};

function chooseMission(n) {
  if (n === 1) return { type: 'extract' };
  const r = Math.random();
  if (r < 0.18) return { type: 'extract' };
  if (r < 0.36) return { type: 'destroy' };
  if (r < 0.54) return { type: 'rescue', freed: false };
  if (r < 0.72) return { type: 'eliminate', killed: false };
  if (r < 0.86) return { type: 'hack' };
  return { type: 'heist', carrying: false };
}
function missionTitle(m) { return 'MISSION: ' + m.type.toUpperCase(); }
function setupMission() {
  MISSIONS[mission.type].setup(mission, levelN);
  setDeadline(mission);
}
function missionComplete() { return mission && MISSIONS[mission.type].complete(mission); }
// Universal deadline: each mission has a baseDeadline (sec). Scaled by level
// (more pressure at higher levels) and by map area (bigger maps = more time).
function setDeadline(m) {
  const def = MISSIONS[m.type].baseDeadline;
  const base = typeof def === 'function' ? def(m) : def;
  if (!base) { m.deadline = 0; return; }
  const lvlMul = Math.max(0.5, 1 - (levelN - 1) * 0.04);
  const sizeMul = Math.sqrt((WORLD_COLS * WORLD_ROWS) / (60 * 40));
  // Round seconds up to the next multiple of 10, then convert to ticks (60Hz).
  m.deadline = Math.ceil(base * lvlMul * sizeMul * 0.5 / 10) * 600;
  m.deadlineMax = m.deadline;   // Stored so the PC hack can restore full time.
  m.detTime = 0;
  m.armed = false;
  m.alarm = false;
}

// Alarm: timer expired while detected. Periodic enemy waves keep spawning
// until the player extracts (next level) or dies. Hacking a terminal clears.
function startAlarm(m) {
  m.alarm = true;
  m.alarmCD = 60;
  m.alarmAge = 0;
  // Initial siren hit: long down-sweep wail.
  blip(900, 0.8, 'sawtooth', 0.18, 200);
}
function tickAlarm(m) {
  m.alarmAge++;
  if (--m.alarmCD <= 0) {
    spawnAlarmWave(m);
    m.alarmCD = Math.max(120, 240 - (m.alarmAge / 8 | 0));
  }
  // Klaxon wail: alternating up/down pitch sweep every 30 ticks (~0.5s).
  if (m.alarmAge % 30 === 0) {
    const up = (m.alarmAge / 30) % 2 === 0;
    blip(up ? 350 : 950, 0.5, 'sawtooth', 0.14, up ? 950 : 350);
  }
}
function spawnAlarmWave(m) {
  if (enemies.length >= 32) return;
  const tier = Math.min(1, levelN / 10) + Math.min(0.5, m.alarmAge / 1800);
  const types = ['runner', 'grunt'];
  if (m.alarmAge > 300) types.push('bruiser');
  if (m.alarmAge > 600) types.push('sniper');
  const count = 2 + (Math.random() * 2 | 0);
  for (let i = 0; i < count; i++) {
    const free = pickFreeTile(map, player.x, player.y, CLEARANCE * 0.8);
    if (!free) break;
    const [ex, ey] = tileCenter(free[0], free[1]);
    const en = makeEnemy(pickFrom(types), ex, ey, tier);
    en.state = 'engage';
    en.alert = 1;
    en.lastSeen = { x: player.x, y: player.y };
    enemies.push(en);
  }
}


function placePlayerStart() {
  const [px, py] = tileCenter(2, 2);
  player.x = px; player.y = py;
  player.vx = 0; player.vy = 0;
  player.facing = 0;
}

function spawnEnemies() {
  const tier = Math.min(1, levelN / 14);
  // Early-level safety bubble: larger no-spawn radius around the player on
  // lvl 1-4, settling to baseline by lvl 5+. Eases the player into the game.
  const safeFactor = Math.max(0.4, 1 - 0.15 * (levelN - 1));

  // Phase 1: guarantee one enemy in every room except the player's start
  // room. Type is rolled per room so the level still has variety.
  const types = ['grunt', 'grunt', 'grunt'];
  if (levelN >= 2) types.push('runner');
  if (levelN >= 4) types.push('bruiser');
  if (levelN >= 5) types.push('sniper');
  if (levelN >= 6) types.push('pyro');
  if (levelN >= 7) types.push('gunner');
  if (levelN >= 8) types.push('demo');
  let placed = 0;
  for (const r of mapRooms) {
    const [rx, ry] = tileCenter(r.cx, r.cy);
    // Skip the player's start room — spawning on top of the player is unfair.
    if (d2(rx, ry, player.x, player.y) < CLEARANCE * CLEARANCE * safeFactor) continue;
    const id = pickFrom(types);
    enemies.push(makeEnemy(id, rx, ry, tier));
    placed++;
  }

  // Phase 2: extra enemies based on level budget for higher density.
  const budget = Math.max(0, 8 + levelN * 3.2 - placed * 1.5);
  const phase2Clear = 280 * Math.sqrt(safeFactor / 0.4);
  let pts = budget;
  const P2 = [[5,0.18,'sniper'],[4,0.36,'bruiser'],[6,0.50,'pyro'],[2,0.66,'runner'],[7,0.76,'gunner'],[8,0.84,'demo']];
  while (pts > 0) {
    const r = Math.random();
    let id = 'grunt';
    for (const [L, p, t] of P2) if (levelN >= L && r < p) { id = t; break; }
    const free = pickFreeTile(map, player.x, player.y, phase2Clear);
    if (!free) break;
    const [cx, cy] = free;
    const [ex, ey] = tileCenter(cx, cy);
    enemies.push(makeEnemy(id, ex, ey, tier));
    pts -= ENEMIES[id].score / 5;
  }
}

function spawnPortal() {
  const [px, py] = tileCenter(WORLD_COLS - 3, WORLD_ROWS - 3);
  portal = { x: px, y: py, t: 0 };
}

function pickRoomFar(awayX, awayY, minD) {
  for (let i = 0; i < 60; i++) {
    const r = pickFrom(mapRooms);
    if (!r) break;
    const [px, py] = tileCenter(r.cx, r.cy);
    if (d2(px, py, awayX, awayY) < minD * minD) continue;
    return { r, x: px, y: py };
  }
  return null;
}
// Two-tier pickRoomFar from player coords with fallback distance.
const pickRoomFP = (a, b) => pickRoomFar(player.x, player.y, a) || pickRoomFar(player.x, player.y, b);

function spawnHostage() {
  const spot = pickRoomFP(CLEARANCE * 1.9, CLEARANCE);
  if (!spot) return;
  const name = takeCodename();
  hostage = {
    x: spot.x, y: spot.y, vx: 0, vy: 0,
    hp: 60, maxHp: 60, freed: false,
    facing: 0,
    name,
  };
  mission.targetName = name;
  logTarget(name, 'ASSET');
  props.push({ kind: 'cage', x: spot.x, y: spot.y });
}

function spawnVIP() {
  const spot = pickRoomFP(CLEARANCE * 2.2, CLEARANCE * 1.25);
  if (!spot) return;
  const tier = Math.min(1, levelN / 14);
  const v = makeEnemy('bruiser', spot.x, spot.y, tier);
  v.hp = (v.hp * 2.2) | 0; v.maxHp = v.hp;
  v.weapon = makeWeaponInst('burst');
  v.vip = true;
  v.name = takeCodename();
  mission.targetName = v.name;
  logTarget(v.name, 'TARGET');
  enemies.push(v);
}

function spawnTerminal() {
  // 1-3 terminals; the mission completes only when every one of them is
  // fully breached. Each tracks its own progress + sound timer.
  const count = 1 + ((Math.random() * 3) | 0);
  const usedNouns = new Set();
  for (let i = 0; i < count; i++) {
    const spot = pickRoomFP(CLEARANCE * 1.9, CLEARANCE);
    if (!spot) continue;
    let noun;
    do { noun = pickFrom(NOUNS); } while (usedNouns.has(noun) && usedNouns.size < NOUNS.length);
    usedNouns.add(noun);
    const name = 'NODE ' + noun;
    logTarget(name, 'NODE');
    props.push({ kind: 'terminal', x: spot.x, y: spot.y, name, progress: 0, hackTimer: 0 });
  }
}

function spawnBarrels() {
  const count = 2 + Math.min(8, levelN | 0);
  for (let i = 0; i < count; i++) {
    const free = pickFreeTile(map, player.x, player.y, CLEARANCE * 0.8);
    if (!free) continue;
    const [cx, cy] = free;
    const [bx, by] = tileCenter(cx, cy);
    props.push({ kind: 'barrel', x: bx, y: by, hp: 1 });
  }
}

// Drops one MOD pickup at the end of the longest dead-end branch (the
// off-path room furthest from the start→exit line, far from both endpoints
// and from the portal). Rewards exploration of the deepest detour.
function spawnGuaranteedMod() {
  const path = offPathRooms(mapRooms, 3, 3, WORLD_COLS - 3, WORLD_ROWS - 3);
  if (!path.length) return;
  const px0 = portal ? portal.x : 0, py0 = portal ? portal.y : 0;
  const cl2 = CLEARANCE * CLEARANCE;
  // Prefer unclaimed rooms far from player + portal; relax in two stages.
  let pick = null;
  for (let pass = 0; pass < 3 && !pick; pass++) {
    for (const r of path) {
      if (pass < 2 && roomsWithItems.has(r)) continue;
      const [px, py] = tileCenter(r.cx, r.cy);
      if (pass === 0 && d2(px, py, player.x, player.y) < cl2) continue;
      if (pass === 0 && portal && d2(px, py, px0, py0) < cl2 * 0.49) continue;
      pick = { r, px, py };
      break;
    }
  }
  if (!pick) return;
  pickups.push({ x: pick.px, y: pick.py, kind: 'mod', modId: pickFrom(MOD_IDS) });
  roomsWithItems.add(pick.r);
}

function spawnDeadEndRewards() {
  // Pick rooms most off the path between start and extraction. Drop a
  // weapon/health/ammo pickup at their center to reward exploration.
  // One item per room — already-claimed rooms are skipped.
  const path = offPathRooms(mapRooms, 3, 3, WORLD_COLS - 3, WORLD_ROWS - 3);
  const want = 2 + (Math.random() * 2 | 0);
  let placed = 0;
  for (const r of path) {
    if (placed >= want) break;
    if (roomsWithItems.has(r)) continue;
    const [px, py] = tileCenter(r.cx, r.cy);
    if (d2(px, py, player.x, player.y) < CLEARANCE * CLEARANCE) continue;
    const roll = Math.random();
    const canTerm = mission && mission.type !== 'hack';
    if (canTerm && roll < 0.30) {
      // Escape terminal — same hack-to-reset behavior as objective terminals.
      props.push({ kind: 'terminal', x: px, y: py, progress: 0, hackTimer: 0 });
    } else if (roll < 0.70) {
      const wid = WEAPON_IDS[1 + (Math.random() * (WEAPON_IDS.length - 1)) | 0];
      const wInst = makeWeaponInst(wid);
      if (Math.random() < 0.4) {
        const ban = WEAPONS[wid].banMods;
        const mid = pickFrom(ban ? MOD_IDS.filter(m => !ban.includes(m)) : MOD_IDS);
        MODS[mid].apply(wInst); wInst.mods.push(mid);
      }
      pickups.push({ x: px, y: py, kind: 'weapon', wInst });
    } else if (roll < 0.85) {
      pickups.push({ x: px, y: py, kind: 'health' });
    } else if (roll < 0.93) {
      pickups.push({ x: px, y: py, kind: 'armor' });
    } else {
      pickups.push({ x: px, y: py, kind: 'ammo' });
    }
    roomsWithItems.add(r);
    placed++;
  }
}

function nextLevel() {
  if (mission) MISSIONS[mission.type].end?.(mission, true);
  levelN++;
  if (levelN - 1 > best) { best = levelN - 1; saveBest(); }
  player.hp = player.maxHp;   // full heal between levels
  enterLevel();
}

function gameOver() {
  mode = 'gameover';
  if (mission) MISSIONS[mission.type].end?.(mission, false);
  if (levelN - 1 > best) best = levelN - 1;
  recordScore(score | 0, levelN);
  saveBest();
  for (const h of runHistory) if (h.fate === 'pending') h.fate = 'lost';
  const log = runHistory.length
    ? '\n\n' + runHistory.map(h => 'L' + h.level + ' ' + h.fate + ' ' + h.name).join('\n')
    : '';
  titleText.setText('YOU DIED');
  msgText.setText(
    'level ' + levelN + '   score ' + (score | 0) + '   best ' + best +
    log + '\n\nSTART to try again'
  );
  objText.setText('');
}

// ========================================================================
// 8. PLAYER
// ========================================================================
function makePlayer() {
  return {
    x: 100, y: 100, vx: 0, vy: 0, facing: 0,
    hp: PLAYER_BASE_HP, maxHp: PLAYER_BASE_HP,
    armor: 50, maxArmor: 50,
    weapons: [makeWeaponInst('pistol', null, 100)],
    weaponIdx: 0,
    iframes: 0,
    burstLeft: 0, burstTimer: 0,
    deadFlash: 0,
  };
}

function curWeapon() { return player.weapons[player.weaponIdx]; }

function makeWeaponInst(id, mods, reserveOverride) {
  const base = WEAPONS[id];
  const reserve = (reserveOverride != null) ? reserveOverride : base.mag * 2;
  const w = { ...base, id, ammo: base.mag, reserve, reloading: 0, cd: 0, mods: [] };
  if (mods) { for (const mid of mods) { MODS[mid].apply(w); w.mods.push(mid); } }
  return w;
}

function applyModToCur(mid) {
  const w = curWeapon();
  const ban = w.banMods || [];
  const capped = m => MODS[m].cap && w.mods.filter(x => x === m).length >= MODS[m].cap;
  if (ban.includes(mid) || capped(mid)) {
    const valid = MOD_IDS.filter(m => !ban.includes(m) && !capped(m));
    if (!valid.length) return;
    mid = pickFrom(valid);
  }
  MODS[mid].apply(w);
  w.mods.push(mid);
  w.ammo = w.mag;
}


// Reads WASD, normalizes the joystick, and writes vx/vy/facing on the player.
function applyPlayerMove() {
  let dx = 0, dy = 0;
  if (held.P1_L) dx -= 1; if (held.P1_R) dx += 1;
  if (held.P1_U) dy -= 1; if (held.P1_D) dy += 1;
  const sp = PLAYER_BASE_SPEED;
  if (dx || dy) {
    const m = Math.hypot(dx, dy);
    player.vx = dx / m * sp;
    player.vy = dy / m * sp;
    player.facing = Math.atan2(dy, dx);
  } else {
    player.vx = 0; player.vy = 0;
  }
  moveEntity(player, PLAYER_R);
}

function controlPlayer() {
  if (player.hp <= 0) return;
  applyPlayerMove();

  // Low-HP blood trail: drop a small stain ~1/sec while moving wounded.
  if (player.hp < player.maxHp * 0.3 && frameCount % 40 === 0) dropStain(player.x, player.y, 0);

  // footstep noise: while moving, leak a low-radius ping every 6 ticks
  if ((player.vx !== 0 || player.vy !== 0)) {
    footstepCounter++;
    if (footstepCounter >= 6) {
      footstepCounter = 0;
      emitNoise(player.x, player.y, NOISE_FOOTSTEP, player, 0.4);
    }
  } else footstepCounter = 0;

  // Auto-touch pickups: health (only when injured), ammo, and weapons we already own.
  // New weapon types still require manual O to swap.
  for (let i = pickups.length - 1; i >= 0; i--) {
    const pk = pickups[i];
    const dxp = pk.x - player.x, dyp = pk.y - player.y;
    if (dxp * dxp + dyp * dyp > (PLAYER_R + 14) * (PLAYER_R + 14)) continue;
    if (pk.kind === 'health' && player.hp < player.maxHp) {
      takePickup(pk);
    } else if (pk.kind === 'ammo') {
      takePickup(pk);
    } else if (pk.kind === 'weapon' && player.weapons.find(w => w.id === pk.wInst.id)) {
      takePickup(pk);
    }
  }
  // HEIST prize prop — auto-grab when stepped on.
  if (mission && mission.type === 'heist' && !mission.carrying) {
    for (let i = props.length - 1; i >= 0; i--) {
      const pr = props[i];
      if (pr.kind !== 'prize') continue;
      if (d2(player.x, player.y, pr.x, pr.y) < (PLAYER_R + 16) * (PLAYER_R + 16)) {
        mission.carrying = true;
        props.splice(i, 1);
        sfxPickup();
      }
    }
  }

  const w = curWeapon();
  if (w.cd > 0) w.cd--;
  if (w.reloading > 0) {
    w.reloading--;
    if (w.reloading === 0) {
      const target = w.mag;
      const need = target - w.ammo;
      const take = Math.min(need, w.reserve);
      w.ammo += take;
      w.reserve -= take;
    }
  }
  if (player.burstLeft > 0) {
    if (player.burstTimer > 0) player.burstTimer--;
    else { fireOnce(player, w); player.burstLeft--; player.burstTimer = 4; }
  }
  if (w.reloading === 0 && w.cd === 0 && w.ammo > 0) {
    let firePressed = false;
    if (w.trigger === 'auto' && held.P1_1) firePressed = true;
    else if (w.trigger === 'semi' && consumePress('P1_1')) firePressed = true;
    else if (w.trigger === 'burst3' && consumePress('P1_1')) {
      player.burstLeft = 3; player.burstTimer = 0; firePressed = false;
    }
    if (firePressed) fireOnce(player, w);
  }
  if (w.ammo === 0 && w.reloading === 0 && w.reserve > 0) {
    w.reloading = w.reload;
  }
  if (consumePress('P1_2') && w.ammo < w.mag && w.reloading === 0 && w.reserve > 0) {
    w.reloading = w.reload;
  }

  // O — pickup, free hostage, swap
  if (consumePress('P1_3')) {
    const pk = nearestPickup(player.x, player.y, PICKUP_R + 6);
    if (pk) takePickup(pk);
    else if (mission && mission.type === 'rescue' && hostage && !hostage.freed &&
             d2(player.x, player.y, hostage.x, hostage.y) < 1600) {
      hostage.freed = true;
      mission.freed = true;
      for (let i = props.length - 1; i >= 0; i--) if (props[i].kind === 'cage') props.splice(i, 1);
      sfxPickup();
    } else if (player.weapons.length > 1) {
      player.weaponIdx = (player.weaponIdx + 1) % player.weapons.length;
    }
  }

  if (player.iframes > 0) player.iframes--;

  if (portal && d2(player.x, player.y, portal.x, portal.y) < 576 && missionComplete()) {
    nextLevel();
  }
}

// Build a bullet record for the bullets array. Centralises the per-property
// defaults so fireOnce and the multishot bonus stay in lockstep.
function pushBullet(owner, w, ox, oy, ang, dmg, range, isPlayer, crit) {
  bullets.push({
    x: ox, y: oy,
    vx: Math.cos(ang) * w.speed,
    vy: Math.sin(ang) * w.speed,
    life: (range / w.speed) | 0,
    dmg,
    owner: isPlayer ? 'p' : 'e',
    pierce: w.pierce,
    hits: new Set(),
    bounce: w.bounce,
    exp: w.exp,
    expDmg: w.expDmg,
    vamp: w.vamp,
    burn: w.burn,
    burnDmg: w.burnDmg,
    poison: w.poison,
    poisonDmg: w.poisonDmg,
    flame: w.flame,
    crit,
    bcol: w.bcol,
  });
}

function fireOnce(owner, w) {
  const isPlayer = owner === player;
  if (isPlayer) {
    if (w.ammo <= 0) return;
    w.ammo--;
  }
  w.cd = w.rate;
  const range = w.range;
  const baseDmg = w.dmg;
  const aim = owner.aim != null ? owner.aim : owner.facing;
  const muzzleX = owner.x + Math.cos(aim) * (PLAYER_R + 4);
  const muzzleY = owner.y + Math.sin(aim) * (PLAYER_R + 4);
  const n = w.n || 1;
  for (let i = 0; i < n; i++) {
    const spr = (Math.random() - 0.5) * 2 * w.spread;
    const a = aim + spr + (n > 1 ? (i - (n - 1) / 2) * (w.spread * 0.4) : 0);
    const crit = isPlayer && Math.random() < ((w.crit || 0) + 0.05);
    pushBullet(owner, w, muzzleX, muzzleY, a, baseDmg, range, isPlayer, crit);
  }
  particles.push({ x: owner.x, y: owner.y, vx: 0, vy: 0, life: 4, col: 0xfff0a0, r: 5 });
  if (!w.silent) emitNoise(owner.x, owner.y, NOISE_GUNSHOT, owner, 1);
  if (isPlayer) sfxShoot(w.id);
}

// ========================================================================
// 9. ENEMIES + AI
// ========================================================================
function makeEnemy(id, x, y, tier) {
  const e = ENEMIES[id];
  const hp = e.hp * (1 + tier * 1.5) * 0.7 | 0;
  return {
    type: id,
    x, y, vx: 0, vy: 0, facing: Math.random() * Math.PI * 2,
    hp, maxHp: hp,
    weapon: makeWeaponInst(e.weapon),
    state: 'patrol',
    alert: 0,
    lastSeen: null,
    patrolTarget: null,
    patrolWait: 0,
    aim: 0,
    knockX: 0, knockY: 0,
    fired: 0,
    stuckTicks: 0,
    prevX: x, prevY: y,
    skin: pickFrom(SKINS),
    sizeK: 0.85 + Math.random() * 0.30,   // ±15% body size variation
    armCut: [0, 2, 4][Math.random() * 3 | 0],   // 0=bare, 2=short sleeve, 4=long
  };
}

function emitNoise(x, y, radius, source, alertGain = 0.6) {
  const r2 = radius * radius;
  for (const e of enemies) {
    if (e === source) continue;
    if (d2(e.x, e.y, x, y) < r2) {
      e.lastSeen = { x, y };
      if (e.state === 'patrol') e.state = 'alert';
      e.alert = Math.max(e.alert, alertGain);
    }
  }
}

function updateAI(e) {
  const def = ENEMIES[e.type];
  const w = e.weapon;
  if (w.cd > 0) w.cd--;

  const dx = player.x - e.x, dy = player.y - e.y;
  const d = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  const aDiff = angDiff(ang, e.facing);
  const inCone = Math.abs(aDiff) < def.cone / 2 && d < def.sight;
  const los = inCone && hasLOS(map, e.x, e.y, player.x, player.y);
  if (los) {
    e.alert += SIGHT_FILL_PER_TICK;
    e.lastSeen = { x: player.x, y: player.y };
    if (e.alert >= 1 && e.state !== 'engage') e.state = 'engage';
  } else {
    e.alert = Math.max(0, e.alert - 0.005);
  }

  if (e.state === 'patrol') {
    if (!e.patrolTarget) {
      if (e.patrolWait > 0) e.patrolWait--;
      else {
        // pick a target far away — encourages crossing rooms
        const free = pickFreeTile(map, e.x, e.y, 220 + Math.random() * 320);
        if (free) { const [tx, ty] = tileCenter(free[0], free[1]); e.patrolTarget = { x: tx, y: ty }; }
        e.patrolWait = 20 + (Math.random() * 60 | 0);
      }
    }
    if (e.patrolTarget) {
      const ddx = e.patrolTarget.x - e.x, ddy = e.patrolTarget.y - e.y;
      const dd = Math.hypot(ddx, ddy);
      if (dd < 8) { e.patrolTarget = null; e.patrolWait = 30 + (Math.random() * 50 | 0); }
      else { e.vx = ddx / dd * def.speed * 0.55; e.vy = ddy / dd * def.speed * 0.55; e.facing = Math.atan2(ddy, ddx); }
    } else {
      brk(e, 0.7);
      e.facing += (Math.random() - 0.5) * 0.04;
      avoidFacingWall(e);
    }
  } else if (e.state === 'alert') {
    if (e.lastSeen) {
      const ddx = e.lastSeen.x - e.x, ddy = e.lastSeen.y - e.y;
      const dd = Math.hypot(ddx, ddy);
      e.facing += angDiff(Math.atan2(ddy, ddx), e.facing) * 0.08;
      if (dd > 30) { e.vx = ddx / dd * def.speed * 0.8; e.vy = ddy / dd * def.speed * 0.8; }
      else { brk(e, 0.7); }
    } else {
      e.facing += (Math.random() - 0.5) * 0.06;
      brk(e, 0.7);
      avoidFacingWall(e);
    }
    if (e.alert <= 0.05) e.state = 'patrol';
  } else if (e.state === 'engage') {
    e.facing += angDiff(ang, e.facing) * 0.2;
    e.aim = ang;
    const wantRange = def.pr || 220;
    if (los) {
      if (d > wantRange * 1.2) mv(e, player.x, player.y, def.speed, 1, 1);
      else if (d < wantRange * 0.6) mv(e, player.x, player.y, def.speed * 0.8, -1, 0);
      else brk(e, 0.5);
      if (w.cd === 0 && e.fired >= def.react) {
        const n = w.trigger === 'burst3' ? 3 : 1;
        for (let i = 0; i < n; i++) fireOnce(e, w);
      }
      e.fired++;
    } else {
      if (e.lastSeen) mv(e, e.lastSeen.x, e.lastSeen.y, def.speed * 0.8, 1, 1);
      else { brk(e, 0.7); e.state = 'alert'; }
      e.fired = Math.max(0, e.fired - 1);
      if (e.alert < 0.3 && (!e.lastSeen || d2(e.x, e.y, e.lastSeen.x, e.lastSeen.y) < 256)) {
        e.state = 'alert';
        e.lastSeen = null;
      }
    }
  }

  e.vx += e.knockX; e.vy += e.knockY;
  e.knockX *= 0.6; e.knockY *= 0.6;

  moveEntity(e, def.r);

  // stuck detection — if not moving for a stretch, ditch the current target
  // and try a new patrol target. Snipers with cone open up and look around.
  const moved = Math.hypot(e.x - e.prevX, e.y - e.prevY);
  if (moved < 0.2 && (e.state === 'patrol' || e.state === 'alert')) {
    e.stuckTicks++;
    if (e.stuckTicks > 40) {
      e.patrolTarget = null;
      e.lastSeen = null;
      e.facing += (Math.random() - 0.5) * 1.4;
      avoidFacingWall(e);
      e.stuckTicks = 0;
    }
  } else e.stuckTicks = 0;
  e.prevX = e.x; e.prevY = e.y;
}

// moveTowards turns to face the target; moveAway preserves facing so a
// dir = 1 toward target, -1 away. rot = 1 turns facing toward (only for "toward").
function mv(e, tx, ty, sp, dir, rot) {
  const dx = (tx - e.x) * dir, dy = (ty - e.y) * dir;
  const d = Math.hypot(dx, dy) || 1;
  e.vx = dx / d * sp; e.vy = dy / d * sp;
  if (rot) e.facing += angDiff(Math.atan2(dy, dx), e.facing) * 0.2;
}
// Velocity brake — multiply vx/vy by k, used everywhere AI idles.
const brk = (e, k) => { e.vx *= k; e.vy *= k; };

// If the enemy's facing direction has a wall right in front of it, rotate
// toward the most open angle within an 8-direction sweep. Keeps idle/patrol
// enemies from "standing watch" against a stone wall.
const FACE_PROBE = 60;
function avoidFacingWall(e) {
  const px = e.x + Math.cos(e.facing) * FACE_PROBE;
  const py = e.y + Math.sin(e.facing) * FACE_PROBE;
  if (!isSolid(map, pt(px), pt(py))) return;
  let bestA = e.facing, bestD = 0;
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    let d = 0;
    while (d < 240) {
      d += 16;
      const tx = e.x + Math.cos(a) * d, ty = e.y + Math.sin(a) * d;
      if (isSolid(map, pt(tx), pt(ty))) break;
    }
    if (d > bestD) { bestD = d; bestA = a; }
  }
  e.facing += angDiff(bestA, e.facing) * 0.35;
}

// ========================================================================
// 10. PHYSICS
// ========================================================================
// Clamp entity to world bounds; returns true if any axis was pushed back.
function clampPos(e, r) {
  let c = false;
  if (e.x < r) { e.x = r; c = true; }
  if (e.y < r) { e.y = r; c = true; }
  if (e.x > WORLD_W - r) { e.x = WORLD_W - r; c = true; }
  if (e.y > WORLD_H - r) { e.y = WORLD_H - r; c = true; }
  return c;
}

function moveEntity(e, r) {
  let blocked = false;
  let nx = e.x + e.vx;
  if (collidesWalls(nx, e.y, r)) { nx = e.x; e.vx = 0; blocked = true; }
  e.x = nx;
  let ny = e.y + e.vy;
  if (collidesWalls(e.x, ny, r)) { ny = e.y; e.vy = 0; blocked = true; }
  e.y = ny;
  return clampPos(e, r) || blocked;
}

function collidesWalls(x, y, r) {
  const pts = [
    [x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r],
    [x, y],
  ];
  for (const [px, py] of pts) {
    if (isSolid(map, pt(px), pt(py))) return true;
  }
  return false;
}

function updateBullets() {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx; b.y += b.vy;
    b.life--;
    let dead = false;
    if (b.life <= 0) dead = true;
    if (!dead && isSolid(map, pt(b.x), pt(b.y))) {
      if (b.bounce > 0) {
        b.bounce--;
        b.x -= b.vx; b.y -= b.vy;
        if (isSolid(map, pt(b.x + b.vx), pt(b.y))) b.vx = -b.vx;
        else b.vy = -b.vy;
      } else {
        if (b.exp) explode(b.x, b.y, b.exp, b.expDmg, b.owner);
        dead = true;
      }
    }
    if (!dead) {
      // barrels (props) can be hit by any bullet
      for (const p of props) {
        if (p.kind !== 'barrel' || p.hp <= 0) continue;
        const r = 14;
        if (d2(b.x, b.y, p.x, p.y) < r * r) {
          p.hp = 0;
          if (b.exp) explode(b.x, b.y, b.exp, b.expDmg * 0.6, b.owner);
          dead = true;
          break;
        }
      }
    }
    if (!dead) {
      if (b.owner === 'p') {
        for (const e of enemies) {
          if (e.hp <= 0) continue;
          if (b.hits.has(e)) continue;
          const r = ENEMIES[e.type].r + 4;
          if (d2(b.x, b.y, e.x, e.y) < r * r) {
            damageEnemy(e, b);
            b.hits.add(e);
            if (b.exp) { explode(b.x, b.y, b.exp, b.expDmg * 0.6, b.owner); dead = true; }
            else if (b.pierce > 0) b.pierce--;
            else dead = true;
            if (dead) break;
          }
        }
      } else {
        // hostage takes collateral damage
        if (!dead && hostage && hostage.hp > 0) {
          const r = 12;
          if (d2(b.x, b.y, hostage.x, hostage.y) < r * r) {
            hostage.hp -= b.dmg;
            particles.push({ x: hostage.x, y: hostage.y, vx: 0, vy: 0, life: 6, col: 0xff5060, r: 8 });
            dead = true;
          }
        }
        if (!dead && player.hp > 0 && player.iframes <= 0) {
          const r = PLAYER_R + 3;
          if (d2(b.x, b.y, player.x, player.y) < r * r) {
            damagePlayer(b.dmg);
            if (b.exp) explode(b.x, b.y, b.exp, b.expDmg * 0.5, b.owner);
            dead = true;
          }
        }
      }
    }
    if (!dead && (b.x < 0 || b.x > WORLD_W || b.y < 0 || b.y > WORLD_H)) dead = true;
    if (dead) bullets.splice(i, 1);
  }
}

function explode(x, y, radius, dmg, owner) {
  explosions.push({ x, y, r: 0, max: radius, life: 14 });
  for (const e of enemies) {
    if (e.hp <= 0) continue;
    const dd = Math.hypot(e.x - x, e.y - y);
    if (dd < radius) {
      const dn = dd || 1;
      e.knockX += (e.x - x) / dn * 5;
      e.knockY += (e.y - y) / dn * 5;
      damageEnemy(e, { dmg: dmg * (1 - dd / radius), vx: e.x - x, vy: e.y - y, exp: 1 });
    }
  }
  // chain barrels
  for (const p of props) {
    if (p.kind !== 'barrel' || p.hp <= 0) continue;
    if (d2(p.x, p.y, x, y) < radius * radius) p.hp = 0;
  }
  // hostage damage
  if (hostage && hostage.hp > 0) {
    const dd = Math.hypot(hostage.x - x, hostage.y - y);
    if (dd < radius) hostage.hp -= dmg * 0.5 * (1 - dd / radius);
  }
  if (player.hp > 0 && player.iframes <= 0) {
    const dd = Math.hypot(player.x - x, player.y - y);
    if (dd < radius) damagePlayer(dmg * (1 - dd / radius));
  }
  blip(70, 0.25, 'sawtooth', 0.09);
  noise(0.20, 0.07, 200);
}

// ========================================================================
// 11. COMBAT
// ========================================================================
function damageEnemy(e, b) {
  let dmg = b.dmg | 0;
  if (b.crit) dmg = Math.max(dmg, e.hp);   // headshot: guaranteed kill
  e.hp -= dmg;
  e.alert = 1; e.state = 'engage'; e.lastSeen = { x: player.x, y: player.y };
  // Visceral feedback on every hit: spray blood + a crunchy impact tone.
  // Crits show a yellow flash particle on top of the red spray.
  bloodBurst(e.x, e.y, b.crit ? 22 : 5, b.vx, b.vy, b.crit);
  if (b.crit) {
    bloodBurst(e.x, e.y, 14, -b.vx, -b.vy, true);   // back-spray
    particles.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 10, col: 0xffe040, r: 12 });
    blip(1400, 0.06, 'square', 0.06);
    blip(1900, 0.04, 'triangle', 0.04);
    showToast('HEADSHOT!', '#ff3366');
  }
  if (e.hp > 0) { blip(70, 0.05, 'sawtooth', 0.05); noise(0.05, 0.06, 700); }
  if (b.vamp) {
    const heal = dmg * b.vamp;
    player.hp = Math.min(player.maxHp, player.hp + heal);
  }
  for (const k of ['burn', 'poison']) {
    if (!b[k]) continue;
    if ((e[k] || 0) < b[k]) e[k] = b[k];
    const dk = k + 'Dmg';
    if ((e[dk] || 0) < b[dk]) e[dk] = b[dk];
  }
  if (e.hp <= 0) killEnemy(e, b.crit ? 'headshot' : b.exp ? 'explosion' : 'normal');
}

function killEnemy(e, cause) {
  // Big gory burst, ring shockwave, and a corpse that stays on the floor.
  bloodBurst(e.x, e.y, 18, 0, 0, true);
  particles.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 18, col: ENEMIES[e.type].col, r: 16, ring: true });
  spawnCorpse(e, cause || 'normal');
  score += ENEMIES[e.type].score * (e.vip ? 4 : 1);
  if (e.vip && mission && mission.type === 'eliminate') {
    mission.killed = true;
    if (e.name) setFate(e.name, 'killed');
  }
  const r = Math.random();
  if (e.vip || r < 0.22) pickups.push({ x: e.x, y: e.y, kind: 'health' });
  else if (r < 0.55) {
    // drop the enemy's own weapon (clean instance, fresh ammo)
    const wInst = makeWeaponInst(e.weapon.id);
    pickups.push({ x: e.x, y: e.y, kind: 'weapon', wInst });
  }
  blip(180, 0.18, 'sawtooth', 0.08, 70);
  noise(0.14, 0.07, 450);
}

function damagePlayer(d) {
  if (player.armor > 0) {
    const a = Math.min(player.armor, d);
    player.armor -= a; d -= a;
  }
  player.hp -= d;
  player.iframes = 18;
  player.deadFlash = 8;
  bloodBurst(player.x, player.y, 7, 0, 0);
  if (player.hp <= 0) {
    player.hp = 0;
    bloodBurst(player.x, player.y, 26, 0, 0, true);
    sfxDie();
    gameOver();
  } else {
    blip(140, 0.10, 'sawtooth', 0.07);
    noise(0.07, 0.05, 800);
  }
}

// ========================================================================
// 12. PICKUPS, HOSTAGE, PROPS
// ========================================================================
function nearestPickup(x, y, r) {
  let best = null, bestD = r * r;
  for (const p of pickups) {
    const d = d2(p.x, p.y, x, y);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function takePickup(p) {
  if (p.kind === 'health') {
    player.hp = Math.min(player.maxHp, player.hp + 30);
    showToast('+30 HP', '#66ffaa');
    sfxPickup();
  } else if (p.kind === 'armor') {
    player.armor = player.maxArmor;
    showToast('ARMOR RESTORED', '#6699ff');
    sfxPickup();
  } else if (p.kind === 'ammo') {
    for (const w of player.weapons) {
      w.reserve += WEAPONS[w.id].mag;
    }
    showToast('AMMO REFILLED', '#ffcc40');
    sfxPickup();
  } else if (p.kind === 'weapon') {
    const wname = WEAPONS[p.wInst.id].name;
    // Already own this weapon? treat as ammo refill: 1x mag.
    const owned = player.weapons.find(w => w.id === p.wInst.id);
    if (owned) {
      owned.reserve += WEAPONS[p.wInst.id].mag;
      showToast(wname + ' — AMMO +' + WEAPONS[p.wInst.id].mag, '#ffcc40');
      sfxPickup();
    } else if (player.weapons.length < 2) {
      player.weapons.push(p.wInst);
      player.weaponIdx = player.weapons.indexOf(p.wInst);
      showToast('PICKED UP: ' + wname, '#ffd060');
      sfxPickup();
    } else {
      // Swap: drop the currently held weapon at the player's feet.
      const old = player.weapons[player.weaponIdx];
      pickups.push({ x: player.x, y: player.y, kind: 'weapon', wInst: old });
      player.weapons[player.weaponIdx] = p.wInst;
      player.weaponIdx = player.weapons.indexOf(p.wInst);
      showToast('SWAP → ' + wname + '\ndropped ' + WEAPONS[old.id].name, '#ffd060');
      sfxPickup();
    }
  } else if (p.kind === 'mod') {
    applyModToCur(p.modId);
    const m = MODS[p.modId];
    showToast('MOD: ' + m.name + '\n' + m.desc, '#ffd060');
    sfxPickup();
  }
  const i = pickups.indexOf(p); if (i >= 0) pickups.splice(i, 1);
}

function updateHostage() {
  if (!hostage) return;
  // hp<=0 → MISSIONS.rescue.tick returns 'fail' (handled in runTick).
  if (hostage.hp <= 0) return;
  if (!hostage.freed) return;
  const dx = player.x - hostage.x, dy = player.y - hostage.y;
  const d = Math.hypot(dx, dy) || 1;
  if (d > 60) {
    hostage.vx = dx / d * 1.8;
    hostage.vy = dy / d * 1.8;
    hostage.facing = Math.atan2(dy, dx);
  } else brk(hostage, 0.7);
  moveEntity(hostage, 10);
}

function updateProps() {
  for (let i = props.length - 1; i >= 0; i--) {
    const p = props[i];
    if (p.kind === 'barrel' && p.hp <= 0) {
      explode(p.x, p.y, BARREL_BLAST, BARREL_DMG, 'p');
      props.splice(i, 1);
    }
  }
}

// ========================================================================
// 13. TICK LOOP — fixed timestep, dispatched by mode (title/play/dead)
// ========================================================================
function runTick() {
  if (toast.t > 0) toast.t--;
  if (mode === 'title' || mode === 'gameover') {
    if (consumePress('START1')) startRun();
    return;
  }
  if (mode === 'pause') {
    if (consumePress('START1')) { mode = 'play'; titleText.setText(''); msgText.setText(''); }
    return;
  }
  if (consumePress('START1')) { goTitle(); mode = 'pause'; titleText.setText('PAUSED'); return; }
  controlPlayer();
  for (const e of enemies) {
    updateAI(e);
    tickDot(e, 'burn', FIRE_COLS);
    tickDot(e, 'poison', POISON_COLS);
  }
  for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].hp <= 0) enemies.splice(i, 1);
  updateBullets();
  updateProps();
  updateHostage();
  updateParticles();
  if (portal) portal.t++;
  // Mission-level hooks: per-mission tick (fail trigger) + stealth-driven
  // timer (only counts down while at least one enemy is in `engage`).
  // Timer reaching zero starts ALARM mode rather than instant gameOver —
  // alarm tick keeps spawning waves until extract or death.
  if (mission && mode === 'play') {
    const M = MISSIONS[mission.type];
    if (M.tick && M.tick(mission) === 'fail') { gameOver(); return; }
    // Universal terminal progression — works for hack-mission objectives AND
    // the filler terminal in non-hack levels. Completing any terminal also
    // breaches the PC: timer reset to max + all enemies pacified.
    let detected = false;
    for (const e of enemies) if (e.state === 'engage') { detected = true; break; }
    for (const t of props) {
      if (t.kind !== 'terminal' || t.progress >= 1) continue;
      if (d2(player.x, player.y, t.x, t.y) >= 2500) continue;
      t.progress = Math.min(1, t.progress + 1 / HACK_DURATION);
      t.hackTimer = (t.hackTimer + 1) % 30;
      if (t.hackTimer === 0) { emitNoise(t.x, t.y, 200, null, 0.7); blip(1500, 0.05, 'square', 0.025); }
      if (t.progress >= 1) {
        if (t.name) setFate(t.name, 'breached');
        // PC reset: full timer + pacify all enemies + alarm cleared.
        mission.deadline = mission.deadlineMax;
        mission.detTime = 0;
        mission.armed = false;
        mission.alarm = false;
        for (const e of enemies) { e.state = 'patrol'; e.alert = 0; e.lastSeen = null; }
        blip(440, 0.3, 'sine', 0.08);
        showToast('TERMINAL BREACHED\nalarm cleared · enemies stunned · timer reset', '#66ffff');
        detected = false;
      }
    }
    // 2s grace: detection has to persist before the timer arms. Once armed,
    // the timer never pauses — only a terminal hack stops the bleed.
    mission.detTime = detected ? mission.detTime + 1 : 0;
    if (!mission.armed && mission.detTime >= 120) {
      mission.armed = true;
      showToast('SPOTTED — TIMER ARMED', '#ff5050');
    }
    if (mission.deadline > 0 && mission.armed) {
      if (--mission.deadline <= 0) startAlarm(mission);
    }
    if (mission.alarm) tickAlarm(mission);
    // Mission complete celebration — fires once per level.
    if (!mission.celebrated && mission.type !== 'extract' && missionComplete()) {
      mission.celebrated = true;
      showToast('MISSION COMPLETE\nreach portal to extract', '#66ffaa');
      blip(660, 0.18, 'sine', 0.08);
    }
  }
}

// Permanent dark-red stain at (x, y). FIFO cap so memory stays bounded on
// long, kill-heavy levels. Cleared on level change.
function dropStain(x, y, big) {
  if (bloodStains.length > 360) bloodStains.shift();
  bloodStains.push({
    x, y,
    r: big ? 9 + Math.random() * 6 : 3 + Math.random() * 4,
    col: 0x6a0010 + ((Math.random() * 0x10) | 0),
    a: 0.5 + Math.random() * 0.3,
  });
}

// Push the dead enemy's body onto the corpses list so it keeps being drawn
// (faded, with no AI/collision) until the next level. Capped FIFO.
function spawnCorpse(e, cause) {
  if (corpses.length > 100) corpses.shift();
  const c = {
    x: e.x, y: e.y,
    type: e.type,
    facing: e.facing + (Math.random() - 0.5) * 0.5,
    vip: !!e.vip,
    skin: e.skin,
    sizeK: e.sizeK,
    armCut: e.armCut,
    cause: cause || 'normal',
  };
  if (c.cause === 'explosion') {
    c.limbs = [];
    for (let i = 0; i < 4; i++) {
      const a = (i * 1.7 + e.facing);
      const r = 14 + (i * 5) % 9;
      c.limbs.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  }
  corpses.push(c);
}

// Spawn a fan of red blood specks flying outward from (x, y). The burst
// direction follows (dirX, dirY) — usually the bullet velocity — with a
// wide angular spread. `big` makes the burst denser/faster (used for kills).
// Blood-flagged particles drop a permanent stain when their life expires
// (see updateParticles).
function bloodBurst(x, y, n, dirX, dirY, big) {
  const baseAng = Math.atan2(dirY || 0, dirX || 0);
  for (let i = 0; i < n; i++) {
    const a = baseAng + (Math.random() - 0.5) * 1.8;
    const sp = (big ? 3 : 1.4) + Math.random() * (big ? 3 : 2);
    particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 14 + (Math.random() * 14 | 0),
      max: 28,
      col: 0xff2040,
      r: 2 + Math.random() * 2,
      grav: 0.18,
      blood: true,
    });
  }
  // Initial smear at the burst origin.
  dropStain(x, y, big);
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life--;
    p.x += p.vx;
    p.y += p.vy;
    if (p.grav) p.vy += p.grav;
    if (p.life <= 0) {
      // Blood specks leave a stain where they land.
      if (p.blood) dropStain(p.x, p.y, false);
      particles.splice(i, 1);
    }
  }
  for (let i = explosions.length - 1; i >= 0; i--) {
    const e = explosions[i];
    e.life--;
    e.r = e.max * (1 - e.life / 14);
    if (e.life <= 0) explosions.splice(i, 1);
  }
}

// ========================================================================
// 14. RENDER — drawing helpers + per-frame draw passes
// ========================================================================
// Universal helpers: caller passes the target Graphics (g for world, gHud for HUD).
const fc = (G, c, a, x, y, r) => G.fillStyle(c, a).fillCircle(x, y, r);
const fr = (G, c, a, x, y, w, h) => G.fillStyle(c, a).fillRect(x, y, w, h);
const sc = (G, lw, c, a, x, y, r) => G.lineStyle(lw, c, a).strokeCircle(x, y, r);
const sr = (G, lw, c, a, x, y, w, h) => G.lineStyle(lw, c, a).strokeRect(x, y, w, h);
const ln = (G, lw, c, a, x1, y1, x2, y2) => G.lineStyle(lw, c, a).lineBetween(x1, y1, x2, y2);
// Polygon: pts is an array of [x, y]; fills with color/alpha.
// Rotated+scaled local→world transform builder. Shared by drawPerson/drawCorpse.
const mkT = (x, y, ang, k) => {
  const c = Math.cos(ang), s = Math.sin(ang);
  return (lx, ly) => [x + (-lx * s - ly * c) * k, y + (lx * c - ly * s) * k];
};
// Shared poly tracer: moveTo first vert, lineTo rest.
function _poly(G, pts) {
  G.beginPath();
  G.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) G.lineTo(pts[i][0], pts[i][1]);
}
function polyFill(G, c, a, pts) {
  G.fillStyle(c, a); _poly(G, pts); G.closePath(); G.fillPath();
}
function polyStroke(G, lw, c, a, pts, closed) {
  G.lineStyle(lw, c, a); _poly(G, pts);
  if (closed) G.closePath();
  G.strokePath();
}
function bar(G, x, y, w, h, frac, trackCol, fillCol, outA) {
  fr(G, trackCol, 1, x, y, w, h);
  fr(G, fillCol, 1, x, y, w * frac, h);
  if (outA) sr(G, 1, 0xffffff, outA, x, y, w, h);
}
// Stroke a partial circular arc starting at the top, sweeping clockwise.
// Used for both reload progress around the player and hack progress on the
// terminal — same shape, different color/scale.
function arcRing(x, y, r, frac, lw, col) {
  g.lineStyle(lw, col, 1);
  g.beginPath();
  g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2, false);
  g.strokePath();
}

function render() {
  g.clear();
  gHud.clear();
  // Toast update (any mode). Fade alpha over last 30 ticks.
  const tt = toast.t;
  toastText.setAlpha(tt > 0 ? (tt < 30 ? tt / 30 : 1) : 0);
  if (tt > 0) { toastText.setText(toast.text); toastText.setColor(toast.col); }
  if (mode === 'title' || mode === 'gameover') {
    if (mode === 'title') drawMap();
    return;
  }
  drawMap();
  for (const s of bloodStains) fc(g, s.col, s.a, s.x, s.y, s.r);
  for (const c of corpses) drawCorpse(c);
  drawProps();
  drawPickups();
  drawPortal();
  drawHostage();
  drawEnemies();
  drawPlayer();
  drawBullets();
  drawExplosions();
  drawParticles();
  drawSightCones();
  if (mission && mission.alarm) {
    const pulse = 0.10 + 0.22 * Math.abs(Math.sin(frameCount * 0.20));
    fr(gHud, 0xff0030, pulse, 0, 0, W, H);
  }
  drawHud();
  drawObjective();
}

function drawMap() {
  const cam = scene.cameras.main;
  const x0 = Math.max(0, pt(cam.scrollX));
  const y0 = Math.max(0, pt(cam.scrollY));
  const cx1 = ((cam.scrollX + W) / TILE | 0) + 2;
  const cy1 = ((cam.scrollY + H) / TILE | 0) + 2;
  const x1 = map ? Math.min(WORLD_COLS, cx1) : cx1;
  const y1 = map ? Math.min(WORLD_ROWS, cy1) : cy1;
  // Floor: hash-noise tint per tile, with occasional flecks/dots.
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (map && isSolid(map, x, y)) continue;
    const h = ((x * 73856093) ^ (y * 19349663)) & 0xff;
    fr(g, 0x10171f + (h & 0x1f), 1, x * TILE, y * TILE, TILE, TILE);
    if ((h & 0x07) === 0) fr(g, 0x222a35, 0.4, x * TILE + 6, y * TILE + 12, 4, 2);
    if ((h & 0x1f) === 5) fc(g, 0x1c2630, 0.5, x * TILE + 28, y * TILE + 22, 3);
  }
  // Grid lines (single style for both axes).
  g.lineStyle(1, 0x1a2030, 0.5);
  for (let y = y0; y <= y1; y++) g.lineBetween(x0 * TILE, y * TILE, x1 * TILE, y * TILE);
  for (let x = x0; x <= x1; x++) g.lineBetween(x * TILE, y0 * TILE, x * TILE, y1 * TILE);
  if (!map) return;
  // Walls.
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (!isSolid(map, x, y)) continue;
    const px = x * TILE, py = y * TILE;
    fr(g, 0x2a3344, 1, px, py, TILE, TILE);
    sr(g, 1, 0x4a5870, 1, px + 1, py + 1, TILE - 2, TILE - 2);
  }
}

// Procedural top-down character sprite (Hotline Miami spec). Layers in
// draw order: torso ellipse → arms (quadratic bezier) → weapon → head
// (outer helmet + inner visor). Local frame: front = -y, right = +x.
// `pal` carries the palette { torso, arm, headOuter, headInner }.
// `weaponFn(wx, wy, wang)` if provided is invoked at the muzzle root.
// Reusable for the player and every enemy.
function drawPerson(x, y, ang, pal, weaponFn, a, k) {
  a = a == null ? 1 : a;
  k = k || 1;
  const T = mkT(x, y, ang, k);
  // Torso — 16-vertex ellipse, wider than tall (rx=13, ry=10).
  const tpts = [];
  for (let i = 0; i < 16; i++) {
    const t = i / 16 * Math.PI * 2;
    tpts.push(T(13 * Math.cos(t), 10 * Math.sin(t)));
  }
  polyFill(g, pal.torso, a, tpts);
  // Arms — quadratic bezier from shoulder to grip, sampled in 4 segments.
  // armCut: 0=bare (skin), 2=short sleeve (upper sleeve, lower skin), 4=long.
  const cut = pal.armCut == null ? 4 : pal.armCut;
  for (let s = -1; s <= 1; s += 2) {
    const p0 = T(s * 11, 0), p1 = T(s * 12, -10), p2 = T(s * 2, -17);
    const ps = [p0];
    for (let i = 1; i <= 4; i++) {
      const t = i / 4, u = 1 - t;
      ps.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
               u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
    }
    for (let pass = 0; pass < 2; pass++) {
      const lo = pass ? cut : 0, hi = pass ? 4 : cut;
      if (lo >= hi) continue;
      g.lineStyle(5 * k, pass ? pal.headInner : pal.arm, a);
      g.beginPath();
      g.moveTo(ps[lo][0], ps[lo][1]);
      for (let i = lo + 1; i <= hi; i++) g.lineTo(ps[i][0], ps[i][1]);
      g.strokePath();
    }
  }
  // Weapon springs from between the arms (just below the head).
  if (weaponFn) { const wp = T(0, -10); weaponFn(wp[0], wp[1], ang); }
  headDot(T(0, -3), pal.headInner, a, k);
}
// Head: filled skin circle + black outline. Shared by live person and corpse.
function headDot(hp, skin, a, k) {
  fc(g, skin, a, hp[0], hp[1], 6.75 * k);
  sc(g, 1.2, 0, a * 0.7, hp[0], hp[1], 6.75 * k);
}

function drawPlayer() {
  if (!player || player.hp <= 0) return;
  const hit = player.deadFlash > 0;
  if (hit) player.deadFlash--;
  const a = player.iframes > 0 ? 0.5 : 1;
  const ang = player.facing;
  const w = curWeapon();
  const reloading = w.reloading > 0;
  drawPerson(player.x, player.y, ang, {
    torso:     hit ? 0xff4466 : 0x303030,   // jacket
    arm:       hit ? 0xff8866 : 0x484848,   // sleeve (lighter shade)
    headInner: hit ? 0xffeeee : 0xffd8a0,   // skin
  }, reloading ? null : (wx, wy, wang) => drawWeaponIcon(g, wx, wy, w, wang, 1), a);
  if (w.laser && !reloading) {
    const d = rayDistToWall(player.x, player.y, ang, w.range);
    ln(g, 1, 0xff3333, 0.65, player.x, player.y, player.x + Math.cos(ang) * d, player.y + Math.sin(ang) * d);
  }
  if (reloading) {
    const total = w.reload;
    const frac = 1 - w.reloading / total;
    sc(g, 2, 0xffaa00, 1, player.x, player.y, PLAYER_R + 6);
    arcRing(player.x, player.y, PLAYER_R + 6, frac, 3, 0xffe040);
  }
}

function drawWeaponIcon(gx, x, y, w, ang, scale) {
  const c = w.bcol;
  const s = scale || 1;
  const cx = Math.cos(ang), sx = Math.sin(ang);
  const px = -sx, py = cx;
  // Local rotation: (K along barrel, J along perpendicular) → world coords.
  const ox = (K, J) => x + cx * K + px * J;
  const oy = (K, J) => y + sx * K + py * J;
  const WL = { sniper:[22], lmg:[17,3.5], rifle:[18], burst:[18], launcher:[13,4], shotgun:[13], smg:[13] };
  const wl = WL[w.id] || [11];
  const len = wl[0] * s, thick = wl[1] || 2;
  gx.lineStyle(thick, c, 1);
  gx.lineBetween(x, y, ox(len, 0), oy(len, 0));
  if (w.id === 'shotgun') {
    gx.lineStyle(2, c, 1);
    gx.lineBetween(ox(0, 2.5), oy(0, 2.5), ox(len, 2.5), oy(len, 2.5));
    gx.lineBetween(ox(0, -2.5), oy(0, -2.5), ox(len, -2.5), oy(len, -2.5));
    gx.fillStyle(0x553322, 1).fillCircle(ox(-2, 0), oy(-2, 0), 3 * s);
  } else if (w.id === 'sniper') {
    gx.fillStyle(c, 1).fillCircle(ox(len * 0.4, 4), oy(len * 0.4, 4), 2.2 * s);
    gx.lineStyle(1, c, 0.7);
    gx.lineBetween(ox(len * 0.4, 0), oy(len * 0.4, 0), ox(len * 0.4, 4), oy(len * 0.4, 4));
    gx.fillStyle(0xddeeff, 1).fillCircle(ox(len, 0), oy(len, 0), 2);
  } else if (w.id === 'launcher') {
    gx.fillStyle(c, 1);
    gx.beginPath();
    gx.moveTo(ox(len, 4), oy(len, 4));
    gx.lineTo(x + cx * (len + 4), y + sx * (len + 4));
    gx.lineTo(ox(len, -4), oy(len, -4));
    gx.closePath(); gx.fillPath();
  } else if (w.id === 'lmg') {
    gx.fillStyle(c, 1).fillCircle(ox(4, 4), oy(4, 4), 4 * s);
    gx.lineStyle(1, 0x222, 1).strokeCircle(ox(4, 4), oy(4, 4), 4 * s);
  } else if (w.id === 'smg') {
    const mx = ox(5, 3), my = oy(5, 3);
    gx.fillStyle(c, 1).fillRect(mx - 1.5, my - 1.5, 3 * s, 6 * s);
  } else if (w.id === 'rifle' || w.id === 'burst') {
    gx.fillStyle(c, 1).fillCircle(ox(len * 0.55, -3), oy(len * 0.55, -3), 1.6 * s);
    if (w.id === 'burst') {
      gx.fillCircle(ox(len * 0.75, -3), oy(len * 0.75, -3), 1.4 * s);
    }
  } else if (w.id === 'pistol') {
    gx.fillStyle(c, 0.8).fillCircle(ox(-2, 0), oy(-2, 0), 2.2 * s);
  }
  gx.fillStyle(0x202830, 1).fillCircle(x, y, 2 * s);
}

// Permanent blood pool layer — drawn just above the floor, below everything
// Lying-down dead body: torso, splayed arms/legs, head — with variants per
// cause of death (headshot = no head, explosion = scattered limbs, burn =
// charred, poison = green skin). Matches drawPerson scale + detail.
function drawCorpse(c) {
  const d = ENEMIES[c.type];
  const pal = enemyPal(d, c);
  const cs = c.cause;
  const ch = cs === 'burn';
  const ex = cs === 'explosion';
  const hs = cs === 'headshot';
  const ps = cs === 'poison';
  const torso = ch ? 0x1a1a1a : pal.torso;
  const arm = ch ? 0x1a1a1a : pal.arm;
  const skin = ch ? 0x1a1a1a : ps ? 0x99cc66 : pal.headInner;
  const a = 0.7;
  const k = c.sizeK || 1;
  if (!ch) fc(g, ex ? 0x8a1020 : 0x6a0010, 0.55, c.x, c.y, (d.r + (ex ? 10 : 5)) * k);
  const T = mkT(c.x, c.y, c.facing, k);
  // Rectangular torso (4 corners), narrow + long.
  const body = [T(-8, -10), T(8, -10), T(8, 10), T(-8, 10)];
  if (ex) {
    polyFill(g, torso, a, body);
    for (let i = 0; i < c.limbs.length; i++) {
      const [dx, dy] = c.limbs[i];
      fc(g, i < 2 ? skin : arm, a, c.x + dx * k, c.y + dy * k, 6 * k);
    }
  } else {
    const cut = c.armCut == null ? 4 : c.armCut;
    const limb = (p0, p1, p2, c1, c2, w) => {
      ln(g, w * k, c1, a, p0[0], p0[1], p1[0], p1[1]);
      ln(g, 5 * k, c2, a, p1[0], p1[1], p2[0], p2[1]);
    };
    const upArm = cut >= 2 ? arm : skin;
    const loArm = cut === 4 ? arm : skin;
    // Arms first (behind body), then body, then legs (in front).
    limb(T(6, -10),  T(16, -14), T(14, -24), upArm, loArm, 6);
    limb(T(-6, -10), T(-14, 4),  T(-18, 14), upArm, loArm, 6);
    polyFill(g, torso, a, body);
    limb(T(5, 10),  T(7, 24),    T(2, 38),  torso, torso, 7);
    limb(T(-5, 10), T(-11, 25),  T(-3, 38), torso, torso, 7);
    if (!hs) headDot(T(0, -15), skin, a, k);
  }
}

function drawEnemies() {
  for (const e of enemies) {
    const d = ENEMIES[e.type];
    if (e.vip) {
      fc(g, 0xffcc44, 0.25 + 0.15 * Math.sin(frameCount * 0.2), e.x, e.y, d.r * 2);
      sc(g, 2, 0xffcc44, 1, e.x, e.y, d.r + 4);
    }
    drawPerson(e.x, e.y, e.facing, enemyPal(d, e),
      e.weapon ? (wx, wy, wa) => drawWeaponIcon(g, wx, wy, e.weapon, wa, 0.9) : null,
      1, e.sizeK);
    const hpFrac = e.hp / e.maxHp;
    if (hpFrac < 1) {
      bar(g, e.x - d.r, e.y - d.r - 7, d.r * 2, 3, hpFrac, 0x000000, 0x44ff66);
    }
    if (e.alert > 0.05 && e.state !== 'engage') {
      fr(g, 0xffff66, e.alert, e.x - 1, e.y - d.r - 14, 2, 6);
      fr(g, 0xffff66, e.alert, e.x - 1, e.y - d.r - 6,  2, 2);
    }
  }
}
// Build the runtime palette for a given enemy. Torso = type color from
// registry, arm = same channels halved, helmet hardcoded dark, visor =
// random skin assigned at spawn.
function enemyPal(d, e) {
  const c = e.vip ? 0xffd040 : d.col;
  return { torso: c, arm: (c >> 1) & 0x7f7f7f, headInner: e.skin, armCut: e.armCut };
}
function ngonPoints(cx, cy, r, n, rot) {
  const pts = [];
  rot = rot || 0;
  for (let i = 0; i < n; i++) {
    const a = rot + i / n * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}
// DDA raycast against the tile grid. Returns the exact distance from
// (x0, y0) to the first solid tile face along `ang`, or maxDist if no wall
// is hit. Avoids the jagged stair-step pattern a fixed-step march produces
// because adjacent rays converge on the same tile faces.
function rayDistToWall(x0, y0, ang, maxDist) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  let cx = pt(x0), cy = pt(y0);
  if (isSolid(map, cx, cy)) return 0;
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const tDX = dx === 0 ? Infinity : Math.abs(TILE / dx);
  const tDY = dy === 0 ? Infinity : Math.abs(TILE / dy);
  let tMX = dx === 0 ? Infinity
    : (dx > 0 ? (cx + 1) * TILE - x0 : x0 - cx * TILE) / Math.abs(dx);
  let tMY = dy === 0 ? Infinity
    : (dy > 0 ? (cy + 1) * TILE - y0 : y0 - cy * TILE) / Math.abs(dy);
  while (true) {
    if (tMX < tMY) {
      cx += stepX;
      if (tMX > maxDist) return maxDist;
      if (isSolid(map, cx, cy)) return tMX;
      tMX += tDX;
    } else {
      cy += stepY;
      if (tMY > maxDist) return maxDist;
      if (isSolid(map, cx, cy)) return tMY;
      tMY += tDY;
    }
  }
}

function drawSightCones() {
  for (const e of enemies) {
    if (e.state === 'engage') continue;
    const d = ENEMIES[e.type];
    if (d.sight === 0) continue;
    const a0 = e.facing - d.cone / 2, a1 = e.facing + d.cone / 2;
    const col = e.alert > 0.05 ? 0xffaa44 : 0x6688aa;
    g.fillStyle(col, 0.07 + e.alert * 0.1);
    g.beginPath(); g.moveTo(e.x, e.y);
    const steps = 16;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (a1 - a0) * (i / steps);
      const r = rayDistToWall(e.x, e.y, a, d.sight);
      g.lineTo(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r);
    }
    g.closePath(); g.fillPath();
  }
}

function drawBullets() {
  for (const b of bullets) {
    const c = b.bcol || 0xffffff;
    if (b.flame) {
      const f = 1 + Math.sin(frameCount * 0.5 + b.x) * 0.2;
      fc(g, 0xff4411, 0.35, b.x, b.y, 11 * f);
      fc(g, 0xff8833, 0.55, b.x, b.y, 7 * f);
      fc(g, 0xffee88, 0.9, b.x, b.y, 3.5);
    } else {
      fc(g, c, 1, b.x, b.y, 3);
      ln(g, 2, c, 0.5, b.x, b.y, b.x - b.vx * 0.6, b.y - b.vy * 0.6);
    }
  }
}

function drawExplosions() {
  for (const e of explosions) {
    const a = e.life / 14;
    sc(g, 3, 0xff8830, a, e.x, e.y, e.r);
    fc(g, 0xff5520, a * 0.4, e.x, e.y, e.r * 0.6);
  }
}

function drawParticles() {
  for (const p of particles) {
    const a = p.life / (p.max || 18);
    if (p.ring) sc(g, 2, p.col, a, p.x, p.y, p.r * (1 - a) + 4);
    else fc(g, p.col, a, p.x, p.y, p.r * a);
  }
}

function drawPickups() {
  // Cache the common phase once per frame — used by 6+ Math.sin calls below.
  const t = frameCount * 0.1, pulse = Math.sin(t);
  for (const p of pickups) {
    if (p.kind === 'health') {
      const r = 8 + pulse * 1.5;
      fc(g, 0x44ff66, 0.9, p.x, p.y, r);
      sc(g, 2, 0xffffff, 1, p.x, p.y, r);
      fr(g, 0xffffff, 1, p.x - 1, p.y - 5, 2, 10);
      fr(g, 0xffffff, 1, p.x - 5, p.y - 1, 10, 2);
    } else if (p.kind === 'armor') {
      fr(g, 0x4488cc, 0.9, p.x - 7, p.y - 8, 14, 14);
      sr(g, 1, 0xaaddff, 1, p.x - 7, p.y - 8, 14, 14);
      fr(g, 0xaaddff, 1, p.x - 1, p.y - 5, 2, 8);
      fr(g, 0xaaddff, 1, p.x - 4, p.y - 2, 8, 2);
    } else if (p.kind === 'ammo') {
      fr(g, 0xffe070, 0.9, p.x - 8, p.y - 6, 16, 12);
      sr(g, 1, 0xffffff, 1, p.x - 8, p.y - 6, 16, 12);
      fr(g, 0x000000, 0.6, p.x - 5, p.y - 3, 10, 2);
      fr(g, 0x000000, 0.6, p.x - 5, p.y + 1, 10, 2);
    } else if (p.kind === 'weapon') {
      fc(g, p.wInst.bcol, 0.18 + 0.08 * pulse, p.x, p.y, 16);
      sc(g, 1, p.wInst.bcol, 0.7, p.x, p.y, 14);
      drawWeaponIcon(g, p.x - 8, p.y, p.wInst, 0, 1.1);
    } else if (p.kind === 'mod') {
      const r = 12 + pulse * 2;
      fc(g, 0xffaa22, 0.22 + 0.14 * Math.sin(frameCount * 0.16), p.x, p.y, r + 8);
      polyStroke(g, 2, 0xffd060, 1, ngonPoints(p.x, p.y, r, 6, frameCount * 0.03), true);
      fc(g, 0xffe070, 0.95, p.x, p.y, 4 + Math.abs(Math.sin(frameCount * 0.2)) * 2);
    }
  }
}

function drawProps() {
  for (const p of props) {
    if (p.kind === 'barrel') {
      const t = frameCount * 0.05;
      fc(g, 0xaa3322, 1, p.x, p.y, 12);
      sc(g, 1, 0x661111, 1, p.x, p.y, 12);
      fr(g, 0xffaa44, 0.7 + 0.3 * Math.sin(t), p.x - 8, p.y - 2, 16, 4);
      fr(g, 0x222222, 1, p.x - 8, p.y - 6, 16, 2);
      fr(g, 0x222222, 1, p.x - 8, p.y + 4, 16, 2);
    } else if (p.kind === 'cage') {
      sr(g, 2, 0xcccccc, 0.9, p.x - 16, p.y - 16, 32, 32);
      g.lineStyle(2, 0xcccccc, 0.9);
      for (let i = -10; i <= 10; i += 5) {
        g.lineBetween(p.x + i, p.y - 16, p.x + i, p.y + 16);
        g.lineBetween(p.x - 16, p.y + i, p.x + 16, p.y + i);
      }
    } else if (p.kind === 'terminal') {
      fr(g, 0x224488, 1, p.x - 14, p.y - 14, 28, 28);
      sr(g, 2, 0x66ccff, 1, p.x - 14, p.y - 14, 28, 28);
      fr(g, 0x66ccff, 0.6 + 0.4 * Math.sin(frameCount * 0.15), p.x - 10, p.y - 10, 20, 14);
      // Hack progress ring — per-terminal so multiple nodes show independent fills.
      if (mission && mission.type === 'hack') {
        const r = 22, frac = p.progress || 0;
        sc(g, 3, 0xffcc44, 0.4, p.x, p.y, r);
        if (frac > 0) arcRing(p.x, p.y, r, frac, 3, 0xffcc44);
      }
    } else if (p.kind === 'prize') {
      const pls = 0.6 + 0.4 * Math.sin(frameCount * 0.12);
      fc(g, 0xffd060, 0.25 * pls, p.x, p.y, 28);
      fr(g, 0xffd060, 1, p.x - 10, p.y - 10, 20, 20);
      sr(g, 2, 0xffffff, pls, p.x - 10, p.y - 10, 20, 20);
    }
  }
}

function drawHostage() {
  if (!hostage || hostage.hp <= 0) return;
  const ang = hostage.freed ? hostage.facing : 0;
  drawPerson(hostage.x, hostage.y, ang,
    { torso: 0x44ffaa, arm: 0x22a070, headInner: 0xffd8a0 }, null, 1, 0.65);
  const f = hostage.hp / hostage.maxHp;
  bar(g, hostage.x - 12, hostage.y - 16, 24, 3, f, 0x000000, 0x44ffaa);
  if (!hostage.freed) {
    sc(g, 2, 0xffe040, 0.8 + 0.2 * Math.sin(frameCount * 0.15), hostage.x, hostage.y, 18);
  }
}

function drawPortal() {
  if (!portal) return;
  const r = 22 + Math.sin(portal.t * 0.1) * 3;
  const active = missionComplete();
  const colMain = active ? 0x66ffaa : 0x884444;
  const colDim  = active ? 0xaaffcc : 0xbb6666;
  sc(g, 3, colMain, 1,   portal.x, portal.y, r);
  sc(g, 1, colDim,  0.6, portal.x, portal.y, r * 0.7);
  fc(g, colMain, 0.2,    portal.x, portal.y, r * 0.5);
  for (let i = 0; i < 4; i++) {
    const a = portal.t * 0.05 + i * Math.PI / 2;
    ln(g, 2, colMain, 0.6,
      portal.x + Math.cos(a) * (r + 4),  portal.y + Math.sin(a) * (r + 4),
      portal.x + Math.cos(a) * (r + 14), portal.y + Math.sin(a) * (r + 14));
  }
  if (!active) {
    ln(g, 3, 0xff8888, 1, portal.x - 8, portal.y - 8, portal.x + 8, portal.y + 8);
    ln(g, 3, 0xff8888, 1, portal.x - 8, portal.y + 8, portal.x + 8, portal.y - 8);
  }
}

function drawHud() {
  if (!player) return;
  fr(gHud, 0x000000, 0.55, 0, 0, W, 110);
  ln(gHud, 1, 0x335577, 0.5, 0, 110, W, 110);

  // HP bar (red track + green/red fill).
  const hpFrac = Math.max(0, player.hp / player.maxHp);
  bar(gHud, 8, 16, 200, 10, hpFrac, 0x331818, player.hp < player.maxHp * 0.3 ? 0xff4040 : 0x44ff66, 0.8);
  // Armor bar (blue), thinner, just below HP.
  const arFrac = Math.max(0, player.armor / player.maxArmor);
  bar(gHud, 8, 28, 200, 6, arFrac, 0x102030, 0x66bbff, 0.6);

  // Mag bar — orange while reloading, yellow otherwise.
  const w = curWeapon();
  const maxMag = w.mag;
  if (w.reloading > 0) {
    bar(gHud, 220, 16, 140, 16, 1 - w.reloading / w.reload, 0x332200, 0xffaa00, 0.8);
  } else {
    bar(gHud, 220, 16, 140, 16, w.ammo / Math.max(1, maxMag), 0x222a33, 0xfff0a0, 0.8);
  }
  drawWeaponIcon(gHud, 384, 24, w, 0, 1.15);

  if (portal) {
    drawHudCompass(w, maxMag);
  } else {
    hudText.setText('HP ' + (player.hp | 0) + '/' + player.maxHp + '  AR ' + (player.armor | 0) + '   LV ' + levelN);
  }
}

function drawHudCompass(w, maxMag) {
  const dx = portal.x - player.x, dy = portal.y - player.y;
  const dist = Math.hypot(dx, dy);
  const a = Math.atan2(dy, dx);
  const cx = W - 60, cy = 24;
  const colDir = missionComplete() ? 0x66ffaa : 0x886655;
  sc(gHud, 2, colDir, 0.9, cx, cy, 14);
  // Triangular needle pointing toward portal.
  const ca = Math.cos(a), sa = Math.sin(a);
  const tx = cx + ca * 14, ty = cy + sa * 14;
  const bx = cx - ca * 8, by = cy - sa * 8;
  const nx = -sa * 5, ny = ca * 5;
  polyFill(gHud, colDir, 1, [[tx, ty], [bx + nx, by + ny], [bx - nx, by - ny]]);
  // Multiline status text.
  const modList = ws => ws.map(m => MODS[m].name.toLowerCase()).join(', ');
  const modsStr = w.mods.length ? modList(w.mods) : '—';
  let alt = '';
  if (player.weapons.length > 1) {
    const o = player.weapons[(player.weaponIdx + 1) % player.weapons.length];
    const oMax = o.mag;
    const oMods = o.mods.length ? '  [' + modList(o.mods) + ']' : '';
    alt = '\nALT: ' + o.name + ' ' + (o.reloading > 0 ? 'RLD' : (o.ammo + '/' + oMax)) + ' [' + o.reserve + ']' + oMods;
  }
  hudText.setText(
    'HP ' + (player.hp | 0) + '/' + player.maxHp + '  AR ' + (player.armor | 0) +
    '   LV ' + levelN + '   SCORE ' + score + '   ESCAPE ' + (dist | 0) + 'm' +
    '\n' + w.name + ' ' + (w.reloading > 0 ? 'RLD' : (w.ammo + '/' + maxMag)) + '  RES ' + w.reserve +
    '   MODS: ' + modsStr +
    alt
  );
}

function drawObjective() {
  if (!mission || mode !== 'play') {
    objText.setText('');
    if (timerText) timerText.setText('');
    return;
  }
  let obj = MISSIONS[mission.type].objective(mission);
  if (nearestPickup(player.x, player.y, PICKUP_R + 6)) obj += '   [press O to pick up]';
  objText.setText(obj);
  // Big stealth timer top-right under GPS — yellow active, red <15s,
  // ALARM red when expired. Hidden during the 2s detection grace.
  if (mission.alarm) {
    timerText.setText('ALARM');
    timerText.setColor('#ff3030');
  } else if (mission.deadline > 0 && mission.armed) {
    const sec = Math.ceil(mission.deadline / 60);
    timerText.setText(sec + 's');
    timerText.setColor(sec < 15 ? '#ff5050' : '#ffd060');
  } else {
    timerText.setText('');
  }
}

// ========================================================================
// 15. AUDIO (procedural — Web Audio oscillators + simple step sequencer)
// ========================================================================
let audioCtx = null;
function getCtx() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { audioCtx = null; }
  }
  if (audioCtx && audioCtx.state === 'suspended') { try { audioCtx.resume(); } catch {} }
  return audioCtx;
}
// Single oscillator wrapper. If `f1` is provided, the pitch linearly slides
// from `freq` to `f1` over `dur`; otherwise it stays constant.
function blip(freq, dur, type, vol, f1) {
  const c = getCtx(); if (!c) return;
  const o = c.createOscillator(), gn = c.createGain();
  o.type = type || 'square';
  if (f1) {
    o.frequency.setValueAtTime(freq, c.currentTime);
    o.frequency.linearRampToValueAtTime(Math.max(20, f1), c.currentTime + dur);
  } else {
    o.frequency.value = freq;
  }
  gn.gain.value = vol || 0.04;
  gn.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(gn); gn.connect(c.destination);
  o.start(); o.stop(c.currentTime + dur);
}
// Bandpass-filtered white noise burst — gives crunch/squelch to flesh hits.
function noise(dur, vol, freq) {
  const c = getCtx(); if (!c) return;
  const buf = c.createBuffer(1, (c.sampleRate * dur) | 0, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 800;
  const gn = c.createGain(); gn.gain.value = vol || 0.05;
  src.connect(f); f.connect(gn); gn.connect(c.destination);
  src.start(); src.stop(c.currentTime + dur);
}
const SHOOT_SFX = {
  shotgun:  [120, 0.10, 'sawtooth', 0.18],
  sniper:   [180, 0.15, 'square',   0.20],
  launcher: [80,  0.18, 'sawtooth', 0.22],
  lmg:      [420, 0.04, 'square',   0.12],
  smg:      [520, 0.03, 'square',   0.10],
};
function sfxShoot(id) { blip(...(SHOOT_SFX[id] || [380, 0.05, 'square', 0.13])); }
function sfxDie()    { blip(220, 0.5, 'sawtooth', 0.10, 50); noise(0.40, 0.07, 500); }
function sfxPickup() { blip(880, 0.06, 'triangle', 0.05); blip(1320, 0.06, 'triangle', 0.04); }

// Driving 16-step loop in D minor at ~125 BPM (16th-note feel).
// Layered kick / snare / bass / lead so the track keeps constant motion.
const MUS_KICK  = [1,0,0,0,  1,0,0,0,  1,0,0,0,  1,0,1,0];
const MUS_SNARE = [0,0,0,0,  1,0,0,0,  0,0,0,0,  1,0,0,1];
const MUS_BASS  = [73,0,73,73,  73,0,87,0,  73,0,73,110,  73,0,65,73];
const MUS_LEAD  = [0,0,294,0,  0,349,0,294,  0,0,294,0,  0,262,0,294];
function startMusic() {
  if (musicStarted) {
    // HMR-friendly: cancel any stale timer chain before restarting.
    if (musTimer) { clearTimeout(musTimer); musTimer = null; }
  }
  musicStarted = true;
  musStep = 0;
  scheduleMusicNote();
}
function scheduleMusicNote() {
  const c = getCtx();
  const beat = 0.12;
  if (c) {
    const i = musStep % 16;
    // Volumes tuned to sit just under the loudest SFX (~0.08) so the
    // backing track is clearly present without burying gunshots/explosions.
    if (MUS_KICK[i])  blip(55,          beat * 1.4,  'sawtooth', 0.06);
    if (MUS_SNARE[i]) blip(220,         beat * 0.45, 'square',   0.035);
    if (MUS_BASS[i])  blip(MUS_BASS[i], beat * 0.95, 'sawtooth', 0.045);
    if (MUS_LEAD[i])  blip(MUS_LEAD[i], beat * 1.1,  'square',   0.03);
  }
  musStep++;
  musTimer = setTimeout(scheduleMusicNote, beat * 1000);
}

// ========================================================================
// 16. NAMING + STORAGE
// ========================================================================
// Builds a roster of unique ADJ + NOUN codenames at run start.
function buildRoster(n) {
  const used = new Set();
  const out = [];
  let tries = 0;
  while (out.length < n && tries++ < 200) {
    const code = pickFrom(ADJECTIVES) + ' ' + pickFrom(NOUNS);
    if (!used.has(code)) { used.add(code); out.push(code); }
  }
  return out;
}

// Pop a fresh codename for the next named spawn. Falls back to ad-hoc
// generation if the roster runs out on long runs.
function takeCodename() {
  if (runRoster.length) return runRoster.shift();
  return pickFrom(ADJECTIVES) + ' ' + pickFrom(NOUNS);
}

// Track named entities and their outcome for the death-screen epilogue.
function logTarget(name, kind) {
  runHistory.push({ name, kind, fate: 'pending', level: levelN });
}
function setFate(name, fate) {
  for (let i = runHistory.length - 1; i >= 0; i--) {
    if (runHistory[i].name === name) { runHistory[i].fate = fate; return; }
  }
}

async function loadBest() {
  try {
    const s = window.platanusArcadeStorage;
    if (!s) return;
    const r = await s.get('trigon-best');
    if (r && r.found && r.value) {
      if (typeof r.value.best === 'number') best = r.value.best | 0;
      if (Array.isArray(r.value.scores)) bestScores = r.value.scores.filter(b => b && typeof b.s === 'number').slice(0, 5);
      if (mode === 'title') goTitle();
    }
  } catch {}
}
async function saveBest() {
  try { await window.platanusArcadeStorage.set('trigon-best', { best, scores: bestScores }); } catch {}
}
function recordScore(s, lv) {
  if (s <= 0) return;
  bestScores.push({ s, lv });
  bestScores.sort((a, b) => b.s - a.s);
  if (bestScores.length > 5) bestScores.length = 5;
}
