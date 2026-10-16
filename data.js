'use strict';
/* =====================================================================
   SHARK BITE — dados do jogo (constantes, espécies, modos, skins, álbum, conquistas)
   Carregado antes de meta.js e game.js (todos compartilham o mesmo escopo global).
   ===================================================================== */

/* ---------- utilidades ---------- */
const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};

/* ---------- mundo ---------- */
const W = 1600, H = 900, SURF = 26, TILE = 16;
const COLS = W / TILE;
const BOATS = [260, 820, 1340];
// níveis: ficou mais difícil subir de tamanho (antes: 0, 28, 75, 150, 270, 450)
const LV_THRESH = [0, 40, 105, 210, 380, 630];
const LV_NAMES = ['Filhote', 'Jovem', 'Caçador', 'Predador', 'Terror dos Mares', 'Rei dos Mares'];
const LV_M = [1.0, 1.22, 1.5, 1.85, 2.3, 2.85];
const MAX_HP = 100;
// presas bem menores que você enchem menos a barriga de crescimento (mín. 55%)
const growthFactor = (lvl, spLevel) => Math.max(0.55, 1 - 0.08 * Math.max(0, lvl - spLevel));

/* ---------- carregamento das imagens ---------- */
const FILES = ['shark', 'fish1_orange', 'fish1_pink', 'fish1_purple', 'fish1_red', 'fish2_blue', 'fish2_green', 'fish2_orange',
  'fish2_purple', 'fish3_blue', 'fish3_grey', 'fish3_orange', 'fish3_red', 'swordfish', 'sawshark', 'angler', 'jellyfish', 'squid',
  'shrimp', 'diver1', 'diver2', 'diver3', 'diver4', 'diver5', 'diver6', 'harpoon', 'bubble', 'coin_small', 'coin_big', 'chests',
  'shells', 'corals', 'sand', 'seaweed_light', 'seaweed_medium', 'seaweed_dark', 'seaweed_blue', 'seaweed_pink',
  'abyss', 'em_angler', 'em_jelly', 'em_seaweed', 'em_corals', 'em_abyss', 'shark_head', 'shark_tail', 'gold'];

/* ---------- espécies ---------- */
// level: nível do tubarão necessário para comer. harm: causa dano quando não pode ser comida.
const SP = {
  shrimp: { imgs: ['shrimp'], fw: 16, fh: 32, cols: 4, rows: [0], n: 4, fps: 5, level: 1, r: 5, growth: 3, score: 10, speed: 22, ai: 'prey', school: false, resp: 0.3 },
  fish1: { imgs: ['fish1_orange', 'fish1_pink', 'fish1_purple', 'fish1_red'], fw: 16, fh: 16, cols: 8, rows: [0], n: 8, fps: 10, level: 1, r: 6, growth: 4, score: 15, speed: 30, ai: 'prey', school: true, resp: 0.25 },
  fish2: { imgs: ['fish2_blue', 'fish2_green', 'fish2_orange', 'fish2_purple'], fw: 32, fh: 16, cols: 8, rows: [0], n: 8, fps: 10, level: 2, r: 8, growth: 7, score: 30, speed: 34, ai: 'prey', school: true, resp: 0.3 },
  squid: { imgs: ['squid'], fw: 32, fh: 16, cols: 4, rows: [0, 1], n: 4, fps: 5, level: 2, r: 8, growth: 8, score: 40, speed: 30, ai: 'squid', school: false, resp: 0.8 },
  fish3: { imgs: ['fish3_blue', 'fish3_grey', 'fish3_orange', 'fish3_red'], fw: 32, fh: 16, cols: 8, rows: [0], n: 8, fps: 10, level: 3, r: 8, growth: 10, score: 50, speed: 38, ai: 'prey', school: true, resp: 0.4 },
  jelly: { imgs: ['jellyfish'], fw: 32, fh: 16, cols: 4, rows: [0, 1], n: 3, fps: 4, level: 4, r: 8, growth: 12, score: 80, speed: 10, ai: 'jelly', harm: 10, school: false, resp: 1.5 },
  angler: { imgs: ['angler'], fw: 32, fh: 32, cols: 8, rows: [0], bite: 1, n: 8, fps: 8, level: 3, r: 12, growth: 25, score: 150, speed: 52, ai: 'angler', harm: 20, school: false, resp: 6 },
  diver: { imgs: ['diver1', 'diver2', 'diver3', 'diver4', 'diver5', 'diver6'], fw: 32, fh: 32, cols: 7, rows: [0], n: 6, fps: 6, level: 3, r: 9, growth: 22, score: 200, speed: 16, ai: 'diver', school: false, resp: 6 },
  sword: { imgs: ['swordfish'], fw: 48, fh: 32, cols: 8, rows: [0], n: 8, fps: 12, level: 4, r: 13, growth: 35, score: 250, speed: 46, ai: 'sword', harm: 25, school: false, resp: 7 },
  saw: { imgs: ['sawshark'], fw: 48, fh: 32, cols: 8, rows: [0], bite: 1, n: 8, fps: 10, level: 5, r: 14, growth: 55, score: 400, speed: 36, ai: 'saw', harm: 30, school: false, resp: 9 }
};
const SP_KEYS = Object.keys(SP); // só as espécies "normais" (as de evento/chefe não entram no sistema de spawn)
// espécies especiais (não nascem sozinhas)
SP.gold = { imgs: ['gold'], fw: 16, fh: 16, cols: 8, rows: [0], n: 8, fps: 12, level: 1, r: 6, growth: 5, score: 150, speed: 46, ai: 'gold', school: false, resp: 999, hunger: 16 };
SP.bsword = { imgs: ['swordfish'], fw: 48, fh: 32, cols: 8, rows: [0], n: 8, fps: 12, level: 99, r: 13, growth: 0, score: 0, speed: 60, ai: 'bsword', harm: 30, boss: true, school: false, resp: 999, sc: 2.3, hp: 8, name: 'Rei Espada' };
SP.bsaw = { imgs: ['sawshark'], fw: 48, fh: 32, cols: 8, rows: [0], bite: 1, n: 8, fps: 10, level: 99, r: 14, growth: 0, score: 0, speed: 50, ai: 'bsaw', harm: 30, boss: true, school: false, resp: 999, sc: 2.2, hp: 10, name: 'Serra Rainha' };

const BANDS = { shrimp: null, fish1: [70, 600], fish2: [90, 650], squid: [180, 760], fish3: [120, 720], jelly: [200, 640],
  angler: [480, 780], sword: [80, 520], saw: [380, 780], diver: [70, 320] };
const CHIP_ORDER = ['shrimp', 'fish1', 'fish2', 'squid', 'fish3', 'jelly', 'angler', 'diver', 'sword', 'saw'];
const CHIP_NAMES = { shrimp: 'Camarão', fish1: 'Peixinho', fish2: 'Peixe', squid: 'Lula', fish3: 'Peixe grande', jelly: 'Água-viva',
  angler: 'Peixe-pescador', diver: 'Mergulhador', sword: 'Peixe-espada', saw: 'Tubarão-serra', gold: 'Peixe dourado' };

/* ---------- modos de jogo ---------- */
// ev: [primeiro evento mín, máx, intervalo entre eventos mín, máx] em segundos
const MODES = {
  classic: { id: 'classic', name: 'Clássico', icon: [8, 2], hunger: 1, ev: [50, 80, 60, 120], rival: 20, bosses: true, bestKey: 'sb_best',
    desc: 'Cresça até virar o Rei dos Mares. Chefes, fome, eventos e um rival no seu caminho.' },
  hunt: { id: 'hunt', name: 'Caçada', icon: [1, 3], hunger: 0, ev: [25, 40, 35, 55], rival: 8, time: 300, thr: 0.75, bestKey: 'sb_best_hunt',
    desc: '5 minutos para fazer o máximo de pontos. Se for nocauteado, perde 10% e volta.' },
  survival: { id: 'survival', name: 'Sobrevivência', icon: [8, 0], hunger: 0.7, waves: true, ev: [60, 90, 70, 110], bestKey: 'sb_best_surv',
    desc: 'Ondas de predadores cada vez piores, com chefe a cada 5 ondas. Quantas aguenta?' }
};
const MODE_IDS = ['classic', 'hunt', 'survival'];
const HUNT_RANKS = [[0, 'Isca'], [2500, 'Pescador'], [6000, 'Predador'], [11000, 'Terror dos Mares'], [18000, 'Lenda do Mar']];

/* ---------- skins ---------- */
// hue/sat/bri: recolore as camadas Head/Tail. fx: efeito visual durante o jogo. glow: cor do brilho. price: moedas (0 = grátis)
const SKINS = [
  { id: 'classic', n: 'Clássico', hue: 0, sat: 1, bri: 1, tint: '#ffffff', price: 0 },
  { id: 'gold', n: 'Dourado', hue: 170, sat: 1.5, bri: 1.15, tint: '#ffd27a', price: 0 },
  { id: 'pink', n: 'Rosa', hue: 95, sat: 1.4, bri: 1.1, tint: '#ff9ad0', price: 0 },
  { id: 'neon', n: 'Neon', hue: -110, sat: 1.6, bri: 1.1, tint: '#7dff9a', price: 0 },
  { id: 'volcano', n: 'Vulcão', hue: 125, sat: 1.6, bri: 0.95, tint: '#ff7a5a', price: 0 },
  { id: 'ice', n: 'Gelo', hue: -50, sat: 1.2, bri: 1.25, tint: '#9ae6ff', price: 0 },
  // ---- skins com efeitos ----
  { id: 'ghost', n: 'Fantasma', hue: -25, sat: 0.45, bri: 1.7, tint: '#cfe8ff', fx: 'ghost', glow: '#9fe8ff', rgb: '150,230,255', price: 60,
    desc: 'Translúcido, deixa um rastro fantasma' },
  { id: 'bio', n: 'Bioluz', hue: -40, sat: 2.2, bri: 0.75, tint: '#3dffd0', fx: 'bio', glow: '#3dffd0', rgb: '60,255,208', price: 90,
    desc: 'Brilha no escuro com luzinhas' },
  { id: 'magma', n: 'Magma', hue: 150, sat: 2.2, bri: 1.05, tint: '#ff6a3a', fx: 'magma', glow: '#ff7a2a', rgb: '255,120,40', price: 100,
    desc: 'Solta brasas incandescentes' },
  { id: 'volt', n: 'Elétrico', hue: 210, sat: 2.2, bri: 1.5, tint: '#ffe84a', fx: 'volt', glow: '#fff06a', rgb: '255,235,100', price: 120,
    desc: 'Faíscas e raios percorrem o corpo' },
  { id: 'rainbow', n: 'Arco-íris', hue: 0, sat: 1.6, bri: 1.15, tint: '#ffffff', fx: 'rainbow', glow: '#ffffff', rgb: '255,255,255', price: 150,
    desc: 'Muda de cor e deixa rastro colorido' },
  { id: 'galaxy', n: 'Galáxia', hue: 60, sat: 1.9, bri: 0.55, tint: '#7a4aff', fx: 'galaxy', glow: '#a07aff', rgb: '160,122,255', price: 180,
    desc: 'Estrelas cintilantes no corpo e no rastro' }
];

/* ---------- álbum de peixes ---------- */
// need: quantas vezes é preciso comer para completar; rw: moedas de recompensa
const ALBUM = (() => {
  const L = [];
  const add = (id, n, sp, img, need, rw) => L.push({ id, n, sp, img, need, rw });
  add('shrimp', 'Camarão', 'shrimp', 'shrimp', 25, 10);
  [['orange', 'laranja'], ['pink', 'rosa'], ['purple', 'roxo'], ['red', 'vermelho']].forEach(c => add('fish1_' + c[0], 'Peixinho ' + c[1], 'fish1', 'fish1_' + c[0], 12, 10));
  [['blue', 'azul'], ['green', 'verde'], ['orange', 'laranja'], ['purple', 'roxo']].forEach(c => add('fish2_' + c[0], 'Peixe ' + c[1], 'fish2', 'fish2_' + c[0], 10, 12));
  add('squid', 'Lula', 'squid', 'squid', 12, 15);
  [['blue', 'azul'], ['grey', 'cinza'], ['orange', 'laranja'], ['red', 'vermelho']].forEach(c => add('fish3_' + c[0], 'Peixe grande ' + c[1], 'fish3', 'fish3_' + c[0], 8, 15));
  add('jelly', 'Água-viva', 'jelly', 'jellyfish', 8, 20);
  add('angler', 'Peixe-pescador', 'angler', 'angler', 5, 25);
  add('diver', 'Mergulhador', 'diver', 'diver1', 5, 25);
  add('sword', 'Peixe-espada', 'sword', 'swordfish', 4, 30);
  add('saw', 'Tubarão-serra', 'saw', 'sawshark', 3, 40);
  add('gold', 'Peixe dourado', 'gold', 'gold', 30, 40);
  add('bsword', 'Rei Espada (chefe)', 'bsword', 'swordfish', 1, 50);
  add('bsaw', 'Serra Rainha (chefe)', 'bsaw', 'sawshark', 1, 80);
  return L;
})();

/* ---------- conquistas ---------- */
// test(L, R, X): L = totais da vida toda, R = partida atual, X = extras (nível, modo, onda, álbum...). prog opcional -> [atual, meta]
const ACHS = [
  { id: 'first', n: 'Primeira mordida', d: 'Coma sua primeira presa.', ico: [10, 0], rw: 5, test: L => L.eaten >= 1 },
  { id: 'eat100', n: 'Estômago de aço', d: 'Coma 100 presas (total).', ico: [9, 2], rw: 15, test: L => L.eaten >= 100, prog: L => [L.eaten, 100] },
  { id: 'eat1000', n: 'Buraco negro', d: 'Coma 1000 presas (total).', ico: [8, 0], rw: 60, test: L => L.eaten >= 1000, prog: L => [L.eaten, 1000] },
  { id: 'size4', n: 'Predador nato', d: 'Chegue ao tamanho 4.', ico: [8, 2], rw: 15, test: (L, R, X) => X.level >= 4 },
  { id: 'king', n: 'Rei dos Mares', d: 'Chegue ao tamanho 6.', ico: [0, 5], rw: 40, test: (L, R, X) => X.level >= 6 },
  { id: 'combo', n: 'Máquina de combo', d: 'Alcance PONTOS x5 em um combo.', ico: [2, 5], rw: 20, test: (L, R) => R.maxMult >= 5 },
  { id: 'chests', n: 'Caça-tesouros', d: 'Abra 15 baús (total).', ico: [0, 2], rw: 20, test: L => L.chests >= 15, prog: L => [L.chests, 15] },
  { id: 'coins', n: 'Cofre cheio', d: 'Junte 300 moedas (total).', ico: [2, 4], rw: 25, test: L => L.coins >= 300, prog: L => [L.coins, 300] },
  { id: 'boss1', n: 'Quebra-espadas', d: 'Derrote o Rei Espada.', ico: [8, 1], rw: 40, test: L => L.boss1 >= 1 },
  { id: 'boss2', n: 'Serra partida', d: 'Derrote a Serra Rainha.', ico: [8, 3], rw: 60, test: L => L.boss2 >= 1 },
  { id: 'hitless', n: 'Intocável', d: 'Derrote um chefe sem tomar dano dele.', ico: [0, 3], rw: 40, test: (L, R) => R.hitless },
  { id: 'rival', n: 'Fim da rivalidade', d: 'Derrote o tubarão rival.', ico: [8, 2], rw: 30, test: L => L.rivals >= 1 },
  { id: 'gold', n: 'Febre do ouro', d: 'Coma 15 peixes dourados em um só cardume.', ico: [10, 4], rw: 30, test: (L, R) => R.gold >= 15, prog: (L, R) => [Math.min(15, R.gold), 15] },
  { id: 'storm', n: 'Olho do furacão', d: 'Sobreviva a uma tempestade.', ico: [1, 2], rw: 25, test: L => L.storms >= 1 },
  { id: 'starve', n: 'Quase um jejum', d: 'Fique sem comer até a fome zerar e depois se recupere.', ico: [9, 3], rw: 20, test: (L, R) => R.starveOk },
  { id: 'diver10', n: 'Pescador pescado', d: 'Coma 10 mergulhadores (total).', ico: [1, 3], rw: 20, test: L => L.divers >= 10, prog: L => [L.divers, 10] },
  { id: 'hunt1', n: 'Caçador de elite', d: 'Faça 6000 pontos na Caçada.', ico: [0, 4], rw: 40, test: (L, R, X) => X.huntScore >= 6000, prog: (L, R, X) => [Math.min(6000, X.bestHunt), 6000] },
  { id: 'hunt2', n: 'Lenda da Caçada', d: 'Faça 15000 pontos na Caçada.', ico: [0, 5], rw: 80, test: (L, R, X) => X.huntScore >= 15000, prog: (L, R, X) => [Math.min(15000, X.bestHunt), 15000] },
  { id: 'wave5', n: 'Maré alta', d: 'Chegue à onda 5 na Sobrevivência.', ico: [7, 2], rw: 30, test: (L, R, X) => X.waveBest >= 5, prog: (L, R, X) => [Math.min(5, X.waveBest), 5] },
  { id: 'wave10', n: 'Imparável', d: 'Chegue à onda 10 na Sobrevivência.', ico: [7, 4], rw: 60, test: (L, R, X) => X.waveBest >= 10, prog: (L, R, X) => [Math.min(10, X.waveBest), 10] },
  { id: 'album10', n: 'Colecionador', d: 'Complete 10 páginas do álbum.', ico: [3, 3], rw: 30, test: (L, R, X) => X.albumDone >= 10, prog: (L, R, X) => [Math.min(10, X.albumDone), 10] },
  { id: 'albumall', n: 'Mestre do Álbum', d: 'Complete o álbum de peixes inteiro.', ico: [6, 4], rw: 100, test: (L, R, X) => X.albumDone >= ALBUM.length, prog: (L, R, X) => [X.albumDone, ALBUM.length] },
  { id: 'fashion', n: 'Tubarão fashion', d: 'Compre uma skin com efeitos.', ico: [1, 1], rw: 10, test: L => L.buys >= 1 }
];
