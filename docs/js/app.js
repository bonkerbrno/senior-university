import { validateFeed, playableIn } from './validate.js';
import { createPlayer } from './player.js';
import { parseAdminFile, checkPin } from './admin.js';
import { clickSound } from './click.js';

const $ = (sel) => document.querySelector(sel);
const FEED_URL = 'feed.json';
const LS_FEED = 'jukebox.feed';
const LS_SEEN = 'jukebox.seen';
const BURST_MS = 600; // rychlé vícenásobné kliknutí na totéž tlačítko se počítá jako jedno

const statusEl = $('#status');
const subEl = $('#substatus');
const listEl = $('#list');
const crumbsEl = $('#crumbs');
const stage = $('#stage');
const screenWrap = $('#screen-wrap');

let tree = [];            // kořen: pole uzlů (složky mají children)
let path = [];            // id složek od kořene k aktuální
let selected = 0;
let seen = new Set();
let automat = false;
let shuffle = null;       // null | 'here' | 'all'
let queue = [];           // seznam, ze kterého se hraje dál (složka, kde se začalo)
let qi = 0;
let now = null;           // { item, where }
let errCount = 0;
let timer = 0;

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* bez úložiště to jde také */ } }
try { seen = new Set(JSON.parse(lsGet(LS_SEEN) || '[]')); } catch { seen = new Set(); }

function say(text, warn = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('warn', warn);
}

/* ---------- strom ---------- */
function folderAt(ids) {
  let nodes = tree;
  const trail = [];
  for (const id of ids) {
    const f = nodes.find((n) => n.kind === 'folder' && n.id === id);
    if (!f) return null;
    trail.push(f);
    nodes = f.children;
  }
  return { nodes, trail };
}
function cwd() { const r = folderAt(path); return r ? r : { nodes: tree, trail: [] }; }
function newCount(nodes) {
  let n = 0;
  for (const x of nodes) n += x.kind === 'folder' ? newCount(x.children) : (seen.has(x.id) ? 0 : 1);
  return n;
}
function pathTitle(trail) { return ['Domů', ...trail.map((f) => f.title)].join(' › '); }

const player = createPlayer(stage, (state, detail) => {
  const it = now && now.item;
  if (state === 'playing') { errCount = 0; say('▶ Hraje: ' + it.title); }
  else if (state === 'paused') say('⏸ Pozastaveno: ' + it.title);
  else if (state === 'idle') { say('Nic nehraje. Vyberte pořad.'); now = null; }
  else if (state === 'ended') { say('Hotovo: ' + (it ? it.title : '')); if (automat) schedule(1200); }
  else if (state === 'error') {
    say(detail === 'embed' ? 'Tento pořad nejde přehrát.' : 'Pořad se nepodařilo spustit.', true);
    errCount++;
    if (automat && errCount < Math.max(2, poolSize())) schedule(2500);
    else timer = setTimeout(() => { if (player.state === 'error') player.stop(); }, 4000);
  }
  refresh();
});

function schedule(ms) { clearTimeout(timer); timer = setTimeout(playNext, ms); }
function poolSize() { return shuffle === 'all' ? playableIn(tree, true).length : queue.length; }

/* ---------- vykreslení (jen textContent) ---------- */
function mkBtn(act, label, iconId, index) {
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'btn'; btn.dataset.act = act;
  if (index !== undefined) btn.dataset.index = String(index);
  const lamp = document.createElement('span'); lamp.className = 'lamp';
  const lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = label;
  btn.append(lamp, lbl);
  return btn;
}

function render() {
  const { nodes, trail } = cwd();
  crumbsEl.textContent = pathTitle(trail);
  listEl.replaceChildren();
  if (selected >= nodes.length) selected = Math.max(0, nodes.length - 1);
  if (!nodes.length) {
    const e = document.createElement('div'); e.className = 'empty';
    e.textContent = tree.length ? 'Tady nic není. Použijte Zpět nebo Domů.' : 'Zatím tu nic není. Stiskněte Novinky.';
    listEl.append(e);
  }
  nodes.forEach((it, i) => {
    const folder = it.kind === 'folder';
    const card = document.createElement('article');
    card.className = 'item' + (folder ? ' folder' : ''); card.dataset.index = String(i);
    const h = document.createElement('h3');
    const fresh = folder ? newCount(it.children) : (seen.has(it.id) ? 0 : 1);
    if (fresh) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = 'NOVÉ'; h.append(b); }
    h.append(document.createTextNode(it.title));
    if (folder) { const c = document.createElement('span'); c.className = 'count'; c.textContent = '  (' + playableIn(it.children, true).length + ' pořadů)'; h.append(c); }
    card.append(h);
    if (it.note) { const p = document.createElement('p'); p.textContent = it.note; card.append(p); }
    card.append(mkBtn(folder ? 'open' : 'item', '', undefined, i));
    listEl.append(card);
  });
  refresh();
}

function isCurrent(it) { return !!now && now.item.id === it.id; }

function refresh() {
  const st = player.state;
  const active = st === 'playing' || st === 'paused';
  const { nodes, trail } = cwd();
  listEl.querySelectorAll('.item').forEach((card) => {
    const i = Number(card.dataset.index);
    const it = nodes[i];
    if (!it) return;
    const folder = it.kind === 'folder';
    const cur = !folder && active && isCurrent(it);
    card.classList.toggle('selected', i === selected);
    card.classList.toggle('playing', cur);
    const btn = card.querySelector('button');
    btn.querySelector('.lbl').textContent = folder ? 'Otevřít složku' : it.kind === 'ext' ? 'Otevřít oficiální přehrávač' : cur ? (st === 'paused' ? 'Pozastaveno – vypnout' : 'Právě hraje – vypnout') : 'Pustit tento pořad';
    if (cur) btn.dataset.lit = st === 'paused' ? 'orange' : 'green'; else delete btn.dataset.lit;
  });
  const lit = (act, color) => document.querySelectorAll('[data-act="' + act + '"]').forEach((b) => {
    if (color) b.dataset.lit = color; else delete b.dataset.lit;
  });
  lit('play', st === 'playing' ? 'green' : null);
  lit('pause', st === 'paused' ? 'orange' : null);
  lit('full', document.fullscreenElement ? 'blue' : null);
  lit('mini', document.body.classList.contains('mini') ? 'blue' : null);
  lit('auto', automat ? 'green' : null);
  lit('news', newCount(tree) ? 'green' : null);
  lit('rand-here', shuffle === 'here' ? 'blue' : null);
  lit('rand-all', shuffle === 'all' ? 'blue' : null);
  document.querySelectorAll('[data-act="back"],[data-act="home"]').forEach((b) => { b.disabled = !path.length; });
  document.querySelectorAll('[data-act="pause"] .lbl').forEach((l) => { l.textContent = st === 'paused' ? 'Pokračovat' : 'Pauza'; });
  document.querySelectorAll('[data-act="pause"],[data-act="stop"]').forEach((b) => { b.disabled = !active; });
  document.querySelectorAll('[data-act="mini"] .lbl').forEach((l) => { l.textContent = document.body.classList.contains('mini') ? 'Zvětšit' : 'Zmenšit'; });
  document.querySelectorAll('#controls [data-act="full"] .lbl').forEach((l) => { l.textContent = document.fullscreenElement ? 'Zpět' : 'Celá obrazovka'; });
  const parts = [];
  if (now) parts.push('Složka: ' + now.where);
  parts.push(automat ? 'Automat: zapnut' : 'Automat: vypnut');
  if (shuffle) parts.push(shuffle === 'all' ? 'Náhodně ze všeho' : 'Náhodně ve složce');
  subEl.textContent = parts.join('  ·  ');
}

/* ---------- navigace ---------- */
function select(i, scroll = true) {
  const { nodes } = cwd();
  if (!nodes.length) return;
  selected = Math.max(0, Math.min(nodes.length - 1, i));
  refresh();
  if (scroll) {
    const card = listEl.children[selected];
    if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}
function openFolder(i) {
  const f = cwd().nodes[i];
  if (!f || f.kind !== 'folder') return;
  path = [...path, f.id]; selected = 0; render(); listEl.scrollTop = 0;
}
function goBack() { if (path.length) { path = path.slice(0, -1); selected = 0; render(); listEl.scrollTop = 0; } }
function goHome() { if (path.length) { path = []; selected = 0; render(); listEl.scrollTop = 0; } }

/* ---------- přehrávání ---------- */
function markSeen(it) {
  seen.add(it.id);
  if (!PREVIEW) lsSet(LS_SEEN, JSON.stringify([...seen]));
}
// Oficiální přehrávač (např. ČT24): otevře se v novém okně jedním kliknutím. Okno si pamatujeme,
// aby se zavřelo, jakmile táta pustí něco jiného (jinak by hrálo přes sebe). Otevřít jde jen povolený web.
let extWin = null;
const EXT_NAME = 'ct24-superbox';
const SS_EXT = 'superbox.ext'; // okno ČT může být otevřené i po obnovení stránky, kdy odkaz na něj zapomeneme
function ssGet() { try { return sessionStorage.getItem(SS_EXT); } catch { return null; } }
function ssSet(v) { try { if (v) sessionStorage.setItem(SS_EXT, '1'); else sessionStorage.removeItem(SS_EXT); } catch { /* nic */ } }
function closeExternal() {
  // Po obnovení stránky okno najdeme podle jména (bez přechodu jinam) a zavřeme ho.
  if (!extWin && ssGet()) { try { extWin = window.open('', EXT_NAME); } catch { extWin = null; } }
  try { if (extWin && !extWin.closed) extWin.close(); } catch { /* okno už není naše */ }
  extWin = null; ssSet(false);
}
function openExternal(it) {
  player.stop(); now = null;
  closeExternal();
  extWin = window.open(it.url, EXT_NAME);
  ssSet(!!extWin);
  if (!extWin) {
    const a = document.createElement('a');
    a.href = it.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    document.body.append(a); a.click(); a.remove();
  }
  say('Otevírám: ' + it.title + ' (nové okno). Pustíte-li něco jiného, okno se samo zavře.');
}
function startItem(it, where, q, idx) {
  clearTimeout(timer);
  if (it.kind === 'ext') { openExternal(it); markSeen(it); render(); return; }
  closeExternal();
  queue = q; qi = idx;
  now = { item: it, where };
  markSeen(it);
  player.play(it);
  render();
}
function playHere(i) {
  const { nodes, trail } = cwd();
  const it = nodes[i];
  if (!it || it.kind === 'folder') return;
  const q = playableIn(nodes);
  selected = i;
  shuffle = null;
  startItem(it, pathTitle(trail), q, q.indexOf(it));
}
// Webové stránky nemají konec, proto je Automat a „náhodně“ přeskakují.
const endless = (x) => x.kind === 'web' || x.kind === 'ext';
function noWeb(a) { return a.filter((x) => !endless(x)); }
function pickRandom(pool, avoid) {
  const c = pool.length > 1 ? pool.filter((x) => !avoid || x.id !== avoid.id) : pool;
  return c[Math.floor(Math.random() * c.length)];
}
function playRandom(scope) {
  const { nodes, trail } = cwd();
  const pool = noWeb(scope === 'all' ? playableIn(tree, true) : playableIn(nodes, true));
  if (!pool.length) { say('Tady není co pustit.', true); return; }
  shuffle = scope;
  const it = pickRandom(pool, now && now.item);
  startItem(it, scope === 'all' ? 'Všechny složky' : pathTitle(trail), pool, pool.indexOf(it));
}
function playNext() {
  if (!automat || !queue.length) return;
  const pool = shuffle === 'all' ? noWeb(playableIn(tree, true)) : queue;
  if (!noWeb(pool).length) return;
  let it, idx, q = pool;
  if (shuffle) { it = pickRandom(noWeb(pool), now && now.item); idx = pool.indexOf(it); }
  else { idx = (qi + 1) % pool.length; while (endless(pool[idx])) idx = (idx + 1) % pool.length; it = pool[idx]; }
  startItem(it, now ? now.where : '', q, idx);
}

let lastFeedText = lsGet(LS_FEED) || '';
let lastSync = 0, syncing = false;
async function loadFeed(userAsked) {
  syncing = true;
  try {
    const res = await fetch(FEED_URL + '?t=' + Date.now(), { cache: 'reload', credentials: 'omit' });
    if (!res.ok) throw new Error('http');
    const text = await res.text();
    const { items } = validateFeed(text);
    const changed = text !== lastFeedText || !tree.length;
    const before = new Set(playableIn(tree, true).map((x) => x.id));
    lastSync = Date.now();
    if (changed) {
      tree = items;
      lastFeedText = text;
      lsSet(LS_FEED, text);
      if (!folderAt(path)) path = [];
      render();
    }
    const n = playableIn(tree, true).filter((x) => !before.has(x.id) && !seen.has(x.id)).length;
    if (userAsked && !(now && player.state !== 'idle')) say(newCount(tree) ? (newCount(tree) === 1 ? 'Máte jednu novinku.' : 'Máte nové pořady: ' + newCount(tree) + '.') : 'Žádné nové pořady.');
    return true;
  } catch {
    const cached = lsGet(LS_FEED);
    if (!tree.length && cached) { try { tree = validateFeed(cached).items; if (!folderAt(path)) path = []; render(); } catch { /* nic */ } }
    if (userAsked || !tree.length) say(tree.length ? 'Nejsem připojen k internetu. Ukazuji poslední seznam.' : 'Nejsem připojen k internetu.', true);
    return false;
  } finally { syncing = false; }
}
// Tichá synchronizace: kdykoli táta na něco klikne (nejvýš jednou za 15 s), vrátí se do aplikace nebo uplyne pár minut, stáhne se čerstvý seznam.
function maybeSync() { if (!PREVIEW && !syncing && Date.now() - lastSync > 2000) { loadFeed(false); checkCode(); } }

// Aktuální program: soubory aplikace se při startu zapamatují; když se na serveru změní a nic nehraje, stránka se sama načte znovu.
const CODE_FILES = ['./', 'js/app.js', 'js/player.js', 'js/validate.js', 'css/jukebox.css'];
const codeSnap = new Map();
let checking = false;
async function checkCode() {
  if (checking) return;
  checking = true;
  try {
    let changed = false;
    for (const f of CODE_FILES) {
      const res = await fetch(f + '?t=' + Date.now(), { cache: 'reload', credentials: 'omit' });
      if (!res.ok) return;
      const text = await res.text();
      if (!codeSnap.has(f)) codeSnap.set(f, text); else if (codeSnap.get(f) !== text) changed = true;
    }
    if (changed && (!now || player.state === 'idle')) location.reload();
  } catch { /* bez připojení nic neděláme */ } finally { checking = false; }
}

/* ---------- akce ---------- */
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await screenWrap.requestFullscreen();
  } catch { say('Celou obrazovku se nepodařilo zapnout.', true); }
  refresh();
}
// Přeladit: další pořad v seznamu, kde se hraje (dokola); bez hrajícího pořadu další ve složce.
function tune() {
  clearTimeout(timer);
  if (now && queue.length) {
    const idx = (qi + 1) % queue.length;
    startItem(queue[idx], now.where, queue, idx);
    return;
  }
  const { nodes } = cwd();
  let i = selected;
  for (let k = 1; k <= nodes.length; k++) {
    const j = (selected + k) % nodes.length;
    if (nodes[j].kind !== 'folder') { i = j; break; }
  }
  if (nodes[i] && nodes[i].kind !== 'folder') playHere(i);
}
// Seznam kanálů: zpět na výchozí vzhled (konec celé obrazovky a lišty), hraní pokračuje, seznam ukáže právě hrající.
function showChannels() {
  document.body.classList.remove('mini');
  const done = () => { render(); const c = listEl.querySelector('.item.playing'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'center' }); };
  if (document.fullscreenElement) document.exitFullscreen().then(done, done); else done();
}
function toggleMini() { document.body.classList.toggle('mini'); refresh(); }
function sleep() {
  clearTimeout(timer);
  closeExternal();
  automat = false; shuffle = null;
  player.stop();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  document.body.classList.remove('mini');
  $('#asleep').hidden = false;
  $('#app').hidden = true;
  $('#asleep .btn').focus();
  try { window.close(); } catch { /* prohlížeč nedovolí zavřít okno; zůstane obrazovka „odpočívá“ */ }
}
function wake() { $('#asleep').hidden = true; $('#app').hidden = false; refresh(); }
function playSelected() {
  const it = cwd().nodes[selected];
  if (!it) { say('Nejdřív stiskněte Novinky.', true); return; }
  if (it.kind === 'folder') openFolder(selected); else playHere(selected);
}
function toggleRandom(scope) {
  if (shuffle === scope) { shuffle = null; refresh(); } else playRandom(scope);
}

const actions = {
  news: () => { say('Hledám novinky…'); return loadFeed(true); },
  play: playSelected,
  pause: () => { if (player.state === 'paused') player.resume(); else player.pause(); },
  stop: () => { clearTimeout(timer); player.stop(); closeExternal(); },
  full: toggleFullscreen,
  tune,
  channels: showChannels,
  mini: toggleMini,
  close: sleep,
  wake,
  auto: () => { automat = !automat; if (!automat) clearTimeout(timer); refresh(); },
  'rand-here': () => toggleRandom('here'),
  'rand-all': () => toggleRandom('all'),
  home: goHome,
  back: goBack,
  up: () => select(selected - 1),
  down: () => select(selected + 1),
};

document.addEventListener('pointerdown', (ev) => { if (ev.target.closest && ev.target.closest('button:not(:disabled)')) clickSound(); });
const lastClick = new Map();
document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-act]');
  if (btn) {
    const act = btn.dataset.act;
    const key = act + (btn.dataset.index || '');
    const t = Date.now();
    const burst = t - (lastClick.get(key) || 0) < BURST_MS;
    lastClick.set(key, t);
    if (burst) return; // jedno kliknutí, dvojklik i rychlé vícenásobné klikání dělají totéž
    const i = Number(btn.dataset.index);
    if (act === 'item') {
      const it = cwd().nodes[i];
      if (it && isCurrent(it) && player.state !== 'idle') { clearTimeout(timer); player.stop(); } else playHere(i);
    } else if (act === 'open') openFolder(i);
    else if (actions[act]) actions[act]();
    return;
  }
  const card = ev.target.closest('.item');
  if (card) select(Number(card.dataset.index), false);
});

document.addEventListener('keydown', (ev) => {
  if (ev.target.closest && ev.target.closest('button')) return;
  if (ev.key === 'ArrowDown') { ev.preventDefault(); select(selected + 1); }
  else if (ev.key === 'ArrowUp') { ev.preventDefault(); select(selected - 1); }
  else if (ev.key === 'Enter') { ev.preventDefault(); playSelected(); }
  else if (ev.key === 'Backspace') { ev.preventDefault(); goBack(); }
  else if (ev.key === ' ') { ev.preventDefault(); actions.pause(); }
});
document.addEventListener('fullscreenchange', refresh);

/* ---------- skrytý vstup správce ---------- */
// Pět rychlých kliknutí na první hvězdičku v nápisu, nebo Ctrl+Alt+Shift+A.
const PREVIEW = new URLSearchParams(location.search).get('preview') === '1';
let secretClicks = [];
async function openAdmin() {
  if (PREVIEW) return;
  let admin = null;
  try {
    const r = await fetch('admin.json?t=' + Date.now(), { cache: 'no-store', credentials: 'omit' });
    if (r.ok) admin = parseAdminFile(await r.text());
  } catch { /* bez admin.json = bez PINu */ }
  if (!admin) { location.href = 'editor/'; return; }
  askPin(admin);
}
function askPin(admin) {
  const box = $('#pin'), pad = $('#pinpad'), dots = $('#pin-dots'), msg = $('#pin-msg');
  let val = '';
  const draw = () => { dots.textContent = val ? '●'.repeat(val.length) : '—'; };
  const close = () => { box.hidden = true; pad.textContent = ''; };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Zrušit', '0', 'OK'];
  pad.textContent = '';
  for (const k of keys) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pinkey'; b.textContent = k;
    b.addEventListener('click', async () => {
      if (k === 'Zrušit') { close(); return; }
      if (k === 'OK') {
        const ok = await checkPin(val, admin);
        if (ok) { close(); location.href = 'editor/'; } else { val = ''; msg.textContent = 'Špatný PIN.'; draw(); }
        return;
      }
      if (val.length < 8) { val += k; msg.textContent = ''; draw(); }
    });
    pad.append(b);
  }
  msg.textContent = 'Zadejte PIN správce';
  draw(); box.hidden = false;
}
$('#secret').addEventListener('click', () => {
  const t = Date.now();
  secretClicks = secretClicks.filter((x) => t - x < 3000); secretClicks.push(t);
  if (secretClicks.length >= 5) { secretClicks = []; openAdmin(); }
});
document.addEventListener('keydown', (ev) => {
  if (ev.ctrlKey && ev.altKey && ev.shiftKey && ev.key.toLowerCase() === 'a') { ev.preventDefault(); openAdmin(); }
});

/* ---------- náhled „jako táta“ (jen uvnitř editoru, stejný původ) ---------- */
if (PREVIEW) {
  window.addEventListener('message', (ev) => {
    if (ev.origin !== location.origin || ev.source !== window.parent || !ev.data || ev.data.type !== 'draft' || typeof ev.data.feed !== 'string') return;
    try { tree = validateFeed(ev.data.feed).items; if (!folderAt(path)) path = []; render(); say('Náhled: tak to uvidí táta.'); } catch { say('Náhled: seznam je neplatný.', true); }
  });
  window.parent.postMessage({ type: 'ready' }, location.origin);
  document.title += ' – náhled';
}

/* ---------- start ---------- */
render();
if (!PREVIEW) {
  loadFeed(false);
  checkCode();
  document.addEventListener('click', () => setTimeout(maybeSync, 400));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) maybeSync(); });
  window.addEventListener('focus', maybeSync);
  window.addEventListener('online', () => loadFeed(false));
  setInterval(maybeSync, 3 * 60 * 1000);
}
