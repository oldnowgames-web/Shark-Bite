'use strict';
/* =====================================================================
   SHARK BITE — núcleo do jogo (loop, entidades, IA, modos, desenho)
   Dados: data.js · Progresso e menus: meta.js
   ===================================================================== */
const canvas = $('game'), ctx = canvas.getContext('2d');
const mini = $('mini'), mctx = mini.getContext('2d');

/* ---------- carregamento das imagens ---------- */
const IMG = {};
function loadAll() {
  return new Promise(res => {
    let n = 0;
    FILES.forEach(f => {
      const im = new Image();
      const done = () => { n++; $('loadFill').style.width = (n / FILES.length * 100) + '%'; if (n === FILES.length) res(); };
      im.onload = done; im.onerror = done;
      im.src = 'assets/' + f + '.png';
      IMG[f] = im;
    });
  });
}

/* ---------- estado ---------- */
let state = 'loading'; // loading | menu | playing | paused | dying | over
let t = 0, cw = 0, ch = 0, dpr = 1, baseScale = 3, ws = 3;
const cam = { x: W / 2, y: 260, shake: 0 };
let shark, ents, groups, harpoons, parts, coins, bubbles, chests, decor, floorH, floorAbyss;
let score, growth, level, stats, combo, comboT, spawnT, shakeT;
let lastLevelShown = 1, deathT = 0;
// modo de jogo, fome, chefes, eventos, rival e ondas
let mode = MODES.classic, hunger = 100, huntLeft = 0, metaT = 0;
let evt = null, evT = 1e9, rival = null, rivalT = 0, boss = null, bossQ = [], wv = null;
const storm = { k: 0, on: false, t: 0, push: 0, flash: 0, nextFlash: 3 };
const newRunObj = () => ({ maxMult: 1, hurt: 0, hitless: false, gold: 0, starved: false, starveOk: false, bosses: 0, lastEvt: '' });
let R = newRunObj(); // estatísticas da partida atual (usadas nas conquistas)
const thrOf = i => LV_THRESH[i] * (mode.thr || 1); // limiares de crescimento (Caçada é um pouco mais leve)
const keys = {};
const ptr = { x: 0, y: 0, active: false, down: false, type: 'mouse' };
let dashBtnDown = false;

/* ---------- áudio sintetizado ---------- */
const VOL_STEPS = 6;
const A = { ctx: null, master: null, sfxV: store.get('sb_sfxv', 5), musV: store.get('sb_musv', 4), nextT: 0, step: 0, timer: null };
function ac() {
  if (!A.ctx) {
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      A.ctx = new C(); A.master = A.ctx.createGain(); A.master.gain.value = 0.9; A.master.connect(A.ctx.destination);
    } catch (e) { return null; }
  }
  if (A.ctx.state === 'suspended') A.ctx.resume();
  return A.ctx;
}
function tone(freq, dur, type = 'square', vol = 0.06, slide = 1, delay = 0) {
  if (A.sfxV <= 0) return; const c = ac(); if (!c) return; vol *= A.sfxV / 5;
  const s = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, s); if (slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), s + dur);
  g.gain.setValueAtTime(vol, s); g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
  o.connect(g); g.connect(A.master); o.start(s); o.stop(s + dur + 0.02);
}
function noise(dur, vol = 0.1, freq = 1200, delay = 0) {
  if (A.sfxV <= 0) return; const c = ac(); if (!c) return; vol *= A.sfxV / 5;
  const s = c.currentTime + delay, len = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; g.gain.setValueAtTime(vol, s); g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
  src.connect(f); f.connect(g); g.connect(A.master); src.start(s);
}
const SFX = {
  click() { tone(660, 0.07, 'square', 0.05); tone(880, 0.07, 'square', 0.05, 1, 0.05); },
  eat(g) { noise(0.12, 0.14, 700); tone(180 + Math.min(g, 40) * 3, 0.14, 'triangle', 0.12, 0.5); tone(520 + rand(0, 120), 0.08, 'square', 0.04, 1.6, 0.04); },
  hurt() { noise(0.25, 0.18, 500); tone(220, 0.3, 'sawtooth', 0.09, 0.4); },
  harpoon() { noise(0.25, 0.08, 2200); tone(900, 0.2, 'triangle', 0.04, 0.4); },
  coin() { tone(988, 0.06, 'square', 0.04); tone(1319, 0.12, 'square', 0.04, 1, 0.06); },
  chest() { tone(330, 0.1, 'triangle', 0.08, 1.5); tone(494, 0.1, 'triangle', 0.08, 1.5, 0.08); tone(659, 0.2, 'triangle', 0.08, 1.2, 0.16); },
  level() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.18, 'square', 0.06, 1, i * 0.09)); },
  die() { [440, 370, 311, 247, 196].forEach((f, i) => tone(f, 0.28, 'triangle', 0.1, 0.9, i * 0.17)); },
  dash() { noise(0.18, 0.05, 1800); },
  charge() { tone(300, 0.25, 'sawtooth', 0.03, 2.5); }
};
Object.assign(SFX, {
  warn() { [0, 0.18, 0.36].forEach(d => tone(220, 0.16, 'sawtooth', 0.07, 0.7, d)); },
  bossHit() { noise(0.2, 0.2, 400); tone(120, 0.25, 'square', 0.1, 0.5); tone(700, 0.1, 'triangle', 0.06, 0.5, 0.03); },
  thunder() { noise(0.9, 0.28, 180); tone(60, 0.8, 'sawtooth', 0.08, 0.5); },
  ach() { [659, 784, 988, 1319].forEach((f, i) => tone(f, 0.14, 'triangle', 0.07, 1, i * 0.08)); },
  gold() { [988, 1319, 1568].forEach((f, i) => tone(f, 0.12, 'square', 0.04, 1, i * 0.07)); },
  wave() { [392, 523, 659].forEach((f, i) => tone(f, 0.16, 'triangle', 0.07, 1, i * 0.1)); }
});
Meta.onUnlock = () => SFX.ach();
const CH = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
const mf = n => 440 * Math.pow(2, (n - 69) / 12);
function musicNote(f, s, d, type, vol) {
  const c = A.ctx, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, s); g.gain.linearRampToValueAtTime(vol, s + Math.min(0.08, d / 3)); g.gain.exponentialRampToValueAtTime(0.0001, s + d);
  o.connect(g); g.connect(A.master); o.start(s); o.stop(s + d + 0.05);
}
function musicTick() {
  if (A.musV <= 0 || !A.ctx || A.ctx.state !== 'running') { if (A.ctx) A.nextT = Math.max(A.nextT, A.ctx.currentTime); return; }
  const eighth = 60 / 92 / 2;
  while (A.nextT < A.ctx.currentTime + 0.35) {
    const st = A.step % 32, bar = Math.floor(st / 8) % 4, i = st % 8, ch = CH[bar], s = A.nextT;
    const vol = (state === 'playing' || state === 'menu' ? 1 : 0.5) * A.musV / 4;
    if (i === 0) ch.forEach(n => musicNote(mf(n - 12), s, eighth * 8, 'sine', 0.018 * vol));
    if (i === 0 || i === 4) musicNote(mf(ch[0] - 24), s, eighth * 3.5, 'triangle', 0.05 * vol);
    musicNote(mf(ch[[0, 1, 2, 1, 2, 1, 0, 1][i]] + 12), s, eighth * 1.6, 'triangle', 0.022 * vol);
    if (bar % 2 === 1 && i === 6) musicNote(mf(ch[2] + 24), s, eighth * 2, 'sine', 0.012 * vol);
    A.nextT += eighth; A.step++;
  }
}
function startMusic() { ac(); if (!A.timer) { A.nextT = A.ctx ? A.ctx.currentTime + 0.1 : 0; A.timer = setInterval(musicTick, 100); } }

/* ---------- fundo do mar: relevo, decoração ---------- */
function buildWorld() {
  // altura do chão em tiles por coluna (suave)
  floorH = [];
  let seed = rand(0, 100);
  for (let i = 0; i < COLS; i++) {
    const v = 4 + Math.sin(i * 0.11 + seed) * 1.6 + Math.sin(i * 0.31 + seed * 2) * 0.9 + Math.sin(i * 0.05 + 1) * 1.2;
    floorH.push(clamp(Math.round(v), 2, 8));
  }
  for (let k = 0; k < 2; k++) for (let i = 1; i < COLS; i++) floorH[i] = clamp(floorH[i], floorH[i - 1] - 1, floorH[i - 1] + 1);
  floorAbyss = [];
  for (let i = 0; i < COLS; i++) floorAbyss.push(Math.sin(i * 0.075 + seed * 3) + Math.sin(i * 0.21 + seed) * 0.6 > 0.45);
  // decoração
  decor = []; chests = [];
  const wk = ['seaweed_light', 'seaweed_medium', 'seaweed_dark', 'seaweed_blue', 'seaweed_pink'];
  for (let i = 1; i < COLS - 1; i++) {
    const x = i * TILE + 8, r = Math.random();
    if (r < 0.2) decor.push({ k: 'weed', img: pick(wk), row: randi(0, 7), x, y: floorTop(x) + 1, sc: pick([1, 1.5, 2]), ph: rand(0, 12) });
    else if (r < 0.3) decor.push({ k: 'coral', col: randi(0, 3), row: randi(0, 6), x, y: floorTop(x) + 1, sc: pick([1, 1.5, 2]) });
    else if (r < 0.36) decor.push({ k: 'shell', col: randi(0, 5), row: randi(0, 4), x, y: floorTop(x) + 1, sc: 1 });
  }
  const cx = [160, 470, 760, 1050, 1290, 1500].sort(() => Math.random() - 0.5).slice(0, 5);
  cx.forEach(x => chests.push({ x, y: floorTop(x), open: false, t: 0, row: randi(0, 1) }));
}
const floorTop = x => H - floorH[clamp(Math.floor(x / TILE), 0, COLS - 1)] * TILE;

/* ---------- criação de entidades ---------- */
function newEnt(key, x, y, group) {
  const sp = SP[key], ik = pick(sp.imgs);
  const e = { key, sp, x, y, vx: rand(-8, 8), vy: 0, face: Math.random() < 0.5 ? 1 : -1, sc: rand(0.92, 1.12), t: rand(0, 10),
    imgKey: ik, img: IMG[ik], row: pick(sp.rows), dh: Math.random() < 0.5 ? 1 : -1, wy: rand(-0.5, 0.5), wt: rand(0, 3),
    group: group || null, dead: false, st: 'idle', stT: rand(0.5, 3), cd: rand(1, 3), bite: 0, flash: 0 };
  e.r = sp.r * e.sc;
  return e;
}
function spawnPos(key, minD) {
  const band = BANDS[key];
  for (let i = 0; i < 14; i++) {
    let x, y;
    if (key === 'diver') { x = clamp(pick(BOATS) + rand(-120, 120), 60, W - 60); y = rand(band[0], band[1]); }
    else if (key === 'shrimp') { x = rand(60, W - 60); y = floorTop(x) - rand(8, 14); }
    else { x = rand(60, W - 60); y = rand(band[0], Math.min(band[1], floorTop(x) - 24)); }
    if (shark && Math.hypot(x - shark.x, y - shark.y) > minD) return { x, y };
  }
  return null;
}
function viewMinDist() { return Math.hypot(cw / ws, ch / ws) / 2 + 30; }
function spawnOne(key, minD) {
  const sp = SP[key];
  if (sp.school) {
    const list = groups.filter(g => g.key === key && g.n < 7 && g.n > 0);
    const g = list.length && Math.random() < 0.6 ? pick(list) : null;
    if (g && Math.hypot(g.cx - shark.x, g.cy - shark.y) > minD) {
      ents.push(newEnt(key, g.cx + rand(-25, 25), clamp(g.cy + rand(-15, 15), SURF + 20, floorTop(g.cx) - 20), g)); g.n++; return;
    }
    const p = spawnPos(key, minD); if (!p) return;
    const ng = { key, dh: Math.random() < 0.5 ? 1 : -1, wy: rand(-0.4, 0.4), wt: rand(2, 5), cx: p.x, cy: p.y, n: 0 };
    groups.push(ng);
    const cnt = randi(3, 5);
    for (let i = 0; i < cnt; i++) ents.push(newEnt(key, p.x + rand(-28, 28), clamp(p.y + rand(-18, 18), SURF + 20, floorTop(p.x) - 20), ng));
    ng.n = cnt; return;
  }
  const p = spawnPos(key, minD); if (!p) return;
  ents.push(newEnt(key, p.x, p.y, null));
}
function caps() {
  const L = level;
  return { shrimp: Math.max(4, 9 - L), fish1: Math.max(10, 26 - 3 * L), fish2: 20, squid: 8, fish3: 14, jelly: 9, angler: L <= 2 ? 2 : 4, sword: L <= 2 ? 1 : 3, saw: L <= 3 ? 1 : 3, diver: L >= 6 ? 4 : 3 };
}
function manageSpawns(dt) {
  const c = caps();
  for (const k of SP_KEYS) {
    spawnT[k] = (spawnT[k] || 0) - dt;
    if (spawnT[k] > 0) continue;
    let n = 0; for (const e of ents) if (e.key === k && !e.dead && !e.raid) n++;
    if (n < c[k]) { spawnOne(k, viewMinDist()); spawnT[k] = SP[k].resp * (SP[k].school ? 0.25 : 1); }
    else spawnT[k] = 0.4;
  }
}

function newRunState(attract) {
  R = newRunObj();
  hunger = 100; huntLeft = mode.time || 0; evt = null; rival = null; rivalT = 0; boss = null; bossQ = []; wv = null;
  storm.k = 0; storm.on = false; storm.t = 0; storm.push = 0; storm.flash = 0; storm.nextFlash = 3; metaT = 0;
  evT = !attract && mode.ev ? rand(mode.ev[0], mode.ev[1]) : 1e9;
}

/* ---------- novo jogo ---------- */
function resetWorld(attract) {
  buildWorld();
  ents = []; groups = []; harpoons = []; parts = []; coins = []; bubbles = []; spawnT = {};
  score = 0; growth = 0; level = 1; combo = 0; comboT = 0; lastLevelShown = 1; deathT = 0;
  stats = { eaten: 0, coins: 0, time: 0, wallet: 0 }; newRunState(attract);
  shark = { x: W / 2, y: 230, vx: 0, vy: 0, face: 1, m: 1, mT: 1, hp: MAX_HP, sta: 100, exhausted: false, staDelay: 0, inv: attract ? 0 : 2,
    bite: 0, stun: 0, dead: false, dash: false, t: 0, flash: 0, rot: 0 };
  cam.x = shark.x; cam.y = 240; cam.shake = 0;
  const c = caps();
  for (const k of SP_KEYS) {
    const guard = k === 'angler' || k === 'sword' || k === 'saw' ? 300 : 130;
    let guardN = 0;
    while (ents.filter(e => e.key === k).length < c[k] && guardN++ < 80) spawnOne(k, guard);
  }
  buildChips(); updateHud(true);
}

/* ---------- entrada ---------- */
const KEYMAP = { ArrowLeft: 'l', a: 'l', A: 'l', ArrowRight: 'r', d: 'r', D: 'r', ArrowUp: 'u', w: 'u', W: 'u', ArrowDown: 'd', s: 'd', S: 'd', ' ': 'dash', Shift: 'dash' };
window.addEventListener('keydown', e => {
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { e.preventDefault(); togglePause(); return; }
  const k = KEYMAP[e.key];
  if (k) { keys[k] = true; if (state === 'playing') e.preventDefault(); }
  if (state === 'menu' && e.key === 'Enter' && !$('menu').classList.contains('hidden')) startGame(P.lastMode);
});
window.addEventListener('keyup', e => { const k = KEYMAP[e.key]; if (k) keys[k] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; ptr.down = false; dashBtnDown = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') togglePause(true); });
canvas.addEventListener('pointermove', e => { ptr.x = e.clientX; ptr.y = e.clientY; ptr.type = e.pointerType; if (e.pointerType === 'mouse') ptr.active = true; });
canvas.addEventListener('pointerdown', e => { ptr.x = e.clientX; ptr.y = e.clientY; ptr.type = e.pointerType; ptr.down = true; ptr.active = true; try { canvas.setPointerCapture(e.pointerId); } catch (_) {} ac(); });
canvas.addEventListener('pointerup', e => { ptr.down = false; if (e.pointerType !== 'mouse') ptr.active = false; });
canvas.addEventListener('pointercancel', () => { ptr.down = false; ptr.active = false; });
canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') ptr.active = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
const dashBtn = $('dashBtn');
dashBtn.addEventListener('pointerdown', e => { e.preventDefault(); dashBtnDown = true; });
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => dashBtn.addEventListener(ev, () => { dashBtnDown = false; }));

function screenToWorld(px, py) { return { x: (px * dpr - cw / 2) / ws + cam.x, y: (py * dpr - ch / 2) / ws + cam.y }; }

/* ---------- telas / menus ---------- */
const screens = ['menu', 'how', 'opts', 'skins', 'credits', 'pause', 'over', 'loading', 'modes', 'ach', 'album'];
function showScreen(id) { screens.forEach(s => $(s).classList.toggle('hidden', s !== id)); }
function hideScreens() { screens.forEach(s => $(s).classList.add('hidden')); }
function refreshBest() {
  const a = [];
  if (P.best.classic) a.push('Clássico ' + P.best.classic); if (P.best.hunt) a.push('Caçada ' + P.best.hunt); if (P.best.wave) a.push('Onda ' + P.best.wave);
  $('bestMenu').textContent = a.length ? 'Recordes: ' + a.join(' · ') : ''; $('walletMenu').textContent = P.wallet;
}
/* ---------- sliders de volume (arte UI-Slider) ---------- */
const sliders = [];
function makeSlider(id, get, set, onPreview) {
  const el = $(id); el.innerHTML = '';
  const left = document.createElement('div'); left.className = 'sl-left'; el.appendChild(left);
  const segs = [];
  for (let i = 0; i < VOL_STEPS; i++) { const d = document.createElement('div'); d.className = 'sl-seg'; el.appendChild(d); segs.push(d); }
  const right = document.createElement('div'); right.className = 'sl-right'; el.appendChild(right);
  const render = () => segs.forEach((d, i) => d.classList.toggle('on', i < get()));
  const fromX = cx => {
    const r0 = segs[0].getBoundingClientRect(); if (cx < r0.left) return 0;
    for (let i = 0; i < segs.length; i++) { const r = segs[i].getBoundingClientRect(); if (cx <= r.right) return i + 1; }
    return VOL_STEPS;
  };
  let down = false;
  const apply = e => { const v = fromX(e.clientX); if (v !== get()) { set(v); render(); if (onPreview) onPreview(); } };
  el.addEventListener('pointerdown', e => { down = true; ac(); startMusic(); apply(e); try { el.setPointerCapture(e.pointerId); } catch (_) {} });
  el.addEventListener('pointermove', e => { if (down) apply(e); });
  ['pointerup', 'pointercancel'].forEach(ev => el.addEventListener(ev, () => { down = false; }));
  sliders.push(render); render();
}
function refreshOpts() { sliders.forEach(r => r()); }

/* ---------- skins do tubarão (camadas Head/Tail recoloridas + efeitos) ---------- */
const skinSheets = [], rainbowSheets = [];
let hitSheet = null, rivalSheet = null;
const HAS_FILTER = (() => { try { return 'filter' in document.createElement('canvas').getContext('2d'); } catch (e) { return false; } })();
function tintImg(img, sk, forceMultiply) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  if (!forceMultiply && sk.hue === 0 && sk.sat === 1 && sk.bri === 1) { g.drawImage(img, 0, 0); return c; }
  if (!forceMultiply && HAS_FILTER) { g.filter = 'hue-rotate(' + sk.hue + 'deg) saturate(' + sk.sat + ') brightness(' + sk.bri + ')'; g.drawImage(img, 0, 0); g.filter = 'none'; }
  else {
    g.drawImage(img, 0, 0); g.globalCompositeOperation = 'multiply'; g.fillStyle = sk.tint; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in'; g.drawImage(img, 0, 0);
  }
  return c;
}
const RIVAL_SK = { hue: 150, sat: 2.2, bri: 0.62, tint: '#b03a5a' };
const sheetOf = (sk, fm) => ({ head: tintImg(IMG.shark_head, sk, fm), tail: tintImg(IMG.shark_tail, sk, fm) });
function buildSkins() {
  SKINS.forEach((sk, i) => { skinSheets[i] = sheetOf(sk); });
  for (let i = 0; i < 12; i++) rainbowSheets[i] = sheetOf({ hue: i * 30, sat: 1.6, bri: 1.15, tint: '#ffffff' });
  hitSheet = sheetOf({ tint: '#ff3050' }, true);
  rivalSheet = sheetOf(RIVAL_SK);
}
// desenha o tubarão em camadas: cauda (5 quadros de balanço) + cabeça (5 quadros de boca) — independentes
function sharkLayers(g, sheet, headF, tailF) {
  g.drawImage(sheet.tail, tailF * 32, 0, 32, 32, -16, -16, 32, 32);
  g.drawImage(sheet.head, headF * 32, 0, 32, 32, -16, -16, 32, 32);
}
const TAIL_SEQ = [0, 1, 2, 3, 4, 3, 2, 1];

/* brilhos pré-renderizados (bolinha de luz colorida) */
const glowSpr = {};
function glowSprite(rgb) {
  if (glowSpr[rgb]) return glowSpr[rgb];
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(' + rgb + ',1)'); gr.addColorStop(0.35, 'rgba(' + rgb + ',0.45)'); gr.addColorStop(1, 'rgba(' + rgb + ',0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return (glowSpr[rgb] = c);
}
function glowDot(g, x, y, r, rgb, a) {
  g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = clamp(a, 0, 1); g.imageSmoothingEnabled = true;
  g.drawImage(glowSprite(rgb), x - r, y - r, r * 2, r * 2); g.restore();
}
/* corpo do tubarão + efeito da skin (g já com translate/rotate/scale aplicados) */
const BIO_DOTS = [[-9, 1], [-4, 3], [1, 2], [6, 1], [-13, 0]];
const STAR_DOTS = [[-10, -1], [-5, 2], [0, -3], [5, 1], [9, -1], [-13, 1], [2, 3]];
function sharkBodyFx(g, sk, sheet, headF, tailF, tt) {
  g.save();
  if (sk && sk.fx === 'ghost') g.globalAlpha *= 0.6 + Math.sin(tt * 5) * 0.1;
  sharkLayers(g, sheet, headF, tailF);
  g.restore();
  if (!sk || !sk.fx) return;
  const p = 0.5 + 0.5 * Math.sin(tt * 4);
  g.save(); g.globalCompositeOperation = 'lighter';
  g.globalAlpha *= sk.fx === 'magma' ? 0.16 + 0.16 * Math.abs(Math.sin(tt * 7)) : 0.1 + 0.12 * p;
  sharkLayers(g, sheet, headF, tailF);
  g.restore();
  if (sk.fx === 'bio') BIO_DOTS.forEach((d, i) => glowDot(g, d[0], d[1], 3.4, sk.rgb, 0.45 + 0.5 * Math.sin(tt * 3 + i * 1.7)));
  else if (sk.fx === 'magma') BIO_DOTS.forEach((d, i) => glowDot(g, d[0], d[1] + 1, 2.8, sk.rgb, 0.4 + 0.5 * Math.sin(tt * 5 + i * 2.1)));
  else if (sk.fx === 'galaxy') STAR_DOTS.forEach((d, i) => {
    const a = 0.35 + 0.65 * Math.max(0, Math.sin(tt * 3.4 + i * 2.3));
    g.fillStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')'; g.fillRect(d[0], d[1], 1, 1);
    if (a > 0.85) glowDot(g, d[0] + 0.5, d[1] + 0.5, 3.2, sk.rgb, 0.8);
  });
  else if (sk.fx === 'volt') {
    const seed = Math.floor(tt * 11);
    g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = 'rgba(255,250,170,0.95)'; g.lineWidth = 0.7; g.beginPath();
    let x = -12, y = ((seed * 7) % 5) - 2; g.moveTo(x, y);
    for (let i = 0; i < 6; i++) { x += 4; y = (((seed * (i + 3) * 13) % 7) - 3) * 0.8; g.lineTo(x, y); }
    g.stroke(); g.restore();
  }
}
let fxAcc = 0;
// partículas que a skin solta enquanto nada (rastro)
function skinFx(dt) {
  const sk = SKINS[curSkinIdx()]; if (!sk.fx) return;
  const s = shark, m = s.m, tx = s.x - s.face * 12 * m, ty = s.y + rand(-3, 3) * m, spd = Math.hypot(s.vx, s.vy);
  fxAcc += dt * (sk.fx === 'volt' || sk.fx === 'magma' ? 24 : 16) * (0.4 + Math.min(1, spd / 70));
  while (fxAcc >= 1) {
    fxAcc -= 1;
    switch (sk.fx) {
      case 'ghost': parts.push({ k: 'glow', x: tx, y: ty, vx: rand(-4, 4), vy: rand(-12, -4), life: 0.9, max: 0.9, rad: rand(3, 6), rgb: sk.rgb }); break;
      case 'bio': parts.push({ k: 'glow', x: s.x + rand(-10, 10) * m, y: s.y + rand(-5, 5) * m, vx: rand(-5, 5), vy: rand(-9, 3), life: 1.2, max: 1.2, rad: rand(2, 4), rgb: sk.rgb }); break;
      case 'magma': parts.push({ k: 'sq', x: tx + rand(-3, 3), y: ty, vx: rand(-8, 8), vy: rand(-26, -10), life: rand(0.5, 1), max: 1, c: pick(['#ff8a2a', '#ffd23a', '#ff4a1a']), s: pick([1, 2]), g: -14 }); break;
      case 'volt': parts.push({ k: 'sq', x: s.x + rand(-12, 12) * m, y: s.y + rand(-6, 6) * m, vx: rand(-30, 30), vy: rand(-30, 30), life: rand(0.15, 0.35), max: 0.35, c: pick(['#fff7a0', '#ffffff', '#ffe84a']), s: 1 }); break;
      case 'rainbow': parts.push({ k: 'sq', x: tx, y: ty, vx: rand(-6, 6) - s.face * 6, vy: rand(-6, 6), life: 0.8, max: 0.8, c: 'hsl(' + Math.floor(rand(0, 360)) + ',95%,62%)', s: 2 }); break;
      case 'galaxy': parts.push({ k: 'star', x: tx + rand(-4, 4), y: ty + rand(-5, 5), vx: -s.face * rand(2, 10), vy: rand(-4, 4), life: rand(0.7, 1.4), max: 1.4, c: pick(['#ffffff', '#c9b0ff', '#8ad0ff']) }); break;
    }
  }
}
function applyTitleSkin() {
  const sk = SKINS[curSkinIdx()];
  $('titleShark').style.filter = sk.id === 'classic' ? 'none' : 'hue-rotate(' + sk.hue + 'deg) saturate(' + sk.sat + ') brightness(' + sk.bri + ')';
}
let skinAnimT = 0;
function drawSkinCards() {
  if ($('skins').classList.contains('hidden') || !skinCards.length) return;
  const f = Math.floor(skinAnimT * 7) % 8, h = Math.floor(skinAnimT * 0.8) % 3 === 2 ? Math.round(Math.sin((skinAnimT * 0.8 % 1) * Math.PI * 3) * 3 + 1) : 0;
  skinCards.forEach((c, i) => {
    const sk = SKINS[i], g = c.getContext('2d');
    g.clearRect(0, 0, 48, 48); g.save(); g.translate(24, 24);
    if (sk.glow) glowDot(g, 0, 0, 24, sk.rgb, 0.3 + 0.15 * Math.sin(skinAnimT * 3));
    const sheet = sk.fx === 'rainbow' ? rainbowSheets[Math.floor(skinAnimT * 2) % 12] : skinSheets[i];
    sharkBodyFx(g, sk, sheet, clamp(h, 0, 4), TAIL_SEQ[f], skinAnimT);
    if (sk.fx) for (let k = 0; k < 3; k++) { const a = skinAnimT * 1.7 + k * 2.1; glowDot(g, Math.cos(a) * 16, Math.sin(a * 1.3) * 11, 2.5, sk.rgb, 0.6); }
    g.restore();
  });
}

/* ---------- navegação, início e fim de jogo ---------- */
function goMenu() {
  state = 'menu'; mode = MODES.classic; $('hud').classList.add('hidden'); resetWorld(true); showScreen('menu'); refreshBest(); refreshSkins(); Meta.save(true);
}
function startGame(id) {
  mode = MODES[id] || (MODES[mode.id] ? mode : MODES.classic); P.lastMode = mode.id; Meta.touch();
  SFX.click(); startMusic();
  resetWorld(false); hideScreens(); $('hud').classList.remove('hidden');
  $('dashBtn').classList.toggle('hidden', !matchMedia('(pointer:coarse)').matches);
  $('hungerBox').classList.toggle('hidden', !mode.hunger);
  $('modeBox').classList.toggle('hidden', !(mode.time || mode.waves));
  state = 'playing'; Meta.add('games');
  if (mode.waves) startWave(1); else showBanner(mode.time ? 'CAÇADA! 5 MINUTOS!' : 'Coma e cresça!');
  updateHud(true);
}
function togglePause(forcePause) {
  if (state === 'playing') { state = 'paused'; showScreen('pause'); Meta.save(true); }
  else if (state === 'paused' && !forcePause) { state = 'playing'; hideScreens(); }
}
function showBanner(text) {
  const b = $('banner'); b.textContent = text; b.classList.remove('hidden'); b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
  clearTimeout(showBanner.h); showBanner.h = setTimeout(() => b.classList.add('hidden'), 2400);
}
function fmtTime(s) { s = Math.floor(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function huntRank(sc) { let r = HUNT_RANKS[0][1]; for (const x of HUNT_RANKS) if (sc >= x[0]) r = x[1]; return r; }
function showOver(reason) {
  state = 'over';
  const id = mode.id;
  const prev = id === 'classic' ? P.best.classic : id === 'hunt' ? P.best.hunt : P.best.surv;
  const best = Math.max(prev, score), rec = score > prev && score > 0;
  let title, sub, ek, ev;
  if (id === 'classic') {
    P.best.classic = best; title = level >= 6 ? 'Rei dos Mares!' : 'Fim de jogo';
    sub = level >= 6 ? 'Você chegou ao topo da cadeia alimentar!' : 'O mar é um lugar perigoso…'; ek = 'Chefes derrotados'; ev = R.bosses;
  } else if (id === 'hunt') {
    P.best.hunt = best; title = reason === 'time' ? 'Tempo esgotado!' : 'Fim de jogo';
    sub = 'Você virou: ' + huntRank(score); ek = 'Rank'; ev = huntRank(score);
  } else {
    const wn = wv ? wv.n : 1; P.best.surv = best; P.best.wave = Math.max(P.best.wave, wn);
    title = 'Caiu na onda ' + wn; sub = 'O mar não perdoa…'; ek = 'Onda alcançada'; ev = wn;
  }
  if (rec) sub += ' — NOVO RECORDE!';
  $('overTitle').textContent = title; $('overSub').textContent = sub;
  $('stScore').textContent = score; $('stBest').textContent = best; $('stLevel').textContent = level + ' — ' + LV_NAMES[level - 1];
  $('stEaten').textContent = stats.eaten; $('stCoins').textContent = stats.wallet; $('stTime').textContent = fmtTime(stats.time);
  $('stExtraK').textContent = ek; $('stExtraV').textContent = ev;
  $('hud').classList.add('hidden'); showScreen('over');
  Meta.touch(); Meta.check(R, curX()); Meta.save(true);
}
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => { SFX.click(); showScreen('menu'); refreshBest(); b.blur(); }));
const bind = (id, fn) => $(id).addEventListener('click', e => { ac(); startMusic(); SFX.click(); fn(); e.currentTarget.blur(); });
bind('btnPlay', () => { buildModes(); showScreen('modes'); });
bind('btnHow', () => showScreen('how')); bind('btnOpts', () => { refreshOpts(); showScreen('opts'); });
bind('btnCredits', () => showScreen('credits'));
bind('btnSkins', () => { refreshSkins(); $('skinMsg').textContent = 'Toque numa skin para usar ou comprar'; showScreen('skins'); });
bind('btnAch', () => { buildAchList(); showScreen('ach'); });
bind('btnAlbum', () => { buildAlbum(); showScreen('album'); });
bind('btnResume', () => togglePause());
bind('btnRestart', () => startGame(mode.id));
bind('btnQuit', goMenu);
bind('btnAgain', () => startGame(mode.id));
bind('btnMenu', goMenu);
$('pauseBtn').addEventListener('click', e => { togglePause(); e.currentTarget.blur(); });

/* ---------- HUD ---------- */
let hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function setW(id, p) { const v = Math.round(clamp(p, 0, 1) * 100); if (hudCache[id] !== v) { hudCache[id] = v; $(id).style.width = v + '%'; } }
function progress() {
  if (mode.waves && wv) return clamp(wv.boss ? (wv.bossSpawned ? 0.5 : 0) : wv.got / wv.quota, 0, 1);
  if (level >= 6) return 1;
  return (growth - thrOf(level - 1)) / (thrOf(level) - thrOf(level - 1));
}
function updateHud(force) {
  if (force) hudCache = {};
  setText('stageName', LV_NAMES[level - 1]); setText('stageNum', level + '/6'); setText('score', String(score));
  setW('sizeFill', progress()); setW('hpFill', shark.hp / MAX_HP); setW('staFill', shark.sta / 100);
  setText('hpText', String(Math.ceil(shark.hp)));
  setText('coinsN', String(stats.coins)); setText('eatenN', String(stats.eaten));
  $('hpFill').parentElement.classList.toggle('low', shark.hp < 30);
  if (mode.hunger) {
    setW('hunFill', hunger / 100); setText('hunText', hunger <= 0 ? 'FAMINTO!' : '');
    $('hunFill').parentElement.classList.toggle('low', hunger < 20);
  }
  if (mode.time) { setText('modeTxt', fmtTime(Math.ceil(huntLeft))); setText('modeSub', 'Caçada'); }
  else if (mode.waves && wv) {
    setText('modeTxt', 'ONDA ' + wv.n);
    setText('modeSub', wv.phase === 'break' ? 'Descanso...' : wv.boss ? 'CHEFE!' : wv.got + ' / ' + wv.quota + ' presas');
  }
  const eb = $('evtBadge');
  if (evt) {
    const txt = EVENTS[evt.type].tag + ' ' + Math.ceil(evt.dur - evt.t) + 's';
    if (hudCache.evt !== txt) { hudCache.evt = txt; eb.textContent = txt; }
    eb.className = evt.type;
  } else if (hudCache.evt !== '') { hudCache.evt = ''; eb.className = 'hidden'; }
  const bb = $('bossBar');
  if (boss && !boss.dead) { bb.classList.remove('hidden'); setText('bossName', boss.sp.name); setW('bossFill', boss.hp / boss.maxhp); }
  else bb.classList.add('hidden');
  const cb = $('combo');
  if (comboT > 0 && combo >= 2) {
    const txt = 'COMBO x' + combo + (mult() > 1 ? '  PONTOS x' + mult() : '');
    if (hudCache.combo !== txt) { hudCache.combo = txt; cb.textContent = txt; cb.classList.remove('hidden'); cb.style.animation = 'none'; void cb.offsetWidth; cb.style.animation = ''; }
  } else if (hudCache.combo !== '') { hudCache.combo = ''; cb.classList.add('hidden'); }
}
const mult = () => Math.min(5, 1 + Math.floor((combo - 1) / 3));
const chipEls = {};
function buildChips() {
  const box = $('chips'); box.innerHTML = '';
  CHIP_ORDER.forEach(k => {
    const sp = SP[k], d = document.createElement('div'); d.className = 'chip'; d.title = CHIP_NAMES[k];
    const c = document.createElement('canvas'); c.width = 28; c.height = 24; d.appendChild(c);
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    const im = IMG[sp.imgs[0]], sc = Math.min(28 / sp.fw, 24 / sp.fh) * (k === 'diver' ? 1 : 1);
    const draw = () => g.drawImage(im, 0, sp.rows[0] * sp.fh, sp.fw, sp.fh, (28 - sp.fw * sc) / 2, (24 - sp.fh * sc) / 2, sp.fw * sc, sp.fh * sc);
    if (im.complete) draw(); else im.onload = draw;
    box.appendChild(d); chipEls[k] = d;
  });
  refreshChips();
}
function refreshChips() { for (const k of CHIP_ORDER) chipEls[k].className = 'chip ' + (canEat(SP[k]) ? 'ok' : 'bad'); }
const canEat = sp => sp.level <= level;

/* ---------- partículas ---------- */
function burst(x, y, n, colors, spd = 40) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(spd * 0.4, spd);
    parts.push({ k: 'sq', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 10, life: rand(0.4, 0.8), max: 0.8, c: pick(colors), s: pick([1, 2, 2, 3]) });
  }
}
function bubbleAt(x, y, sc = 1) { parts.push({ k: 'bub', x, y, vx: rand(-6, 6), vy: rand(-26, -12), life: rand(0.8, 1.6), max: 1.6, sc, ph: rand(0, 6) }); }
function floatText(x, y, text, color) { parts.push({ k: 'txt', x, y, vx: 0, vy: -22, life: 1.1, max: 1.1, text, c: color }); }
function spawnCoins(x, y, n) {
  for (let i = 0; i < n; i++) coins.push({ x, y, vx: rand(-45, 45), vy: rand(-90, -35), big: i < 2 && n > 6 ? true : Math.random() < 0.15, t: rand(0, 3), life: 20 });
}

/* ---------- jogo: regras ---------- */
const isEdible = e => !e.raid && !e.boss && e.sp.level <= level;
function curX() {
  const hs = mode.id === 'hunt' && state !== 'menu' && state !== 'loading' ? Math.max(P.best.hunt, score | 0) : P.best.hunt;
  return { level: (state === 'menu' || state === 'loading') ? 0 : level, huntScore: hs, bestHunt: hs, waveBest: Math.max(P.best.wave, wv ? wv.n : 0), albumDone: Meta.albumDoneCount() };
}

function hurt(dmg, sx, sy, src) {
  if (shark.inv > 0 || shark.dead || state !== 'playing') return;
  if (src && src.boss) src.hurtShark = true;
  R.hurt++;
  shark.hp -= dmg; shark.inv = 1.1; shark.flash = 0.25; cam.shake = Math.max(cam.shake, 7); comboT = 0; combo = 0;
  const a = Math.atan2(shark.y - sy, shark.x - sx);
  shark.vx = Math.cos(a) * 130; shark.vy = Math.sin(a) * 130;
  burst(shark.x, shark.y, 10, ['#ff5c6c', '#fff', '#ffb0b8'], 55);
  SFX.hurt();
  if (shark.hp <= 0) die();
}
function die() {
  shark.hp = 0; shark.dead = true; state = 'dying'; deathT = 0; SFX.die();
  burst(shark.x, shark.y, 24, ['#ff5c6c', '#fff', '#8aa0ff'], 70);
}
// Caçada: nocaute custa 10% dos pontos e você volta
function huntRespawn() {
  const pen = Math.round(score * 0.1); score = Math.max(0, score - pen);
  shark.dead = false; shark.hp = 70; shark.inv = 3; shark.rot = 0; shark.vx = 0; shark.vy = 0; shark.sta = 100;
  shark.y = clamp(shark.y, SURF + 70, floorTop(shark.x) - 40); combo = 0; comboT = 0; state = 'playing';
  showBanner('NOCAUTE! -' + pen + ' PONTOS'); SFX.wave();
}
function eat(e) {
  const sp = e.sp; e.dead = true; shark.bite = 0.4;
  combo = comboT > 0 ? combo + 1 : 1; comboT = 2.6;
  const m = mult(), pts = Math.round(sp.score * m); score += pts; stats.eaten++; R.maxMult = Math.max(R.maxMult, m);
  growth += sp.growth * growthFactor(level, sp.level);
  shark.hp = Math.min(MAX_HP, shark.hp + 2 + sp.growth * 0.4);
  if (mode.hunger) { hunger = Math.min(100, hunger + (sp.hunger || 6 + sp.growth * 1.2)); if (R.starved && hunger > 40) R.starveOk = true; }
  const mx = shark.x + shark.face * 10 * shark.m, my = shark.y + 2 * shark.m;
  const gold = sp.ai === 'gold';
  burst(e.x, e.y, 7 + Math.min(10, sp.growth / 3 | 0), gold ? ['#ffd23a', '#fff7a0', '#ffffff'] : ['#ff8a6a', '#ffd27a', '#fff', '#ff5c6c'], 50);
  for (let i = 0; i < 3; i++) bubbleAt(mx + rand(-4, 4), my + rand(-4, 4), rand(0.7, 1.2));
  floatText(e.x, e.y - 6, '+' + pts + (m > 1 ? ' x' + m : ''), gold || m > 1 ? '#ffd27a' : '#ffffff');
  if (e.group) e.group.n--;
  if (gold) { R.gold++; SFX.gold(); }
  if (wv && wv.phase === 'fight') wv.got++;
  const aid = ALBUM_BY[e.imgKey] ? e.imgKey : e.key;
  const pg = Meta.eat(aid);
  if (pg) floatText(shark.x, shark.y - 16 * shark.m, 'ÁLBUM +' + pg.rw, '#5df2a0');
  SFX.eat(sp.growth);
  checkLevel();
}
function levelFromGrowth() { let L = 1; for (let i = 0; i < LV_THRESH.length; i++) if (growth >= thrOf(i)) L = i + 1; return L; }
function checkLevel() {
  const L = mode.waves ? level : levelFromGrowth();
  if (L > level) {
    level = L; shark.hp = Math.min(MAX_HP, shark.hp + 30); shark.sta = 100;
    if (level === 6) { score += 1000; showBanner('REI DOS MARES!'); } else showBanner('TAMANHO ' + level + ' - ' + LV_NAMES[level - 1].toUpperCase() + '!');
    SFX.level(); refreshChips(); cam.shake = Math.max(cam.shake, 5);
    for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; parts.push({ k: 'sq', x: shark.x, y: shark.y, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70, life: 0.7, max: 0.7, c: '#ffd27a', s: 2 }); }
    if (mode.bosses) {  // chefes leves em certos estágios do Clássico
      if (level >= 3 && !R.b1) { R.b1 = true; bossQ.push({ key: 'bsword', t: 5, hpMul: 1 }); }
      if (level >= 5 && !R.b2) { R.b2 = true; bossQ.push({ key: 'bsaw', t: 5, hpMul: 1 }); }
    }
    Meta.check(R, curX());
  }
  shark.mT = lerp(LV_M[level - 1], LV_M[Math.min(5, level)], clamp(progress(), 0, 1));
  if (level >= 6 && !mode.waves) shark.mT = LV_M[5];
}

/* ---------- eventos aleatórios (a cada 1-2 min) ---------- */
const EVENTS = {
  gold: { name: 'CARDUME DOURADO!', tag: 'Cardume dourado', dur: 30 },
  storm: { name: 'TEMPESTADE!', tag: 'Tempestade', dur: 36 },
  treasure: { name: 'CHUVA DE MOEDAS!', tag: 'Chuva de moedas', dur: 16 }
};
function startEvent(type) {
  if (!type) { const opts = Object.keys(EVENTS).filter(k => k !== R.lastEvt); type = pick(opts); }
  evt = { type, t: 0, dur: EVENTS[type].dur, cd: 0 }; R.lastEvt = type;
  showBanner(EVENTS[type].name); SFX.warn();
  if (type === 'gold') spawnGoldSchool();
  else if (type === 'storm') { storm.on = true; storm.nextFlash = rand(1.5, 3); }
}
function spawnGoldSchool() {
  R.gold = 0;
  const sx = shark.x + (Math.random() < 0.5 ? -1 : 1) * rand(170, 320);
  const cx = clamp(sx, 150, W - 150), cy = clamp(shark.y + rand(-50, 90), SURF + 70, floorTop(cx) - 60);
  const g = { key: 'gold', dh: Math.random() < 0.5 ? 1 : -1, wy: 0, wt: rand(2, 4), cx, cy, n: 0 };
  groups.push(g);
  for (let i = 0; i < 26; i++) {
    const e = newEnt('gold', cx + rand(-50, 50), clamp(cy + rand(-34, 34), SURF + 24, floorTop(cx) - 24), g);
    e.ttl = EVENTS.gold.dur + 2; ents.push(e); g.n++;
  }
}
function updateEvent(dt) {
  evt.t += dt;
  if (evt.type === 'treasure') {
    evt.cd -= dt;
    if (evt.cd <= 0) { evt.cd = 0.26; const x = clamp(shark.x + rand(-240, 240), 24, W - 24); coins.push({ x, y: SURF + 3, vx: rand(-6, 6), vy: 18, big: Math.random() < 0.18, t: rand(0, 3), life: 26 }); }
  }
  if (evt.t >= evt.dur) endEvent();
}
function endEvent() {
  if (evt.type === 'storm') { storm.on = false; if (!shark.dead) { Meta.add('storms'); Meta.check(R, curX()); } }
  if (evt.type === 'gold') for (const e of ents) if (e.sp.ai === 'gold') e.ttl = Math.min(e.ttl, 0.4 + Math.random());
  evt = null; evT = rand(mode.ev[2], mode.ev[3]);
}

/* ---------- chefes (peixe-espada / tubarão-serra gigantes) ---------- */
function spawnBoss(key, hpMul) {
  const sp = SP[key], x = shark.x < W / 2 ? W - 150 : 150;
  const e = newEnt(key, x, clamp(rand(180, 380), SURF + 70, floorTop(x) - 70), null);
  e.boss = true; e.sc = sp.sc; e.r = sp.r * e.sc; e.hp = e.maxhp = Math.round(sp.hp * (hpMul || 1));
  e.st = 'stalk'; e.cd = 2.2; e.hitCd = 0; e.chain = 0; e.hurtShark = false; e.aim = 0; e.cvx = 0; e.cvy = 0;
  ents.push(e); boss = e;
  showBanner('CUIDADO: ' + sp.name.toUpperCase() + '!'); SFX.warn(); cam.shake = Math.max(cam.shake, 8);
}
function bossAI(e, dt) {
  const saw = e.key === 'bsaw', enr = e.hp <= e.maxhp / 2, sp = e.sp;
  e.cd -= dt; e.hitCd = Math.max(0, e.hitCd - dt);
  const ax = shark.x - e.x, ay = shark.y - e.y, d = Math.hypot(ax, ay) || 1, live = state === 'playing' && !shark.dead;
  switch (e.st) {
    case 'stalk':
      if (d > 160) steer(e, ax, ay, sp.speed * (enr ? 1.25 : 1), dt, 2);
      else if (d < 100) steer(e, -ax, -ay, sp.speed * 0.8, dt, 2);
      else steer(e, -ay * e.dh, ax * e.dh, sp.speed * 0.6, dt, 2);
      e.face = ax >= 0 ? 1 : -1;
      if (Math.random() < dt * 0.15) e.dh *= -1;
      if (e.cd <= 0 && live && d < 340) { e.st = 'windup'; e.stT = saw ? (enr ? 0.45 : 0.62) : (enr ? 0.7 : 0.95); e.chain = saw ? (enr ? 4 : 3) : (enr ? 2 : 1); SFX.charge(); }
      break;
    case 'windup':
      e.stT -= dt; e.vx *= 0.88; e.vy *= 0.88; e.aim = Math.atan2(ay, ax); e.face = ax >= 0 ? 1 : -1;
      if (e.stT <= 0) {
        e.st = 'charge'; e.stT = saw ? 0.55 : 0.85; const v = (saw ? 255 : 245) * (enr ? 1.1 : 1);
        e.cvx = Math.cos(e.aim) * v; e.cvy = Math.sin(e.aim) * v; SFX.dash();
      }
      break;
    case 'charge': {
      e.stT -= dt; e.vx = e.cvx; e.vy = e.cvy; e.face = e.cvx >= 0 ? 1 : -1;
      const wall = e.y < SURF + 16 || e.y > floorTop(e.x) - 18 || e.x < 36 || e.x > W - 36;
      if (e.stT <= 0 || wall) {
        e.chain--;
        if (wall) { cam.shake = Math.max(cam.shake, 6); burst(e.x, e.y, 10, ['#fff', '#cfe8ff', '#8aa0ff'], 60); }
        if (e.chain > 0 && !wall) { e.st = 'windup'; e.stT = saw ? 0.35 : 0.5; }
        else { e.st = 'tired'; e.stT = wall ? 3.4 : 2.7; e.vx *= 0.2; e.vy *= 0.2; }
      }
      break;
    }
    case 'tired':
      e.stT -= dt; e.vx *= 0.94; e.vy = lerp(e.vy, 8, dt * 2);
      if (e.stT <= 0) { e.st = 'stalk'; e.cd = rand(1.0, 1.8) * (enr ? 0.7 : 1); }
      break;
  }
}
function bossHit(e) {
  const dmg = shark.dash ? 2 : 1;
  e.hp -= dmg; e.hitCd = 0.5; e.flash = 0.3; shark.bite = 0.4; cam.shake = Math.max(cam.shake, 8);
  const a = Math.atan2(e.y - shark.y, e.x - shark.x); e.vx = Math.cos(a) * 90; e.vy = Math.sin(a) * 90;
  burst(e.x, e.y, 14, ['#ff5c6c', '#fff', '#ffd27a'], 70); floatText(e.x, e.y - e.r - 6, '-' + dmg, '#ff8a8a'); SFX.bossHit();
  if (e.hp <= 0) bossDie(e);
}
function bossDie(e) {
  e.dead = true; boss = null; R.bosses++;
  const sw = e.key === 'bsword';
  score += sw ? 1500 : 2500; if (!mode.waves) growth += 25;
  shark.hp = Math.min(MAX_HP, shark.hp + 40);
  if (mode.hunger) hunger = 100;
  spawnCoins(e.x, e.y, 16); burst(e.x, e.y, 44, ['#ff5c6c', '#fff', '#ffd27a', '#c070ff'], 120); cam.shake = 14;
  Meta.add(sw ? 'boss1' : 'boss2');
  if (!e.hurtShark) R.hitless = true;
  const pg = Meta.album(e.key); if (pg) floatText(e.x, e.y - 20, 'ÁLBUM +' + pg.rw, '#5df2a0');
  floatText(e.x, e.y - e.r - 14, '+' + (sw ? 1500 : 2500), '#ffd27a');
  showBanner('CHEFE DERROTADO!'); SFX.level();
  checkLevel(); Meta.check(R, curX());
}

/* ---------- tubarão rival (IA que disputa os peixes) ---------- */
function rivalLevelOf(g) { let L = 1; for (let i = 0; i < LV_THRESH.length; i++) if (g >= thrOf(i)) L = i + 1; return L; }
function spawnRival() {
  const side = shark.x < W / 2 ? 1 : -1, g = Math.max(8, growth * 0.75), L = rivalLevelOf(g);
  rival = { x: side > 0 ? W - 170 : 170, y: rand(150, 380), vx: 0, vy: 0, face: -side, m: LV_M[L - 1], mT: LV_M[L - 1], growth: g, level: L,
    hp: 40 + 10 * L, maxhp: 40 + 10 * L, sta: 100, t: 0, flash: 0, inv: 1.5, bite: 0, dash: false, rot: 0, dead: false, cd: 0, hitCd: 0, eatCd: 0, tgt: null, tgtT: 0 };
  showBanner('UM RIVAL APARECEU!'); SFX.warn();
}
function updateRival(dt) {
  const r = rival;
  r.t += dt; r.inv = Math.max(0, r.inv - dt); r.bite = Math.max(0, r.bite - dt); r.flash = Math.max(0, r.flash - dt);
  r.cd = Math.max(0, r.cd - dt); r.hitCd = Math.max(0, r.hitCd - dt); r.eatCd = Math.max(0, r.eatCd - dt);
  const L = rivalLevelOf(r.growth);
  if (L > r.level) { r.level = L; r.maxhp += 10; r.hp = Math.min(r.maxhp, r.hp + 25); burst(r.x, r.y, 14, ['#ffd27a', '#fff'], 50); }
  const lo = thrOf(r.level - 1), hi = r.level < 6 ? thrOf(r.level) : lo + 1, pr = r.level < 6 ? clamp((r.growth - lo) / (hi - lo), 0, 1) : 1;
  r.mT = lerp(LV_M[r.level - 1], LV_M[Math.min(5, r.level)], pr); r.m += (r.mT - r.m) * Math.min(1, dt * 3);
  // escolhe a presa mais vantajosa por perto
  r.tgtT -= dt;
  if (r.tgtT <= 0 || !r.tgt || r.tgt.dead) {
    r.tgtT = 0.35; let best = null, bs = 1e9;
    for (const e of ents) {
      if (e.dead || e.boss || e.raid || e.sp.level > r.level) continue;
      let sc = Math.hypot(e.x - r.x, e.y - r.y) - e.sp.growth * 1.2; if (e.sp.ai === 'gold') sc -= 60;
      if (sc < bs) { bs = sc; best = e; }
    }
    r.tgt = best;
  }
  let ax = 0, ay = 0, dash = false;
  if (r.tgt) {
    const dx = r.tgt.x - r.x, dy = r.tgt.y - r.y, d = Math.hypot(dx, dy) || 1; ax = dx / d; ay = dy / d; dash = d < 120 && r.sta > 20;
  } else { ax = Math.sin(r.t * 0.3) * 0.6; ay = Math.cos(r.t * 0.4) * 0.3; }
  for (const e of ents) { // foge de quem pode machucar
    if (e.dead || !(e.sp.harm || e.boss) || (!e.boss && e.sp.level <= r.level && !e.raid)) continue;
    const dx = r.x - e.x, dy = r.y - e.y, d = Math.hypot(dx, dy) || 1;
    if (d < 80 + e.r) { ax += dx / d * 1.6; ay += dy / d * 1.6; dash = false; }
  }
  const l = Math.hypot(ax, ay) || 1; if (l > 1) { ax /= l; ay /= l; }
  if (dash) { r.sta -= 38 * dt; if (r.sta <= 0) { r.sta = 0; r.exhausted = true; } }
  else { r.sta = Math.min(100, r.sta + 20 * dt); if (r.sta > 40) r.exhausted = false; }
  r.dash = dash && !r.exhausted;
  const maxSp = (68 + r.level * 4.5) * (r.dash ? 1.7 : 1), k = Math.min(1, dt * 3.2);
  r.vx += (ax * maxSp - r.vx) * k; r.vy += (ay * maxSp - r.vy) * k;
  r.x += (r.vx + storm.push * 0.8) * dt; r.y += r.vy * dt;
  const mm = r.m;
  r.x = clamp(r.x, 16 * mm, W - 16 * mm); r.y = clamp(r.y, SURF + 7 * mm, floorTop(r.x) - 10 * mm);
  if (r.vx > 8) r.face = 1; else if (r.vx < -8) r.face = -1;
  r.rot += (clamp(Math.atan2(r.vy, Math.abs(r.vx) + 20) * 0.7, -0.5, 0.5) - r.rot) * Math.min(1, dt * 8);
  if (Math.hypot(r.vx, r.vy) > 30 && Math.random() < dt * 2) bubbleAt(r.x + r.face * 12 * mm, r.y - 3 * mm, 0.7);
  // abocanha presas (e rouba as suas!)
  if (r.eatCd <= 0) {
    const mx = r.x + r.face * 10 * mm, my = r.y + 2 * mm;
    for (const e of ents) {
      if (e.dead || e.boss || e.raid || e.sp.level > r.level) continue;
      if (Math.hypot(e.x - mx, e.y - my) < 8.5 * mm + e.r * 0.9) {
        e.dead = true; if (e.group) e.group.n--; r.bite = 0.4; r.eatCd = 0.4; r.tgt = null;
        r.growth += e.sp.growth * growthFactor(r.level, e.sp.level) * 0.9; r.hp = Math.min(r.maxhp, r.hp + 3);
        burst(e.x, e.y, 5, ['#ff8a6a', '#fff'], 35); bubbleAt(mx, my, 1); R.stolen = (R.stolen | 0) + 1;
        break;
      }
    }
  }
}
function rivalHit(dmg) {
  const rv = rival, a = Math.atan2(rv.y - shark.y, rv.x - shark.x);
  rv.hp -= dmg; rv.hitCd = 0.6; rv.flash = 0.25; rv.vx = Math.cos(a) * 130; rv.vy = Math.sin(a) * 130; shark.bite = 0.4;
  burst(rv.x, rv.y, 10, ['#ff5c6c', '#fff', '#ffb0b8'], 55); SFX.bossHit(); cam.shake = Math.max(cam.shake, 4);
  floatText(rv.x, rv.y - 14 * rv.m, '-' + dmg, '#ff8a8a');
  if (rv.hp <= 0) {
    score += 300; spawnCoins(rv.x, rv.y, 8); burst(rv.x, rv.y, 30, ['#ff5c6c', '#fff', '#ffd27a'], 90); cam.shake = 9;
    floatText(rv.x, rv.y - 20, '+300', '#ffd27a'); showBanner('RIVAL DERROTADO!'); SFX.level();
    Meta.add('rivals'); rival = null; rivalT = 25; Meta.check(R, curX());
  }
}

/* ---------- ondas (Sobrevivência) ---------- */
const survLevel = n => Math.min(6, 1 + Math.floor(n / 2));
function startWave(n) {
  const isBoss = n % 5 === 0;
  wv = { n, boss: isBoss, quota: 8 + 3 * n, got: 0, phase: 'fight', breakT: 0, raidT: 2.5, bossSpawned: false };
  if (n === 1) { level = 1; shark.mT = LV_M[0]; refreshChips(); }
  else if (survLevel(n) > level) checkLevelTo(survLevel(n));
  showBanner(isBoss ? 'ONDA ' + n + ' - CHEFE!' : 'ONDA ' + n); SFX.wave();
  if (isBoss) bossQ.push({ key: Math.floor(n / 5) % 2 === 1 ? 'bsword' : 'bsaw', t: 3, hpMul: 1 + 0.4 * Math.floor((n - 1) / 10) });
  Meta.check(R, curX()); updateHud(true);
}
function checkLevelTo(L) { // sobe de tamanho na Sobrevivência (nível amarrado à onda)
  if (L <= level) return;
  level = L; shark.hp = Math.min(MAX_HP, shark.hp + 30); shark.sta = 100; shark.mT = LV_M[level - 1];
  SFX.level(); refreshChips(); cam.shake = Math.max(cam.shake, 5);
}
function spawnRaider() {
  let pool = ['angler', 'diver', 'sword', 'saw', 'jelly'].filter(k => SP[k].level > level), big = false;
  if (!pool.length) { pool = ['sword', 'saw', 'angler']; big = true; }
  const key = pick(pool), p = spawnPos(key, viewMinDist() + 30); if (!p) return;
  const e = newEnt(key, p.x, p.y, null); e.raid = true;
  if (big) { e.sc *= 1.3; e.r = SP[key].r * e.sc; }
  ents.push(e);
}
function updateWave(dt) {
  if (wv.phase === 'fight') {
    wv.raidT -= dt;
    let nr = 0; for (const e of ents) if (e.raid && !e.dead) nr++;
    const cap = Math.min(8, 1 + Math.floor(wv.n * 0.8));
    if (wv.raidT <= 0 && nr < cap) { spawnRaider(); wv.raidT = Math.max(2.2, 7 - wv.n * 0.4); }
    if (boss) wv.bossSpawned = true;
    if (wv.boss ? (wv.bossSpawned && !boss && !bossQ.length) : wv.got >= wv.quota) endWave();
  } else {
    wv.breakT -= dt; if (wv.breakT <= 0) startWave(wv.n + 1);
  }
}
function endWave() {
  wv.phase = 'break'; wv.breakT = 4.5;
  const bonus = 150 * wv.n; score += bonus; shark.hp = Math.min(MAX_HP, shark.hp + 40); hunger = Math.min(100, hunger + 40);
  for (const e of ents) if (e.raid) { e.dead = true; burst(e.x, e.y, 6, ['#fff', '#8aa0ff'], 40); }
  P.best.wave = Math.max(P.best.wave, wv.n);
  showBanner('ONDA ' + wv.n + ' COMPLETA! +' + bonus); SFX.level(); Meta.touch(); Meta.check(R, curX());
}

/* ---------- diretor: fome, tempo, chefes, eventos, rival, ondas ---------- */
function updateDirector(dt) {
  if (mode.hunger) {
    hunger = Math.max(0, hunger - (1.3 + 0.14 * level) * mode.hunger * dt);
    if (hunger <= 0) { R.starved = true; shark.hp -= 1.6 * dt; if (shark.hp <= 0) { shark.hp = 0; die(); return; } }
  }
  if (bossQ.length && !boss) { bossQ[0].t -= dt; if (bossQ[0].t <= 0) { const q = bossQ.shift(); spawnBoss(q.key, q.hpMul); } }
  if (evt) updateEvent(dt);
  else if (mode.ev && !boss && !bossQ.length && !(wv && wv.phase === 'break')) { evT -= dt; if (evT <= 0) startEvent(); }
  if (mode.rival !== undefined) {
    if (!rival) { rivalT -= dt; if (stats.time >= mode.rival && rivalT <= 0) spawnRival(); } else updateRival(dt);
  }
  if (wv) updateWave(dt);
}

/* ---------- IA das espécies ---------- */
function steer(e, dx, dy, speed, dt, k = 3) {
  const l = Math.hypot(dx, dy) || 1, f = Math.min(1, dt * k);
  e.vx += (dx / l * speed - e.vx) * f; e.vy += (dy / l * speed - e.vy) * f;
}
function avoid(e, o) {
  if (e.x < 70) o.x += 1.5; else if (e.x > W - 70) o.x -= 1.5;
  if (e.y < SURF + 24) o.y += 1.5;
  const f = floorTop(e.x) - 20; if (e.y > f) o.y -= 1.5;
}
function wander(e, dt, speed) {
  const g = e.group;
  if (g) { e.dh = g.dh; e.wy = g.wy; }
  else { e.wt -= dt; if (e.wt <= 0) { e.wt = rand(2, 5); if (Math.random() < 0.25) e.dh *= -1; e.wy = rand(-0.5, 0.5); } }
  const o = { x: e.dh, y: e.wy };
  if (e.x < 90) e.dh = 1; if (e.x > W - 90) e.dh = -1;
  if (g) { const dx = g.cx - e.x, dy = g.cy - e.y, d = Math.hypot(dx, dy); if (d > 36) { o.x += dx / d * 0.7; o.y += dy / d * 0.7; } }
  avoid(e, o);
  steer(e, o.x, o.y, speed, dt, 2);
}
function fleeFrom(e, dt, speed) {
  const dx = e.x - shark.x, dy = e.y - shark.y, o = { x: dx, y: dy };
  const l = Math.hypot(dx, dy) || 1; o.x = dx / l * 2; o.y = dy / l * 2; avoid(e, o);
  steer(e, o.x, o.y, speed, dt, 4);
}
function updateEnt(e, dt) {
  const sp = e.sp, d = dist(e, shark), edible = isEdible(e), near = state === 'playing' || state === 'menu';
  e.t += dt; e.bite = Math.max(0, e.bite - dt); e.flash = Math.max(0, e.flash - dt);
  switch (sp.ai) {
    case 'gold':
      e.ttl -= dt;
      if (e.ttl <= 0) { e.dead = true; if (e.group) e.group.n--; bubbleAt(e.x, e.y, 0.8); break; }
      if (near && d < 70) fleeFrom(e, dt, sp.speed * 1.7); else wander(e, dt, sp.speed * (0.9 + Math.sin(e.t * 0.7) * 0.2));
      break;
    case 'bsword': case 'bsaw': bossAI(e, dt); break;
    case 'prey':
      if (edible && near && d < 55 + level * 9) fleeFrom(e, dt, sp.speed * 2.1); else wander(e, dt, sp.speed * (0.8 + Math.sin(e.t * 0.7) * 0.2));
      break;
    case 'squid': {
      const pulse = Math.max(0, Math.sin(e.t * 3.2)), flee = edible && near && d < 60 + level * 9;
      if (flee) fleeFrom(e, dt, sp.speed * (1 + pulse * 2.6)); else wander(e, dt, sp.speed * (0.4 + pulse * 1.3));
      break;
    }
    case 'jelly': {
      const pulse = Math.max(0, Math.sin(e.t * 2)); const o = { x: Math.sin(e.t * 0.3 + e.sc * 9) * 0.6, y: -0.2 + Math.sin(e.t * 0.9) * 0.8 };
      avoid(e, o); steer(e, o.x, o.y, sp.speed * (0.4 + pulse), dt, 1.5);
      break;
    }
    case 'angler': {
      if (edible && near && d < 130) fleeFrom(e, dt, sp.speed * 1.5);
      else if (!edible && near && d < 100) { steer(e, shark.x - e.x, shark.y - e.y, sp.speed * (1 + Math.max(0, Math.sin(e.t * 4)) * 0.8), dt, 2.5); }
      else { const o = { x: Math.sin(e.t * 0.25 + e.sc * 7) * 0.4, y: Math.sin(e.t * 0.7) * 0.5 }; avoid(e, o); steer(e, o.x, o.y, 12, dt, 1.5); }
      break;
    }
    case 'sword': {
      e.cd -= dt;
      if (edible && near && d < 150) { e.st = 'idle'; fleeFrom(e, dt, sp.speed * 2); break; }
      if (e.st === 'windup') {
        e.stT -= dt; e.vx *= 0.9; e.vy *= 0.9;
        const a = Math.atan2(shark.y - e.y, shark.x - e.x); e.aim = a; e.face = Math.cos(a) >= 0 ? 1 : -1;
        if (e.stT <= 0) { e.st = 'charge'; e.stT = 1.0; e.cvx = Math.cos(e.aim) * 175; e.cvy = Math.sin(e.aim) * 175; }
      } else if (e.st === 'charge') {
        e.stT -= dt; e.vx = e.cvx; e.vy = e.cvy;
        if (e.stT <= 0 || e.y < SURF + 12 || e.y > floorTop(e.x) - 14 || e.x < 40 || e.x > W - 40) { e.st = 'idle'; e.cd = rand(2.5, 4); }
      } else {
        wander(e, dt, sp.speed);
        if (!edible && near && d < 160 && e.cd <= 0) { e.st = 'windup'; e.stT = 0.65; SFX.charge(); }
      }
      break;
    }
    case 'saw': {
      e.cd -= dt;
      if (edible && near && d < 170) { fleeFrom(e, dt, sp.speed * 2); break; }
      if (!edible && near && d < 210) {
        const burstOn = e.cd < 0 && e.cd > -0.7; if (e.cd < -0.7) e.cd = rand(2.2, 3.4);
        steer(e, shark.x - e.x, shark.y - e.y, sp.speed * (burstOn ? 3.4 : 1.6), dt, burstOn ? 4 : 2);
      } else wander(e, dt, sp.speed * 0.8);
      break;
    }
    case 'diver': {
      e.cd -= dt;
      if (edible && near && d < 110) { fleeFrom(e, dt, 42); e.aimT = 0; }
      else {
        const o = { x: e.dh * 0.8, y: Math.sin(e.t * 0.8) * 0.5 }; if (Math.random() < 0.002) e.dh *= -1; avoid(e, o);
        if (e.y > 330) o.y -= 1; steer(e, o.x, o.y, (e.aimT > 0 ? 3 : sp.speed), dt, 2);
        if (near && d < 200 && state === 'playing' && !shark.dead) {
          e.face = shark.x >= e.x ? 1 : -1;
          if (e.aimT > 0) { e.aimT -= dt; if (e.aimT <= 0) fireHarpoon(e); }
          else if (e.cd <= 0) { e.aimT = 0.55; }
        } else e.aimT = 0;
      }
      break;
    }
  }
  e.x += e.vx * dt; e.y += e.vy * dt;
  if (storm.k > 0 && !sp.boss) e.x += storm.push * 0.5 * dt;
  if (!((e.sp.ai === 'sword' || e.sp.boss) && e.st === 'charge')) {
    if (Math.abs(e.vx) > 4) e.face = e.vx > 0 ? 1 : -1;
  } else e.face = e.cvx >= 0 ? 1 : -1;
  e.x = clamp(e.x, 20, W - 20);
  const lim = key => floorTop(e.x) - (key === 'shrimp' ? 6 : 12);
  if (e.y > lim(e.key)) { e.y = lim(e.key); e.vy = Math.min(0, e.vy); }
  if (e.y < SURF + 12) { e.y = SURF + 12; e.vy = Math.max(0, e.vy); }
}
function fireHarpoon(d) {
  const lead = 0.25, tx = shark.x + shark.vx * lead, ty = shark.y + shark.vy * lead;
  const a = Math.atan2(ty - d.y, tx - d.x);
  harpoons.push({ x: d.x + Math.cos(a) * 12, y: d.y + Math.sin(a) * 12, vx: Math.cos(a) * 190, vy: Math.sin(a) * 190, a, life: 2.2 });
  d.cd = rand(2.4, 3.4); SFX.harpoon();
}

/* ---------- atualização principal ---------- */
function inputVec() {
  let ax = 0, ay = 0;
  if (keys.l || keys.r || keys.u || keys.d) {
    ax = (keys.r ? 1 : 0) - (keys.l ? 1 : 0); ay = (keys.d ? 1 : 0) - (keys.u ? 1 : 0);
    const l = Math.hypot(ax, ay) || 1; ax /= l; ay /= l;
  } else if (ptr.active) {
    const w = screenToWorld(ptr.x, ptr.y), dx = w.x - shark.x, dy = w.y - shark.y, d = Math.hypot(dx, dy), dead = 5 * shark.m;
    if (d > dead) { const mg = clamp((d - dead) / (28 + 10 * shark.m), 0, 1); ax = dx / d * mg; ay = dy / d * mg; }
  }
  return { ax, ay };
}
function updateShark(dt) {
  const s = shark;
  s.t += dt; s.inv = Math.max(0, s.inv - dt); s.bite = Math.max(0, s.bite - dt); s.stun = Math.max(0, s.stun - dt); s.flash = Math.max(0, s.flash - dt);
  s.m += (s.mT - s.m) * Math.min(1, dt * 4);
  let ax = 0, ay = 0;
  if (state === 'menu') {
    const tx = W / 2 + Math.sin(t * 0.25) * 330, ty = 230 + Math.sin(t * 0.45) * 70;
    ax = clamp((tx - s.x) / 40, -1, 1) * 0.8; ay = clamp((ty - s.y) / 40, -1, 1) * 0.8;
  } else if (state === 'playing') { const v = inputVec(); ax = v.ax; ay = v.ay; }
  const wantDash = state === 'playing' && (keys.dash || dashBtnDown || (ptr.down && ptr.type === 'mouse'));
  s.dash = false;
  if (wantDash && !s.exhausted && s.sta > 0 && (ax || ay || Math.abs(s.vx) > 20)) {
    s.dash = true; s.sta -= 42 * dt; s.staDelay = 0.6;
    if (s.sta <= 0) { s.sta = 0; s.exhausted = true; }
    if (Math.random() < dt * 14) bubbleAt(s.x - s.face * 12 * s.m, s.y + rand(-3, 3), 0.8);
    if (!s.dashSnd || s.dashSnd < t) { SFX.dash(); s.dashSnd = t + 0.35; }
  } else {
    s.staDelay -= dt; if (s.staDelay <= 0) s.sta = Math.min(100, s.sta + 24 * dt);
    if (s.exhausted && s.sta > 30) s.exhausted = false;
  }
  const maxSp = (76 + level * 5) * (s.dash ? 1.85 : 1) * (s.stun > 0 ? 0.5 : 1);
  const k = Math.min(1, dt * (s.dash ? 4 : 3.2));
  s.vx += (ax * maxSp - s.vx) * k; s.vy += (ay * maxSp - s.vy) * k;
  s.x += (s.vx + storm.push * (s.dash ? 0.4 : 1)) * dt; s.y += s.vy * dt;
  const mm = s.m, minX = 16 * mm, maxX = W - 16 * mm, minY = SURF + 7 * mm, maxY = floorTop(s.x) - 10 * mm;
  if (s.x < minX) { s.x = minX; s.vx = Math.max(0, s.vx); } if (s.x > maxX) { s.x = maxX; s.vx = Math.min(0, s.vx); }
  if (s.y < minY) { s.y = minY; s.vy = Math.max(0, s.vy); } if (s.y > maxY) { s.y = maxY; s.vy = Math.min(0, s.vy); }
  if (s.vx > 8) s.face = 1; else if (s.vx < -8) s.face = -1;
  const tgt = clamp(Math.atan2(s.vy, Math.abs(s.vx) + 20) * 0.7, -0.5, 0.5);
  s.rot += (tgt - s.rot) * Math.min(1, dt * 8);
  if (state === 'playing' && Math.hypot(s.vx, s.vy) > 30 && Math.random() < dt * 2) bubbleAt(s.x + s.face * 12 * mm, s.y - 3 * mm, 0.7);
}
function collisions() {
  const s = shark, m = s.m, mx = s.x + s.face * 10 * m, my = s.y + 2 * m, mr = 8.5 * m, br = 8 * m;
  for (const e of ents) {
    if (e.dead) continue;
    const sp = e.sp;
    if (e.boss) { // chefe: só dá para morder quando está cansado
      if (e.st === 'tired') { if (e.hitCd <= 0 && Math.hypot(e.x - mx, e.y - my) < mr + e.r * 0.95) bossHit(e); }
      else if (Math.hypot(e.x - s.x, e.y - s.y) < br + e.r * 0.75) { if (s.inv <= 0) e.flash = 0.2; hurt(e.st === 'charge' ? sp.harm : 12, e.x, e.y, e); }
      continue;
    }
    if (isEdible(e)) {
      if (Math.hypot(e.x - mx, e.y - my) < mr + e.r * 0.9) eat(e);
    } else if (sp.harm) {
      if (Math.hypot(e.x - s.x, e.y - s.y) < br + e.r * 0.8) {
        if (s.inv <= 0) {
          e.bite = 0.4; e.flash = 0.2;
          if (sp.ai === 'jelly') { s.stun = 1.2; }
        }
        hurt(sp.harm, e.x, e.y, e);
      }
    }
  }
  if (rival && state === 'playing') { // choque com o rival: dash (ou ser maior) vence
    const rv = rival;
    if (Math.hypot(rv.x - s.x, rv.y - s.y) < 8 * m + 8 * rv.m) {
      const a = Math.atan2(rv.y - s.y, rv.x - s.x);
      if (rv.hitCd <= 0 && (s.dash || level > rv.level)) rivalHit(s.dash ? 14 : 9);
      else if (rv.cd <= 0 && s.inv <= 0 && rv.level >= level) { hurt(10, rv.x, rv.y, rv); rv.cd = 1.2; rv.vx = Math.cos(a) * 80; rv.vy = Math.sin(a) * 80; }
    }
  }
  for (let i = harpoons.length - 1; i >= 0; i--) {
    const h = harpoons[i];
    if (Math.hypot(h.x - s.x, h.y - s.y) < br + 3) { hurt(15, h.x - h.vx * 0.1, h.y - h.vy * 0.1); harpoons.splice(i, 1); }
  }
  for (const c of chests) {
    if (!c.open && Math.hypot(c.x - s.x, (c.y - 8) - s.y) < 10 * m + 9) {
      c.open = true; c.t = 40; spawnCoins(c.x, c.y - 14, randi(7, 11)); SFX.chest(); score += 25; floatText(c.x, c.y - 28, '+25', '#ffd27a'); Meta.add('chests');
    }
  }
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i], d = Math.hypot(c.x - s.x, c.y - s.y);
    if (d < 45 + 6 * m) { c.vx += (s.x - c.x) * 6 * 0.016; c.vy += (s.y - c.y) * 6 * 0.016; c.mag = true; }
    if (d < 9 * m + 6) {
      const v = c.big ? 40 : 10, w = c.big ? 4 : 1;
      score += v; stats.coins++; stats.wallet += w; Meta.coin(w); floatText(c.x, c.y - 4, '+' + v, '#ffe27a'); SFX.coin(); coins.splice(i, 1);
    }
  }
}
function update(dt) {
  t += dt;
  const live = state === 'playing' || state === 'dying';
  if (live) stats.time += dt;
  if (live && mode.time) { huntLeft -= dt; if (huntLeft <= 0) { huntLeft = 0; showOver('time'); return; } }
  // grupos
  for (const g of groups) { g.sx = 0; g.sy = 0; g.c = 0; g.wt -= dt; if (g.wt <= 0) { g.wt = rand(2, 5); if (Math.random() < 0.3) g.dh *= -1; g.wy = rand(-0.5, 0.5); } }
  for (const e of ents) if (e.group && !e.dead) { e.group.sx += e.x; e.group.sy += e.y; e.group.c++; }
  for (const g of groups) if (g.c) { g.cx = g.sx / g.c; g.cy = g.sy / g.c; g.n = g.c; }
  for (let i = groups.length - 1; i >= 0; i--) if (!groups[i].c && groups[i].n <= 0) groups.splice(i, 1);

  // tempestade: correnteza que empurra tudo e pouca visibilidade
  if (storm.on) { storm.t += dt; storm.k = Math.min(1, storm.k + dt / 3); } else storm.k = Math.max(0, storm.k - dt / 3);
  if (storm.k > 0) {
    storm.push = Math.sin(storm.t * 0.45) * 50 * storm.k;
    storm.flash = Math.max(0, storm.flash - dt);
    if (storm.on) { storm.nextFlash -= dt; if (storm.nextFlash <= 0) { storm.flash = 0.4; storm.nextFlash = rand(3, 8); setTimeout(() => SFX.thunder(), 380); } }
  } else storm.push = 0;

  if (state === 'dying') {
    deathT += dt; shark.vy = lerp(shark.vy, -22, dt * 2); shark.vx *= 0.96; shark.y += shark.vy * dt; shark.rot += dt * 3;
    if (Math.random() < dt * 10) bubbleAt(shark.x + rand(-8, 8), shark.y, 1);
    if (deathT > (mode.time ? 1.3 : 1.9)) { if (mode.time && huntLeft > 0) huntRespawn(); else showOver(); }
  } else updateShark(dt);

  if (state === 'playing' || state === 'menu') {
    skinFx(dt);
    const sk = SKINS[curSkinIdx()];
    if (!shark.trail) { shark.trail = []; shark.trailT = 0; }
    shark.trailT -= dt;
    if (shark.trailT <= 0) {
      shark.trailT = 0.055; shark.trail.push({ x: shark.x, y: shark.y, face: shark.face, rot: shark.rot, m: shark.m });
      if (shark.trail.length > (sk.fx === 'ghost' || sk.fx === 'rainbow' ? 7 : 0)) shark.trail.shift();
    }
    if (sk.fx === 'volt' && shark.dash && Math.random() < dt * 20) {
      const a = rand(0, Math.PI * 2), l = rand(10, 22);
      parts.push({ k: 'bolt', x: shark.x, y: shark.y, ex: Math.cos(a) * l, ey: Math.sin(a) * l, life: 0.12, max: 0.12, vx: 0, vy: 0, seed: Math.random() * 99 });
    }
  }

  if (state !== 'paused') {
    for (const e of ents) if (!e.dead) updateEnt(e, dt);
    ents = ents.filter(e => !e.dead);
    if (state === 'playing') { collisions(); if (state === 'playing') updateDirector(dt); }
    manageSpawns(dt);
  }
  // arpões
  for (let i = harpoons.length - 1; i >= 0; i--) {
    const h = harpoons[i]; h.x += h.vx * dt; h.y += h.vy * dt; h.life -= dt;
    if (h.life <= 0 || h.x < 0 || h.x > W || h.y < SURF || h.y > floorTop(h.x)) harpoons.splice(i, 1);
  }
  // moedas
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i]; c.t += dt; c.life -= dt;
    if (!c.mag) { c.vy += 40 * dt; c.vx *= 0.97; c.vy = Math.min(c.vy, 25); }
    c.vx *= 0.985; c.x += (c.vx + (c.mag ? 0 : storm.push * 0.5)) * dt; c.y += c.vy * dt;
    const f = floorTop(c.x) - 6; if (c.y > f) { c.y = f; c.vy = 0; c.vx *= 0.8; }
    if (c.life <= 0) coins.splice(i, 1);
  }
  for (const c of chests) if (c.open) { c.t -= dt; if (c.t <= 0) c.open = false; }
  // partículas
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.k === 'sq') { p.vx *= 0.96; p.vy *= 0.96; if (p.g) p.vy += p.g * dt; } else if (p.k === 'bub') { p.x += Math.sin(t * 5 + p.ph) * 4 * dt; if (p.y < SURF) p.life = 0; }
    if (p.life <= 0) parts.splice(i, 1);
  }
  // bolhas ambiente
  if (Math.random() < dt * 3) { const x = rand(20, W - 20); bubbles.push({ x, y: floorTop(x) - 4, sp: rand(14, 26), ph: rand(0, 6), sc: pick([1, 1, 2]), age: 0 }); }
  for (let i = bubbles.length - 1; i >= 0; i--) { const b = bubbles[i]; b.y -= b.sp * dt; b.age += dt; if (b.y < SURF + 2) bubbles.splice(i, 1); }
  if (comboT > 0) { comboT -= dt; if (comboT <= 0) combo = 0; }
  // progresso salvo / conquistas
  if (state === 'playing') { metaT -= dt; if (metaT <= 0) { metaT = 0.5; Meta.check(R, curX()); Meta.save(); } }
  // câmera
  const zoom = 1 / (1 + (shark.m - 1) * 0.5);
  ws = baseScale * zoom;
  const lead = state === 'playing' ? 0.35 : 0;
  const hw = cw / (2 * ws), hh = ch / (2 * ws);
  let tx = shark.x + shark.vx * lead, ty = shark.y + shark.vy * lead * 0.6;
  tx = hw * 2 >= W ? W / 2 : clamp(tx, hw, W - hw);
  ty = clamp(ty, hh - 40, H - hh + 4);
  if (state === 'menu') { tx = clamp(W / 2 + Math.sin(t * 0.25) * 200, hw, W - hw); ty = clamp(210, hh - 40, H - hh); }
  cam.x += (tx - cam.x) * Math.min(1, dt * 4); cam.y += (ty - cam.y) * Math.min(1, dt * 4);
  cam.shake = Math.max(0, cam.shake - dt * 22);
  if (state === 'playing' || state === 'dying') updateHud();
}

/* ---------- desenho ---------- */
function frame(img, fw, fh, col, row, x, y, sc, flip, rot, alpha) {
  x = Math.round(x * ws) / ws; y = Math.round(y * ws) / ws;
  ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot); ctx.scale(flip * sc, sc);
  if (alpha !== undefined && alpha < 1) ctx.globalAlpha = alpha;
  ctx.drawImage(img, col * fw, row * fh, fw, fh, -fw / 2, -fh / 2, fw, fh); ctx.restore();
}
// brilho pré-renderizado: cada quadro do mapa de emissão ganha uma margem com halo desfocado (feito uma vez, sem custo por quadro)
const emCache = new Map(), GP = 7;
function emGlowSheet(img, fw, fh, color) {
  const k = img.src + color; let c = emCache.get(k);
  if (c) return c;
  const cols = Math.floor(img.width / fw), rows = Math.floor(img.height / fh), cwid = fw + GP * 2, chei = fh + GP * 2;
  const tint = document.createElement('canvas'); tint.width = img.width; tint.height = img.height;
  const tg = tint.getContext('2d'); tg.drawImage(img, 0, 0); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = color; tg.fillRect(0, 0, tint.width, tint.height);
  c = document.createElement('canvas'); c.width = cols * cwid; c.height = rows * chei;
  const g = c.getContext('2d'); g.shadowColor = color; g.shadowBlur = 7;
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) g.drawImage(tint, q * fw, r * fh, fw, fh, q * cwid + GP, r * chei + GP, fw, fh);
  emCache.set(k, c); return c;
}
function glowFrame(img, fw, fh, col, row, x, y, sc, flip, rot, color, blur, alpha) {
  const sheet = emGlowSheet(img, fw, fh, color), cwid = fw + GP * 2, chei = fh + GP * 2;
  x = Math.round(x * ws) / ws; y = Math.round(y * ws) / ws;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = true;
  ctx.translate(x, y); if (rot) ctx.rotate(rot); ctx.scale(flip * sc, sc);
  ctx.drawImage(sheet, col * cwid, row * chei, cwid, chei, -cwid / 2, -chei / 2, cwid, chei); ctx.restore();
}
function halo(x, y, r, rgb, a) {
  const gr = ctx.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(' + rgb + ',' + a + ')'); gr.addColorStop(1, 'rgba(' + rgb + ',0)');
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gr; ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore();
}
const CORAL_GLOW = ['#ff5ea8', '#9db4ff', '#ff4a5a', '#ff9aa0', '#a060ff', '#5ffff0', '#ff9ad8'];
const WEED_GLOW = { seaweed_pink: '#ff7ad0', seaweed_blue: '#5ad7ff' };
function drawGlows() {
  // quanto mais fundo, mais forte o brilho
  const k = clamp((cam.y - 60) / (H - 160), 0.3, 1), a = 0.5 + 0.5 * k;
  const hw = cw / (2 * ws) + 40, hh = ch / (2 * ws) + 40;
  const i0 = clamp(Math.floor((cam.x - hw) / TILE), 0, COLS - 1), i1 = clamp(Math.ceil((cam.x + hw) / TILE), 0, COLS - 1);
  for (let i = i0; i <= i1; i++) if (floorAbyss[i]) glowFrame(IMG.em_abyss, 16, 16, 1, 0, i * TILE + 8, H - floorH[i] * TILE + 8, 1, 1, 0, '#4fe8ff', 7, a * 0.8);
  for (const d of decor) {
    if (Math.abs(d.x - cam.x) > hw || Math.abs(d.y - cam.y) > hh) continue;
    if (d.k === 'weed') glowFrame(IMG.em_seaweed, 16, 32, Math.floor(t * 7 + d.ph) % 12, d.row, d.x, d.y - 16 * d.sc, d.sc, 1, 0, WEED_GLOW[d.img] || '#5dffb0', 9, a * 0.55);
    else if (d.k === 'coral') glowFrame(IMG.em_corals, 16, 16, d.col, d.row, d.x, d.y - 8 * d.sc, d.sc, 1, 0, CORAL_GLOW[d.row], 9, a * 0.7);
  }
  for (const e of ents) {
    if (Math.abs(e.x - cam.x) > hw + 20 || Math.abs(e.y - cam.y) > hh + 20) continue;
    const sp = e.sp, fr = entFrame(e);
    if (sp.ai === 'jelly') {
      const rot = Math.sin(e.t * 1.2) * 0.1, c = e.row ? '#3dfff0' : '#ff6ac0';
      halo(e.x, e.y, 30 * e.sc, e.row ? '60,255,240' : '255,110,190', 0.22 * a);
      glowFrame(IMG.em_jelly, 32, 16, fr.f, e.row, e.x, e.y, e.sc, e.face, rot, c, 12, a * 0.6);
    } else if (sp.ai === 'angler') {
      const rot = clamp(Math.atan2(e.vy, Math.abs(e.vx) + 12) * 0.5, -0.45, 0.45) * e.face;
      const lx = e.x + e.face * (28 - 16) * e.sc, ly = e.y + (7 - 16) * e.sc;
      halo(lx, ly, 46 * e.sc, '255,235,140', 0.3 * a);
      glowFrame(IMG.em_angler, 32, 32, fr.f, fr.row, e.x, e.y, e.sc, e.face, rot, '#fff2a8', 14, 1);
    }
  }
}
function drawSky() {
  const g = ctx.createLinearGradient(0, -300, 0, SURF);
  g.addColorStop(0, '#6fd0ff'); g.addColorStop(1, '#d6f6ff');
  ctx.fillStyle = g; ctx.fillRect(-200, -300, W + 400, SURF + 300);
  // sol
  ctx.fillStyle = '#fff3a8'; ctx.fillRect(1160, -34, 28, 28); ctx.fillStyle = '#ffe36a'; ctx.fillRect(1164, -30, 20, 20);
  // nuvens
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 6; i++) {
    const x = ((i * 290 + t * 4 * (1 + i % 3 * 0.3)) % (W + 200)) - 60, y = -26 - (i % 3) * 8;
    ctx.fillRect(x, y, 44, 8); ctx.fillRect(x + 8, y - 6, 24, 6); ctx.fillRect(x + 28, y - 3, 22, 4);
  }
  // barcos
  for (const bx of BOATS) {
    const bob = Math.sin(t * 1.4 + bx) * 0.8, y = SURF - 4 + bob;
    ctx.fillStyle = '#3a2a4a'; ctx.fillRect(bx - 30, y - 8, 60, 12);
    ctx.fillStyle = '#e8564a'; ctx.fillRect(bx - 28, y - 12, 56, 6);
    ctx.fillStyle = '#fff7e0'; ctx.fillRect(bx - 28, y - 7, 56, 2);
    ctx.fillStyle = '#fff7e0'; ctx.fillRect(bx - 8, y - 24, 22, 12); ctx.fillStyle = '#7fd4ff'; ctx.fillRect(bx - 5, y - 21, 6, 6); ctx.fillRect(bx + 4, y - 21, 6, 6);
    ctx.fillStyle = '#e8564a'; ctx.fillRect(bx - 9, y - 26, 24, 3);
    ctx.fillStyle = '#3a2a4a'; ctx.fillRect(bx + 20, y - 30, 2, 18); ctx.fillStyle = '#ffd27a'; ctx.fillRect(bx + 22, y - 30, 8, 5);
  }
}
function hillLayer(par, baseY, amp, color) {
  ctx.save(); ctx.translate(cam.x * (1 - par), 0);
  const hw = cw / (2 * ws) + 20, x0 = Math.floor((cam.x - hw - cam.x * (1 - par)) / 12) * 12, x1 = cam.x + hw - cam.x * (1 - par);
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x0, H + 200);
  for (let x = x0; x <= x1 + 12; x += 12) ctx.lineTo(x, baseY - (Math.sin(x * 0.011 + par * 5) * amp + Math.sin(x * 0.029 + 2) * amp * 0.5 + Math.sin(x * 0.0047) * amp * 0.9));
  ctx.lineTo(x1 + 12, H + 200); ctx.closePath(); ctx.fill(); ctx.restore();
}
function drawBackground() {
  const y0 = (SURF - cam.y) * ws + ch / 2, y1 = (H - cam.y) * ws + ch / 2;
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#5fdcea'); g.addColorStop(0.12, '#2fa6dc'); g.addColorStop(0.4, '#1e63b4'); g.addColorStop(0.72, '#17307f'); g.addColorStop(1, '#0b1044');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
  ctx.setTransform(ws, 0, 0, ws, Math.round(cw / 2 - cam.x * ws), Math.round(ch / 2 - cam.y * ws));
  ctx.save(); ctx.globalAlpha = 0.07; ctx.fillStyle = '#e8ffff';
  for (let i = 0; i < 6; i++) {
    const x = 120 + i * 270 + Math.sin(t * 0.3 + i) * 25, w = 30 + (i % 3) * 14;
    ctx.beginPath(); ctx.moveTo(x, SURF); ctx.lineTo(x + w, SURF); ctx.lineTo(x + w + 150, SURF + 520); ctx.lineTo(x + 60, SURF + 520); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  hillLayer(0.55, H - 70, 40, 'rgba(14,40,110,0.55)');
  hillLayer(0.78, H - 40, 34, 'rgba(9,24,80,0.6)');
}
function drawFloor() {
  const hw = cw / (2 * ws) + TILE, i0 = clamp(Math.floor((cam.x - hw) / TILE), 0, COLS - 1), i1 = clamp(Math.ceil((cam.x + hw) / TILE), 0, COLS - 1);
  const bottom = cam.y + ch / (2 * ws) + TILE;
  for (let i = i0; i <= i1; i++) {
    const top = H - floorH[i] * TILE, im = floorAbyss[i] ? IMG.abyss : IMG.sand;
    ctx.drawImage(im, 16, 0, 16, 16, i * TILE, top, TILE, TILE);
    for (let y = top + TILE; y < Math.min(bottom, H + TILE); y += TILE) ctx.drawImage(im, 16, 16, 16, 16, i * TILE, y, TILE, TILE);
  }
}
function drawDecor() {
  const hw = cw / (2 * ws) + 40;
  for (const d of decor) {
    if (Math.abs(d.x - cam.x) > hw) continue;
    ctx.save(); ctx.translate(Math.round(d.x), Math.round(d.y)); ctx.scale(d.sc, d.sc);
    if (d.k === 'weed') { const f = Math.floor(t * 7 + d.ph) % 12; ctx.drawImage(IMG[d.img], f * 16, d.row * 32, 16, 32, -8, -32, 16, 32); }
    else if (d.k === 'coral') ctx.drawImage(IMG.corals, d.col * 16, d.row * 16, 16, 16, -8, -16, 16, 16);
    else ctx.drawImage(IMG.shells, d.col * 16, d.row * 16, 16, 16, -8, -15, 16, 16);
    ctx.restore();
  }
  for (const c of chests) {
    const col = c.open ? (c.t > 36 ? 1 : 2) : 0;
    ctx.drawImage(IMG.chests, col * 16, c.row * 32, 16, 32, c.x - 8, c.y - 25, 16, 32);
  }
}
function drawSurface() {
  for (let x = Math.floor((cam.x - cw / (2 * ws)) / 4) * 4; x < cam.x + cw / (2 * ws) + 4; x += 4) {
    const y = SURF + Math.sin(t * 2 + x * 0.08) * 1.2;
    ctx.fillStyle = '#e6fbff'; ctx.fillRect(x, Math.round(y) - 1, 4, 2);
    ctx.fillStyle = 'rgba(160,240,250,0.55)'; ctx.fillRect(x, Math.round(y) + 1, 4, 3);
  }
}
function entFrame(e) {
  const sp = e.sp; let row = e.row, f = Math.floor(e.t * sp.fps) % sp.n;
  if (sp.ai === 'squid') f = (e.vx * e.vx + e.vy * e.vy > 400) ? 2 : Math.floor(e.t * 4) % 2;
  if (e.bite > 0 && sp.bite !== undefined) { row = sp.bite; f = Math.min(7, Math.floor((1 - e.bite / 0.4) * 8)); }
  if (sp.ai === 'diver') { row = e.aimT > 0 ? 2 : 0; }
  return { row, f };
}
function drawEnts() {
  const hw = cw / (2 * ws) + 60, hh = ch / (2 * ws) + 60;
  for (const e of ents) {
    const pad = e.boss ? 60 : 0;
    if (Math.abs(e.x - cam.x) > hw + pad || Math.abs(e.y - cam.y) > hh + pad) continue;
    const sp = e.sp, { row, f } = entFrame(e);
    let rot = clamp(Math.atan2(e.vy, Math.abs(e.vx) + 12) * 0.5, -0.45, 0.45) * e.face;
    if (sp.ai === 'diver') rot = 0;
    if (sp.ai === 'jelly') rot = Math.sin(e.t * 1.2) * 0.1;
    if (sp.ai === 'squid') rot = Math.atan2(e.vy, Math.abs(e.vx) + 6) * 0.9 * e.face;
    if ((sp.ai === 'sword' || sp.boss) && e.st === 'windup') rot = Math.atan2(Math.sin(e.aim), Math.abs(Math.cos(e.aim))) * e.face + Math.sin(e.t * 60) * 0.04;
    if (sp.boss && e.st === 'charge') rot = Math.atan2(e.cvy, Math.abs(e.cvx)) * e.face;
    if (sp.boss && e.st === 'tired') rot = Math.sin(e.t * 3) * 0.12;
    if (sp.boss && e.st === 'windup') { // mira do ataque
      ctx.save(); ctx.strokeStyle = 'rgba(255,60,80,' + (0.3 + 0.25 * Math.sin(t * 30)).toFixed(2) + ')'; ctx.lineWidth = 3; ctx.setLineDash([7, 5]);
      ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(e.aim) * 320, e.y + Math.sin(e.aim) * 320); ctx.stroke(); ctx.restore();
    }
    if (e.raid) glowDot(ctx, e.x, e.y, e.r * 2.2, '255,50,70', 0.4 + 0.15 * Math.sin(t * 8));
    if (e.flash > 0) ctx.globalAlpha = 0.6;
    frame(e.img, sp.fw, sp.fh, f, row, e.x, e.y, e.sc, e.face, rot, 1);
    ctx.globalAlpha = 1;
    if (sp.ai === 'diver' && e.aimT > 0) {
      const a = Math.atan2(shark.y - e.y, shark.x - e.x);
      ctx.save(); ctx.translate(Math.round(e.x + Math.cos(a) * 8), Math.round(e.y + Math.sin(a) * 8)); ctx.rotate(a);
      ctx.drawImage(IMG.harpoon, 2, 21, 26, 11, -8, -5, 26, 11); ctx.restore();
    }
    // aviso de perigo
    if (state === 'playing' && sp.harm && !sp.boss && !isEdible(e) && dist(e, shark) < 150) drawWarn(e.x, e.y - e.r - 10, sp.ai === 'sword' && e.st === 'windup');
    if (state === 'playing' && sp.ai === 'diver' && !isEdible(e) && e.aimT > 0) drawWarn(e.x, e.y - 22, true);
    if (sp.boss) drawBossExtras(e);
  }
}
function outlineText(text, x, y, color) {
  ctx.fillStyle = '#2a1a4a'; ctx.fillText(text, x + 1, y + 1); ctx.fillStyle = color; ctx.fillText(text, x, y);
}
function drawBossExtras(e) {
  if (e.st === 'windup') drawWarn(e.x, e.y - e.r - 12, true);
  if (e.st === 'tired') {
    for (let i = 0; i < 3; i++) {
      const a = t * 4 + i * 2.1, x = Math.round(e.x + Math.cos(a) * e.r * 0.7), y = Math.round(e.y - e.r - 4 + Math.sin(a) * 4);
      ctx.fillStyle = '#ffd27a'; ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3);
    }
    ctx.font = '7px "Press Start 2P", monospace'; ctx.textAlign = 'center';
    outlineText('MORDA!', Math.round(e.x), Math.round(e.y - e.r - 12), Math.floor(t * 6) % 2 ? '#ffffff' : '#5df2a0');
  }
}
function drawWarn(x, y, strong) {
  x = Math.round(x); y = Math.round(y) + (strong ? Math.round(Math.sin(t * 30)) : 0);
  ctx.fillStyle = '#7a1428'; ctx.fillRect(x - 4, y - 8, 8, 14);
  ctx.fillStyle = strong ? '#ff3b52' : '#ff7a8a'; ctx.fillRect(x - 3, y - 7, 6, 12);
  ctx.fillStyle = '#fff'; ctx.fillRect(x - 1, y - 6, 2, 6); ctx.fillRect(x - 1, y + 2, 2, 2);
}
function drawHarpoons() {
  for (const h of harpoons) { ctx.save(); ctx.translate(Math.round(h.x), Math.round(h.y)); ctx.rotate(h.a); ctx.drawImage(IMG.harpoon, 2, 2, 26, 5, -13, -2, 26, 5); ctx.restore(); }
}
// desenha um tubarão (o seu ou o rival): rastros, camadas, efeito da skin e piscada de dano
function drawSharkObj(o, sheet, sk) {
  const m = o.m, spd = Math.hypot(o.vx, o.vy);
  const tailF = TAIL_SEQ[Math.floor(o.t * (5 + spd / 12)) % 8];
  let headF = o.dash ? 1 : 0;
  if (o.bite > 0) headF = Math.round(Math.sin((1 - o.bite / 0.4) * Math.PI) * 4);
  let alpha = 1; if (o.inv > 0 && !o.dead) alpha = Math.floor(t * 18) % 2 ? 0.45 : 1;
  const x = Math.round(o.x * ws) / ws, y = Math.round(o.y * ws) / ws;
  if (sk && o.trail && (sk.fx === 'ghost' || sk.fx === 'rainbow')) {
    o.trail.forEach((p, i) => {
      const sh = sk.fx === 'rainbow' ? rainbowSheets[(Math.floor(t * 3) + i * 2) % 12] : sheet;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot * p.face); ctx.scale(p.face * p.m, p.m); ctx.globalAlpha = (i + 1) / o.trail.length * 0.3;
      sharkLayers(ctx, sh, 0, tailF); ctx.restore();
    });
  }
  const cur = sk && sk.fx === 'rainbow' ? rainbowSheets[Math.floor(t * 2) % 12] : sheet;
  ctx.save(); ctx.translate(x, y); ctx.rotate(o.rot * o.face); ctx.scale(o.face * m, o.dead ? -m : m); ctx.globalAlpha = alpha;
  if (o.dash) { ctx.save(); ctx.globalAlpha = alpha * 0.25; for (let i = 1; i <= 3; i++) { ctx.translate(-6, 0); sharkLayers(ctx, cur, headF, tailF); } ctx.restore(); }
  sharkBodyFx(ctx, sk, cur, headF, tailF, t);
  if (o.flash > 0) { ctx.globalAlpha = alpha * clamp(o.flash * 3, 0, 0.7); sharkLayers(ctx, hitSheet, headF, tailF); }
  ctx.restore();
}
function drawShark() { const i = curSkinIdx(); drawSharkObj(shark, skinSheets[i], SKINS[i]); }
function drawRival() {
  if (!rival) return;
  const r = rival; drawSharkObj(r, rivalSheet, null);
  const x = Math.round(r.x), y = Math.round(r.y - 19 * r.m);
  ctx.font = '6px "Press Start 2P", monospace'; ctx.textAlign = 'center'; outlineText('RIVAL ' + r.level, x, y, '#ff9a8a');
  if (r.hp < r.maxhp) { ctx.fillStyle = '#10153a'; ctx.fillRect(x - 12, y + 3, 24, 3); ctx.fillStyle = '#ff5c6c'; ctx.fillRect(x - 12, y + 3, Math.max(0, 24 * r.hp / r.maxhp), 3); }
}
function drawParts() {
  for (const b of bubbles) { const bf = Math.min(4, 3 + (b.age > 6 ? 1 : 0)); frame(IMG.bubble, 8, 8, bf, 0, b.x + Math.sin(t * 2 + b.ph) * 2, b.y, b.sc * 0.8, 1, 0, 0.55); }
  for (const p of parts) {
    if (p.k === 'sq') { ctx.globalAlpha = clamp(p.life / p.max * 1.5, 0, 1); ctx.fillStyle = p.c; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s); ctx.globalAlpha = 1; }
    else if (p.k === 'bub') { const lf = p.life / p.max; frame(IMG.bubble, 8, 8, lf < 0.25 ? 7 : 4, 0, p.x, p.y, p.sc, 1, 0, 0.8); }
    else if (p.k === 'glow') glowDot(ctx, p.x, p.y, p.rad, p.rgb, clamp(p.life / p.max, 0, 1) * 0.9);
    else if (p.k === 'star') {
      const a = clamp(p.life / p.max, 0, 1) * (0.5 + 0.5 * Math.sin(t * 20 + p.x)); ctx.globalAlpha = a; ctx.fillStyle = p.c;
      const x = Math.round(p.x), y = Math.round(p.y); ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3); ctx.globalAlpha = 1;
    }
    else if (p.k === 'bolt') {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(255,250,170,' + clamp(p.life / p.max, 0, 1).toFixed(2) + ')'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, p.y);
      for (let i = 1; i <= 4; i++) ctx.lineTo(p.x + p.ex * i / 4 + Math.sin(p.seed * i * 7) * 3, p.y + p.ey * i / 4 + Math.cos(p.seed * i * 5) * 3);
      ctx.stroke(); ctx.restore();
    }
    else if (p.k === 'txt') {
      ctx.globalAlpha = clamp(p.life / 0.5, 0, 1); ctx.font = '7px "Press Start 2P", monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = '#2a1a4a'; ctx.fillText(p.text, Math.round(p.x) + 1, Math.round(p.y) + 1); ctx.fillStyle = p.c; ctx.fillText(p.text, Math.round(p.x), Math.round(p.y)); ctx.globalAlpha = 1;
    }
  }
  for (const c of coins) {
    const img = c.big ? IMG.coin_big : IMG.coin_small, n = c.big ? 8 : 6, f = Math.floor(c.t * 10) % n;
    frame(img, 16, 16, f, 0, c.x, c.y, 1, 1, 0, c.life < 4 ? (Math.floor(t * 10) % 2 ? 0.4 : 1) : 1);
  }
}
function drawExtraGlows() {
  const hw = cw / (2 * ws) + 40, hh = ch / (2 * ws) + 40, a = 0.5 + 0.5 * clamp((cam.y - 60) / (H - 160), 0.3, 1);
  for (const e of ents) {
    if (Math.abs(e.x - cam.x) > hw || Math.abs(e.y - cam.y) > hh) continue;
    if (e.sp.ai === 'gold') glowDot(ctx, e.x, e.y, 11, '255,215,90', 0.55 + 0.25 * Math.sin(t * 6 + e.t));
    else if (e.boss && e.st === 'windup') glowDot(ctx, e.x, e.y, e.r * 2, '255,60,80', 0.35);
    else if (e.boss && e.st === 'tired') glowDot(ctx, e.x, e.y, e.r * 1.8, '255,230,120', 0.25 + 0.15 * Math.sin(t * 8));
  }
  const sk = SKINS[curSkinIdx()];
  if (sk.glow && shark && !shark.dead && (state === 'playing' || state === 'menu')) glowDot(ctx, shark.x, shark.y, 22 * shark.m, sk.rgb, (0.28 + 0.1 * Math.sin(t * 3)) * a * 1.2);
}
function drawMini() {
  const w = mini.width, h = mini.height, sx = w / W, sy = h / H, fog = storm.k > 0.4;
  mctx.fillStyle = '#10286a'; mctx.fillRect(0, 0, w, h);
  mctx.fillStyle = '#4fd0e0'; mctx.fillRect(0, 0, w, 2);
  mctx.fillStyle = '#c9a25e'; for (let i = 0; i < COLS; i += 1) { const top = H - floorH[i] * TILE; mctx.fillRect(i * TILE * sx, top * sy, Math.ceil(TILE * sx), h - top * sy); }
  if (!fog) for (const e of ents) {
    mctx.fillStyle = e.boss ? '#c070ff' : e.sp.ai === 'gold' ? '#ffd23a' : isEdible(e) ? '#5df2a0' : '#ff5c6c';
    const z = e.boss ? 4 : 2; mctx.fillRect(Math.round(e.x * sx) - (e.boss ? 1 : 0), Math.round(e.y * sy) - (e.boss ? 1 : 0), z, z);
  }
  if (!fog) for (const c of chests) if (!c.open) { mctx.fillStyle = '#ffd27a'; mctx.fillRect(Math.round(c.x * sx), Math.round((c.y - 6) * sy), 3, 3); }
  if (!fog && rival) { mctx.fillStyle = '#ff9a3c'; mctx.fillRect(Math.round(rival.x * sx) - 1, Math.round(rival.y * sy) - 1, 4, 4); }
  mctx.strokeStyle = 'rgba(255,255,255,0.6)'; mctx.lineWidth = 1;
  mctx.strokeRect(Math.round((cam.x - cw / (2 * ws)) * sx) + 0.5, Math.round((cam.y - ch / (2 * ws)) * sy) + 0.5, Math.round(cw / ws * sx), Math.round(ch / ws * sy));
  if (fog) { mctx.fillStyle = 'rgba(190,210,255,0.18)'; for (let i = 0; i < 6; i++) mctx.fillRect((i * 29 + t * 20) % w, (i * 17) % h, 18, 1); }
  if (!shark.dead && Math.floor(t * 4) % 2 === 0) { mctx.fillStyle = '#fff'; mctx.fillRect(Math.round(shark.x * sx) - 1, Math.round(shark.y * sy) - 1, 4, 4); }
}
function drawStorm(trx, try_) {
  const k = storm.k; if (k <= 0) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const dir = Math.sign(storm.push) || 1, mag = Math.min(1, Math.abs(storm.push) / 25);
  ctx.strokeStyle = 'rgba(190,225,255,' + (0.24 * k).toFixed(3) + ')'; ctx.lineWidth = Math.max(1, dpr);
  for (let i = 0; i < 46; i++) { // riscos da correnteza
    const yy = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1, sp = 0.6 + ((i * 37) % 10) / 10;
    const xx = ((((i * 0.6180339) + dir * t * 0.35 * sp * mag) % 1) + 1) % 1, len = (18 + (i % 5) * 10) * dpr;
    ctx.beginPath(); ctx.moveTo(xx * cw, yy * ch); ctx.lineTo(xx * cw - dir * len, yy * ch); ctx.stroke();
  }
  const sx = shark.x * ws + trx, sy = shark.y * ws + try_, fl = clamp(storm.flash * 3, 0, 1);
  const g = ctx.createRadialGradient(sx, sy, 38 * ws, sx, sy, 105 * ws);
  g.addColorStop(0, 'rgba(3,10,28,0)'); g.addColorStop(1, 'rgba(3,10,28,' + (0.95 * k * (1 - fl * 0.75)).toFixed(3) + ')');
  ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
  if (fl > 0) { ctx.fillStyle = 'rgba(220,235,255,' + (fl * 0.28).toFixed(3) + ')'; ctx.fillRect(0, 0, cw, ch); }
}
function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
  drawBackground();
  const shx = cam.shake ? rand(-cam.shake, cam.shake) / ws : 0, shy = cam.shake ? rand(-cam.shake, cam.shake) / ws : 0;
  const trx = Math.round(cw / 2 - (cam.x - shx) * ws), try_ = Math.round(ch / 2 - (cam.y - shy) * ws);
  ctx.setTransform(ws, 0, 0, ws, trx, try_);
  drawSky(); drawFloor(); drawDecor(); drawEnts(); drawHarpoons(); drawRival(); if (shark) drawShark(); drawParts(); drawSurface();
  // escurece com a profundidade
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const depth = clamp((cam.y - 100) / (H - 100), 0, 1);
  ctx.fillStyle = 'rgba(2,6,30,' + (depth * 0.35).toFixed(3) + ')'; ctx.fillRect(0, 0, cw, ch);
  ctx.setTransform(ws, 0, 0, ws, trx, try_); drawGlows(); drawExtraGlows(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (shark && storm.k > 0) drawStorm(trx, try_);
  const v = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.45, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
  v.addColorStop(0, 'rgba(0,0,20,0)'); v.addColorStop(1, 'rgba(0,0,20,0.4)'); ctx.fillStyle = v; ctx.fillRect(0, 0, cw, ch);
  if (shark && shark.flash > 0) { ctx.fillStyle = 'rgba(255,40,70,' + (shark.flash * 0.9).toFixed(2) + ')'; ctx.fillRect(0, 0, cw, ch); }
  if (shark && shark.hp < 30 && state === 'playing') { ctx.fillStyle = 'rgba(255,0,40,' + (0.06 + Math.abs(Math.sin(t * 4)) * 0.08).toFixed(3) + ')'; ctx.fillRect(0, 0, cw, ch); }
  if (state === 'playing' && mode.hunger && hunger <= 0) { ctx.fillStyle = 'rgba(255,150,0,' + (0.05 + Math.abs(Math.sin(t * 3)) * 0.07).toFixed(3) + ')'; ctx.fillRect(0, 0, cw, ch); }
  if (state === 'playing' || state === 'paused' || state === 'dying') drawMini();
}

/* ---------- loop ---------- */
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cw = canvas.width = Math.floor(innerWidth * dpr); ch = canvas.height = Math.floor(innerHeight * dpr);
  baseScale = Math.max(1.7 * dpr, Math.min(cw / 380, ch / 214));
}
window.addEventListener('resize', resize);
let last = performance.now(), titleF = 0, titleT = 0;
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000); last = now;
  if (state !== 'loading') {
    if (state !== 'paused') update(dt);
    render();
    skinAnimT += dt; drawSkinCards();
    titleT += dt; if (titleT > 0.1) { titleT = 0; titleF = (titleF + 1) % 8; $('titleShark').style.backgroundPosition = (titleF * 100 / 7) + '% 0%'; }
  }
  requestAnimationFrame(loop);
}

/* ---------- início ---------- */
resize();
window.__game = { get state() { return state; }, get shark() { return shark; }, get ents() { return ents; }, get level() { return level; },
  get score() { return score; }, keys, get cam() { return cam; }, get ws() { return ws; }, get stats() { return stats; }, addGrowth(n) { growth += n; checkLevel(); },
  get growth() { return growth; }, start: startGame, get mode() { return mode; }, get evt() { return evt; }, get boss() { return boss; }, get rival() { return rival; },
  get wv() { return wv; }, get hunger() { return hunger; }, get storm() { return storm; }, get R() { return R; }, get huntLeft() { return huntLeft; }, P, Meta,
  startEvent, spawnBoss, spawnRival, startWave, endWave, bossHit, setHunger(v) { hunger = v; }, setHuntLeft(v) { huntLeft = v; }, curX, render, update };
loadAll().then(() => {
  buildSkins(); buildSkinGrid(); applyTitleSkin();
  makeSlider('slSfx', () => A.sfxV, v => { A.sfxV = v; store.set('sb_sfxv', v); }, () => SFX.click());
  makeSlider('slMus', () => A.musV, v => { A.musV = v; store.set('sb_musv', v); });
  resetWorld(true); state = 'menu'; showScreen('menu'); refreshBest(); refreshOpts(); refreshSkins();
});
requestAnimationFrame(loop);
// primeiro toque/clique libera o áudio
window.addEventListener('pointerdown', () => { ac(); if (state !== 'loading') startMusic(); }, { once: true });
