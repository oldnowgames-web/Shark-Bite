'use strict';
/* =====================================================================
   SHARK BITE — progresso salvo (moedas, skins compradas, conquistas, álbum) e telas de menu
   Carregado depois de data.js e antes de game.js (mesmo escopo global).
   ===================================================================== */
const PKEY = 'sb_prof2';
const ALBUM_BY = {};
ALBUM.forEach(a => { ALBUM_BY[a.id] = a; });

/* ---------- perfil salvo ---------- */
const P = (() => {
  const d = store.get(PKEY, null) || {};
  const p = {
    wallet: d.wallet | 0, L: d.L || {}, ach: d.ach || {}, album: d.album || {}, albumDone: d.albumDone || {}, owned: d.owned || {},
    skin: d.skin || null, lastMode: d.lastMode || 'classic',
    best: Object.assign({ classic: 0, hunt: 0, surv: 0, wave: 0 }, d.best || {})
  };
  ['eaten', 'chests', 'coins', 'boss1', 'boss2', 'rivals', 'storms', 'divers', 'buys', 'games'].forEach(k => { p.L[k] = p.L[k] | 0; });
  SKINS.forEach(s => { if (!s.price) p.owned[s.id] = true; });
  if (!p.skin || !SKINS.some(s => s.id === p.skin)) {
    const old = store.get('sb_skin', 0) | 0;
    p.skin = SKINS[old] && !SKINS[old].price ? SKINS[old].id : 'classic';
  }
  if (!d.best) p.best.classic = Math.max(store.get('sb_best', 0), store.get('tf_best', 0));
  return p;
})();

/* ---------- avisos (toasts) ---------- */
const toastQ = [];
let toastBusy = 0;
function toast(title, text, ico) {
  toastQ.push({ title, text, ico: ico || [2, 4] });
  pumpToast();
}
function pumpToast() {
  const box = $('toasts');
  if (!box || toastBusy >= 3 || !toastQ.length) return;
  const q = toastQ.shift();
  toastBusy++;
  const d = document.createElement('div');
  d.className = 'toast';
  d.innerHTML = '<span class="ico" style="--r:' + q.ico[0] + ';--c:' + q.ico[1] + '"></span><div><b>' + q.title + '</b><small>' + q.text + '</small></div>';
  box.appendChild(d);
  setTimeout(() => { d.remove(); toastBusy--; pumpToast(); }, 3600);
}

/* ---------- Meta: contadores, conquistas e álbum ---------- */
const Meta = {
  dirty: false, lastSave: 0, onUnlock: null,
  touch() { this.dirty = true; },
  save(force) {
    const now = performance.now();
    if (!this.dirty || (!force && now - this.lastSave < 3000)) return;
    this.dirty = false; this.lastSave = now; store.set(PKEY, P);
  },
  add(k, n) { P.L[k] = (P.L[k] | 0) + (n === undefined ? 1 : n); this.dirty = true; },
  coin(n) { P.wallet += n; P.L.coins += n; this.dirty = true; },
  albumDoneCount() { return Object.keys(P.albumDone).length; },
  // comeu algo: conta no total e no álbum. Devolve a página do álbum se ela acabou de ser completada.
  eat(id) {
    P.L.eaten++; if (id === 'diver') P.L.divers++;
    return this.album(id);
  },
  album(id) {
    const e = ALBUM_BY[id]; if (!e) return null;
    const n = (P.album[id] | 0) + 1; P.album[id] = n; this.dirty = true;
    if (n >= e.need && !P.albumDone[id]) {
      P.albumDone[id] = 1; P.wallet += e.rw;
      toast('Álbum: ' + e.n, 'Página completa! +' + e.rw + ' moedas', [3, 3]);
      if (this.onUnlock) this.onUnlock(e);
      return e;
    }
    return null;
  },
  check(Rn, X) {
    let any = false;
    for (const a of ACHS) {
      if (P.ach[a.id]) continue;
      let ok = false;
      try { ok = !!a.test(P.L, Rn || {}, X || {}); } catch (e) { ok = false; }
      if (ok) {
        P.ach[a.id] = 1; P.wallet += a.rw; any = true;
        toast('Conquista: ' + a.n, a.d + ' +' + a.rw + ' moedas', a.ico);
        if (this.onUnlock) this.onUnlock(a);
      }
    }
    if (any) this.dirty = true;
  }
};
window.addEventListener('pagehide', () => Meta.save(true));
document.addEventListener('visibilitychange', () => { if (document.hidden) Meta.save(true); });

/* ---------- tela: modos de jogo ---------- */
function bestLine(id) {
  if (id === 'classic') return 'Recorde: ' + P.best.classic;
  if (id === 'hunt') return 'Recorde: ' + P.best.hunt;
  return 'Melhor: onda ' + P.best.wave + ' — ' + P.best.surv + ' pts';
}
function buildModes() {
  const box = $('modeList'); box.innerHTML = '';
  MODE_IDS.forEach(id => {
    const m = MODES[id], b = document.createElement('button');
    b.className = 'mode-card';
    b.innerHTML = '<span class="ico" style="--r:' + m.icon[0] + ';--c:' + m.icon[1] + '"></span><span class="mc-t"><b>' + m.name + '</b><small>' + m.desc + '</small><em>' + bestLine(id) + '</em></span>';
    b.addEventListener('click', () => { ac(); startMusic(); startGame(id); b.blur(); });
    box.appendChild(b);
  });
}

/* ---------- tela: skins (com preço e efeitos) ---------- */
let skinCards = [];
const curSkinIdx = () => Math.max(0, SKINS.findIndex(s => s.id === P.skin));
function buildSkinGrid() {
  const grid = $('skinGrid'); grid.innerHTML = ''; skinCards = [];
  SKINS.forEach((sk, i) => {
    const b = document.createElement('button'); b.className = 'skin-card';
    const c = document.createElement('canvas'); c.width = 48; c.height = 48;
    const n = document.createElement('span'); n.className = 'sk-n'; n.textContent = sk.n;
    const sub = document.createElement('span'); sub.className = 'sk-sub';
    b.appendChild(c); b.appendChild(n); b.appendChild(sub); grid.appendChild(b);
    b.addEventListener('click', () => onSkinClick(i, b));
    skinCards.push(c);
  });
  refreshSkins();
}
function onSkinClick(i, b) {
  ac(); startMusic();
  const sk = SKINS[i], msg = $('skinMsg');
  if (P.owned[sk.id]) {
    P.skin = sk.id; SFX.click(); msg.textContent = sk.n + ' equipada!';
  } else if (P.wallet >= sk.price) {
    P.wallet -= sk.price; P.owned[sk.id] = true; P.skin = sk.id; Meta.add('buys');
    SFX.chest(); msg.textContent = 'Comprou a skin ' + sk.n + '!';
    Meta.check(R, curX());
  } else {
    SFX.hurt(); msg.textContent = 'Faltam ' + (sk.price - P.wallet) + ' moedas para ' + sk.n + '.';
    b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
  }
  Meta.touch(); Meta.save(true); refreshSkins(); applyTitleSkin(); b.blur();
}
function refreshSkins() {
  $('walletSkins').textContent = P.wallet; $('walletMenu').textContent = P.wallet;
  [...$('skinGrid').children].forEach((b, i) => {
    const sk = SKINS[i], own = !!P.owned[sk.id], sel = P.skin === sk.id;
    b.classList.toggle('sel', sel); b.classList.toggle('locked', !own);
    b.querySelector('.sk-sub').textContent = sel ? 'Em uso' : own ? (sk.desc || 'Sua') : sk.price + ' moedas' + (sk.desc ? ' — ' + sk.desc : '');
  });
}

/* ---------- tela: conquistas ---------- */
function buildAchList() {
  const X = typeof curX === 'function' ? curX() : {}, Rn = typeof R === 'object' && R ? R : {};
  const box = $('achList'); box.innerHTML = '';
  let done = 0;
  ACHS.forEach(a => {
    const ok = !!P.ach[a.id]; if (ok) done++;
    let pr = '';
    if (a.prog && !ok) {
      let c = 0, m = 1; try { [c, m] = a.prog(P.L, Rn, X); } catch (e) { /* sem progresso */ }
      c = Math.min(m, Math.max(0, c | 0));
      pr = '<div class="mini-bar"><i style="width:' + (c / m * 100) + '%"></i></div><em>' + c + ' / ' + m + '</em>';
    }
    const d = document.createElement('div'); d.className = 'ach' + (ok ? ' done' : '');
    d.innerHTML = '<span class="ico" style="--r:' + a.ico[0] + ';--c:' + a.ico[1] + '"></span><span class="at"><b>' + a.n + '</b><small>' + a.d + '</small>' + pr + '</span><span class="rw">' + (ok ? '✔' : '+' + a.rw) + '</span>';
    box.appendChild(d);
  });
  $('achSum').textContent = done + ' de ' + ACHS.length + ' conquistas';
}

/* ---------- tela: álbum de peixes ---------- */
function buildAlbum() {
  const box = $('albumGrid'); box.innerHTML = '';
  const total = ALBUM.length, done = Meta.albumDoneCount();
  ALBUM.forEach(a => {
    const n = P.album[a.id] | 0, ok = !!P.albumDone[a.id], seen = n > 0;
    const d = document.createElement('div'); d.className = 'al-card' + (ok ? ' done' : seen ? '' : ' unseen');
    const c = document.createElement('canvas'); c.width = 56; c.height = 36;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    const sp = SP[a.sp], im = IMG[a.img];
    if (im && im.width) {
      const sc = Math.min(52 / sp.fw, 32 / sp.fh);
      g.drawImage(im, 0, sp.rows[0] * sp.fh, sp.fw, sp.fh, (56 - sp.fw * sc) / 2, (36 - sp.fh * sc) / 2, sp.fw * sc, sp.fh * sc);
      if (!seen) { g.globalCompositeOperation = 'source-in'; g.fillStyle = '#1a2058'; g.fillRect(0, 0, 56, 36); }
    }
    const nm = document.createElement('b'); nm.textContent = seen ? a.n : '???';
    const pr = document.createElement('small'); pr.textContent = ok ? 'Completo!' : Math.min(n, a.need) + ' / ' + a.need;
    d.appendChild(c); d.appendChild(nm); d.appendChild(pr); box.appendChild(d);
  });
  $('albumSum').textContent = done + ' de ' + total + ' páginas completas — coma cada espécie várias vezes!';
}
