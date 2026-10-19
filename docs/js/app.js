import { validateFeed, playableIn } from './validate.js';
import { createPlayer } from './player.js';
import { parseAdminFile, checkPin } from './admin.js';
import { clickSound } from './click.js';

const $ = (sel) => document.querySelector(sel);
const FEED_URL = 'feed.json';
const LS_FEED = 'jukebox.feed';
const LS_SEEN = 'jukebox.seen';
const LS_FAV = 'jukebox.fav';
const LS_SUBS = 'jukebox.subs';
const BURST_MS = 600; // rychlé vícenásobné kliknutí na totéž tlačítko se počítá jako jedno

// Mobilní verze: stejná data a stejný přehrávač, jen tři obrazovky (start, program = seznam, play = přehrávání).
const qs = new URLSearchParams(location.search);
const MOBILE = qs.get('mobil') === '1' || (qs.get('pc') !== '1' && matchMedia('(hover: none) and (pointer: coarse) and (max-width: 1000px)').matches);
if (MOBILE) document.body.classList.add('m');
// V celé aplikaci se místo „složka“ a „pořad“ říká „program“. Vyrábí se jen z textů aplikace, nikdy z názvů od Stanleyho.
const WORDS = [[/pořadů/g, 'programů'], [/pořady/g, 'programy'], [/Pořady/g, 'Programy'], [/pořad/g, 'program'], [/Pořad/g, 'Program'],
  [/Otevřít složku/g, 'Otevřít program'], [/Všechny složky/g, 'Všechny programy'], [/Složka: /g, 'Program: '], [/ve složce/g, 'v programu'],
  [/Stiskněte Novinky/g, 'Stiskněte Nové'], [/stiskněte Novinky/g, 'stiskněte Nové']];
const PREVIEW_MODE = qs.get('preview') === '1';
const m = (t) => WORDS.reduce((x, [re, to]) => x.replace(re, to), t);

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
let screen = 'play';      // jen mobil: play (domovská) | list
let powered = true;       // false = jukebox spí (vše zešedlo, zůstane jen lišta se Zapnout)
let favs = new Set();
let subs = lsGet(LS_SUBS) === '1';

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* bez úložiště to jde také */ } }
try { seen = new Set(JSON.parse(lsGet(LS_SEEN) || '[]')); } catch { seen = new Set(); }
try { favs = new Set(JSON.parse(lsGet(LS_FAV) || '[]')); } catch { favs = new Set(); }

function say(text, warn = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('warn', warn);
}

/* ---------- strom ---------- */
// Mobil: na začátku seznamu jsou programy „Novinky“ a „Oblíbené“. Obsahují tytéž položky jako programy, ve kterých leží (duplicitně).
function rootNodes() {
  if (!MOBILE) return tree;
  const all = playableIn(tree, true);
  const fresh = all.filter((x) => !seen.has(x.id));
  const fav = all.filter((x) => favs.has(x.id));
  const v = [];
  if (fresh.length) v.push({ kind: 'folder', id: '__news', title: 'Novinky', note: '', children: fresh });
  if (fav.length) v.push({ kind: 'folder', id: '__fav', title: 'Oblíbené', note: '', children: fav });
  return v.length ? [...v, ...tree] : tree;
}
function folderAt(ids) {
  let nodes = rootNodes();
  const trail = [];
  for (const id of ids) {
    const f = nodes.find((n) => n.kind === 'folder' && n.id === id);
    if (!f) return null;
    trail.push(f);
    nodes = f.children;
  }
  return { nodes, trail };
}
function cwd() { const r = folderAt(path); return r ? r : { nodes: rootNodes(), trail: [] }; }
function newCount(nodes) {
  let n = 0;
  for (const x of nodes) n += x.kind === 'folder' ? newCount(x.children) : (seen.has(x.id) ? 0 : 1);
  return n;
}
function pathTitle(trail) { return ['Domů', ...trail.map((f) => f.title)].join(' › '); }

const player = createPlayer(stage, { idleText: m('Vyberte pořad a stiskněte Pustit') }, (state, detail) => {
  const it = now && now.item;
  if (state === 'playing') { errCount = 0; say('▶ Hraje: ' + it.title); }
  else if (state === 'paused') say('⏸ Pozastaveno: ' + it.title);
  else if (state === 'idle') { say(m('Nic nehraje. Vyberte pořad.')); now = null; }
  else if (state === 'ended') { say('Hotovo: ' + (it ? it.title : '')); if (automat) schedule(1200); }
  else if (state === 'error') {
    say(m(detail === 'embed' ? 'Tento pořad nejde přehrát.' : 'Pořad se nepodařilo spustit.'), true);
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
  if (MOBILE) { renderTree(); refresh(); return; }
  const { nodes, trail } = cwd();
  crumbsEl.textContent = pathTitle(trail);
  listEl.replaceChildren();
  if (selected >= nodes.length) selected = Math.max(0, nodes.length - 1);
  if (!nodes.length) {
    const e = document.createElement('div'); e.className = 'empty';
    e.textContent = m(tree.length ? 'Tady nic není. Použijte Zpět nebo Domů.' : 'Zatím tu nic není. Stiskněte Novinky.');
    listEl.append(e);
  }
  nodes.forEach((it, i) => {
    const folder = it.kind === 'folder';
    const card = document.createElement('article');
    card.className = 'item' + (folder ? ' folder' : ''); card.dataset.index = String(i);
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn';
    btn.dataset.act = folder ? 'open' : 'item'; btn.dataset.index = String(i);
    const lamp = document.createElement('span'); lamp.className = 'lamp';
    const h = document.createElement('span'); h.className = 'ttl';
    const fresh = folder ? newCount(it.children) : (seen.has(it.id) ? 0 : 1);
    if (fresh) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = 'NOVÉ'; h.append(b); }
    h.append(document.createTextNode(it.title));
    if (folder) { const c = document.createElement('span'); c.className = 'count'; c.textContent = '  (' + playableIn(it.children, true).length + ' programů)'; h.append(c); }
    btn.append(lamp, h);
    if (it.note) { const p = document.createElement('span'); p.className = 'note'; p.textContent = it.note; btn.append(p); }
    card.append(btn);
    listEl.append(card);
  });
  refresh();
}

function isCurrent(it) { return !!now && now.item.id === it.id; }

function refresh() {
  document.body.dataset.power = powered ? 'on' : 'off';
  document.querySelectorAll('[data-act="close"] .lbl').forEach((l) => { l.textContent = powered ? 'Vypnout' : 'Zapnout'; });
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
    btn.setAttribute('aria-label', it.title + '. ' + m(folder ? 'Otevřít složku' : it.kind === 'ext' ? 'Otevřít oficiální přehrávač' : cur ? (st === 'paused' ? 'Pozastaveno – vypnout' : 'Právě hraje – vypnout') : 'Pustit tento pořad'));
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
  document.querySelectorAll('[data-act="back"],[data-act="home"]').forEach((b) => { b.disabled = !MOBILE && !path.length; });
  document.querySelectorAll('[data-act="pause"] .lbl').forEach((l) => { l.textContent = st === 'paused' ? 'Pokračovat' : (MOBILE ? 'Pozastavit' : 'Pauza'); });
  document.querySelectorAll('[data-act="pause"],[data-act="stop"]').forEach((b) => { b.disabled = !active; });
  document.querySelectorAll('[data-act="mini"] .lbl').forEach((l) => { l.textContent = document.body.classList.contains('mini') ? 'Zvětšit' : 'Zmenšit'; });
  document.querySelectorAll('#controls [data-act="full"] .lbl').forEach((l) => { l.textContent = document.fullscreenElement ? 'Zpět' : 'Celá obrazovka'; });
  const parts = [];
  if (now) parts.push(m('Složka: ') + now.where);
  parts.push(automat ? 'Automat: zapnut' : 'Automat: vypnut');
  if (shuffle) parts.push(m(shuffle === 'all' ? 'Náhodně ze všeho' : 'Náhodně ve složce'));
  subEl.textContent = MOBILE ? (now ? now.where : 'Stiskněte Programy') : parts.join('  ·  ');
  if (MOBILE) refreshMobile(); else refreshDesktop();
}
function refreshDesktop() {
  const pl = player.state === 'playing';
  const lit = (act, color) => document.querySelectorAll('[data-act="' + act + '"]').forEach((b) => { if (color) b.dataset.lit = color; else delete b.dataset.lit; });
  lit('pp', pl ? 'green' : player.state === 'paused' ? 'orange' : null);
  document.querySelectorAll('[data-act="pp"]').forEach((b) => { b.querySelector('.lbl').textContent = pl ? 'Pozastavit' : 'Pustit'; b.querySelector('use').setAttribute('href', pl ? '#i-pause' : '#i-play'); });
  lit('subs', subs ? 'green' : null);
  lit('shuf', shuffle ? 'blue' : null);
  lit('full', 'blue');
  document.querySelectorAll('#d-row [data-act="full"] .lbl').forEach((l) => { l.textContent = document.fullscreenElement ? 'Zmenšit' : 'Celá obrazovka'; });
  document.querySelectorAll('#d-row [data-act="full"] use').forEach((u) => u.setAttribute('href', document.fullscreenElement ? '#i-mini' : '#i-full'));
}

/* ---------- mobil ---------- */
function setScreen(name) {
  screen = name;
  document.body.dataset.screen = name;
  if (name !== 'list') document.body.classList.remove('mini');
}
function showList() { setScreen('list'); }

/* Strom programů: složky se rozbalují na místě, programy jsou odsazené pod nimi. Klíč řádku je cesta z id od kořene. */
const expanded = new Set();
let openOrder = [];       // v jakém pořadí se složky rozbalily (Zpět je sbaluje od poslední)
const rowMap = new Map(); // klíč řádku -> { node, siblings, trail }
function chainFor(id, nodes = tree, prefix = '') {
  for (const n of nodes) {
    const key = prefix + '/' + n.id;
    if (n.kind === 'folder') { const sub = chainFor(id, n.children, key); if (sub) return [key, ...sub]; } else if (n.id === id) return [];
  }
  return null;
}
function collapse(key) {
  for (const k of [...expanded]) if (k === key || k.startsWith(key + '/')) expanded.delete(k);
  openOrder = openOrder.filter((k) => expanded.has(k));
}
function expand(key) { if (!expanded.has(key)) { expanded.add(key); openOrder.push(key); } }
function renderTree() {
  rowMap.clear();
  listEl.replaceChildren();
  const rows = [];
  const walk = (nodes, trail, prefix) => {
    for (const n of nodes) {
      const key = prefix + '/' + n.id;
      rowMap.set(key, { node: n, siblings: nodes, trail });
      rows.push({ key, node: n, depth: trail.length });
      if (n.kind === 'folder' && expanded.has(key)) walk(n.children, [...trail, n], key);
    }
  };
  walk(rootNodes(), [], '');
  if (!rows.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Zatím tu nic není. Stiskněte Nové.'; listEl.append(e); }
  for (const { key, node, depth } of rows) {
    const folder = node.kind === 'folder';
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'trow d' + Math.min(depth, 5) + (folder ? ' folder' : ''); b.dataset.act = 'trow'; b.dataset.key = key;
    if (folder) b.setAttribute('aria-expanded', String(expanded.has(key)));
    const mark = document.createElement('span'); mark.className = 'mark'; mark.textContent = folder ? (expanded.has(key) ? '▾' : '▸') : '♪';
    const title = document.createElement('span'); title.className = 'tt';
    const fresh = folder ? newCount(node.children) : (seen.has(node.id) ? 0 : 1);
    if (fresh) { const bd = document.createElement('span'); bd.className = 'badge'; bd.textContent = 'NOVÉ'; title.append(bd); }
    title.append(document.createTextNode(node.title));
    if (folder) { const c = document.createElement('span'); c.className = 'count'; c.textContent = ' (' + playableIn(node.children, true).length + ')'; title.append(c); }
    b.append(mark, title);
    listEl.append(b);
  }
}
function tapRow(key) {
  const row = rowMap.get(key);
  if (!row) return;
  const it = row.node;
  if (it.kind === 'folder') {
    if (expanded.has(key)) collapse(key); else expand(key);
    render();
    const el = [...listEl.querySelectorAll('.trow')].find((x) => x.dataset.key === key);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (isCurrent(it) && (player.state === 'playing' || player.state === 'paused')) { leaveList(); return; }
  const q = playableIn(row.siblings);
  shuffle = null;
  startItem(it, pathTitle(row.trail), q, q.indexOf(it));
}
function showListAtPlaying() {
  if (now) chainFor(now.item.id).forEach(expand);
  setScreen('list'); render();
  const row = listEl.querySelector('.trow.playing');
  if (row && row.scrollIntoView) row.scrollIntoView({ block: 'center' });
}
function markTree() {
  const active = player.state === 'playing' || player.state === 'paused';
  listEl.querySelectorAll('.trow').forEach((el) => {
    const row = rowMap.get(el.dataset.key);
    el.classList.toggle('playing', !!(active && now && row && row.node.kind !== 'folder' && row.node.id === now.item.id));
  });
}
function refreshMobile() {
  document.body.dataset.power = powered ? 'on' : 'off';
  markTree();
  $('#marquee').textContent = 'Programy';
  const set = (key, on, yes, no) => document.querySelectorAll('[data-flag="' + key + '"]').forEach((b) => {
    b.textContent = on ? yes : no; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
  });
  set('auto', automat, 'Hraje automaticky', 'Přehraje jeden');
  set('subs', subs, 'Titulky zapnuty', 'Titulky vypnuty');
  set('shuf', !!shuffle, 'Náhodné pořadí', 'Hraje za sebou');
  const lit = (act, color) => document.querySelectorAll('[data-act="' + act + '"]').forEach((b) => { if (color) b.dataset.lit = color; else delete b.dataset.lit; });
  lit('shuf', shuffle ? 'blue' : null);
  lit('full', 'blue');
  document.querySelectorAll('[data-act="full"] .lbl').forEach((l) => { l.textContent = document.fullscreenElement ? 'Zmenšit' : 'Celá obrazovka'; });
  lit('subs', subs ? 'green' : null);
  lit('pp', player.state === 'playing' ? 'green' : player.state === 'paused' ? 'orange' : null);
  document.querySelectorAll('[data-act="pp"]').forEach((b) => { const pl = player.state === 'playing'; b.querySelector('.lbl').textContent = pl ? 'Pozastavit' : 'Pustit'; b.querySelector('use').setAttribute('href', pl ? '#i-pause' : '#i-play'); });
  const target = now ? now.item : null;
  lit('fav', screen === 'play' && target && favs.has(target.id) ? 'red' : null);
  document.querySelectorAll('.fs-bar [data-act="channels"] .lbl').forEach((l) => { l.textContent = 'Seznam programů'; });
  document.querySelectorAll('[data-act="close"] .lbl').forEach((l) => { l.textContent = powered ? 'Vypnout' : 'Zapnout'; });
  document.querySelectorAll('[data-act="pause"],[data-act="stop"]').forEach((b) => { b.disabled = !(player.state === 'playing' || player.state === 'paused'); });
}
function toggleFav() {
  const it = now ? now.item : null;
  if (screen === 'play' && it) {
    if (favs.has(it.id)) { favs.delete(it.id); say('Odebráno z oblíbených.'); } else { favs.add(it.id); say('Přidáno do oblíbených.'); }
    lsSet(LS_FAV, JSON.stringify([...favs]));
    render();
    return;
  }
  if (!favs.size) { say('Zatím nemáte žádné oblíbené. Při přehrávání stiskněte srdce.', true); return; }
  expand('/__fav'); showList(); render();
  const el = [...listEl.querySelectorAll('.trow')].find((x) => x.dataset.key === '/__fav'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
}
function offerSomething() {
  const all = noWeb(playableIn(tree, true));
  const fav = all.filter((x) => favs.has(x.id));
  const pool = fav.length ? fav : all;
  if (!pool.length) { say('Zatím není co nabídnout.', true); return; }
  shuffle = null;
  const it = pickRandom(pool, now && now.item);
  startItem(it, fav.length ? 'Oblíbené' : m('Všechny složky'), pool, pool.indexOf(it));
}
function toggleSubs() {
  subs = !subs; lsSet(LS_SUBS, subs ? '1' : '0');
  const it = now ? now.item : null;
  if (it && player.state !== 'idle') {
    if (it.kind === 'youtube') { player.play(it, { subs }); say((subs ? 'Titulky zapnuty' : 'Titulky vypnuty') + '. Program se spustil znovu.'); }
    else say('Tento program nemá titulky.', true);
  }
  refresh();
}
function toggleShuffle() {
  if (shuffle) shuffle = null;
  else if (now && queue.length) shuffle = 'here';
  else { playRandom('here'); return; }
  refresh();
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
function leaveList() { setScreen('play'); refresh(); }
function goBack() { if (MOBILE) { const k = openOrder[openOrder.length - 1]; if (k) { collapse(k); render(); } else leaveList(); return; } if (path.length) { path = path.slice(0, -1); selected = 0; render(); listEl.scrollTop = 0; } }
function goHome() { if (MOBILE) { if (expanded.size) { expanded.clear(); openOrder = []; render(); listEl.scrollTop = 0; } else leaveList(); return; } if (path.length) { path = []; selected = 0; render(); listEl.scrollTop = 0; } }

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
  if (MOBILE) { document.body.classList.remove('fakefs'); setScreen('play'); }
  player.play(it, { subs });
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
  startItem(it, scope === 'all' ? m('Všechny složky') : pathTitle(trail), pool, pool.indexOf(it));
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
    if (userAsked && !(now && player.state !== 'idle')) say(newCount(tree) ? (newCount(tree) === 1 ? 'Máte jednu novinku.' : m('Máte nové pořady: ') + newCount(tree) + '.') : m('Žádné nové pořady.'));
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
const CODE_FILES = ['./', 'js/app.js', 'js/player.js', 'js/validate.js', 'css/jukebox.css', 'css/mobile.css'];
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
  if (MOBILE) {
    // Celá aplikace (ne jen video), aby zmizel i panel prohlížeče. Bez dotyku to prohlížeč nepovolí.
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      else say('Tento prohlížeč celou obrazovku neumí. Přidejte stránku na plochu.', true);
    } catch { say('Celou obrazovku se nepodařilo zapnout.', true); }
    refresh();
    return;
  }
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
  if (MOBILE) {
    document.body.classList.remove('fakefs');
    const go = () => showListAtPlaying();
    if (document.fullscreenElement) document.exitFullscreen().then(go, go); else go();
    return;
  }
  document.body.classList.remove('mini', 'fakefs');
  const done = () => { render(); const c = listEl.querySelector('.item.playing'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'center' }); };
  if (document.fullscreenElement) document.exitFullscreen().then(done, done); else done();
}
function toggleMini() {
  document.body.classList.toggle('mini'); refresh();
}
function sleep() {
  clearTimeout(timer);
  closeExternal();
  automat = false; shuffle = null; powered = false;
  player.stop();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  document.body.classList.remove('mini', 'fakefs');
  if (MOBILE) setScreen('play');
  say('Vypnuto. Stiskněte Zapnout.');
  refresh();
  const on = document.querySelector('#m-panel [data-act="close"]');
  if (!MOBILE && on) on.focus();
}
function wake() {
  powered = true;
  if (MOBILE) setScreen('play');
  say(m('Vítejte. Vyberte program.'));
  refresh();
}
function playSelected() {
  if (player.state === 'paused') { player.resume(); return; }
  if (MOBILE) {
    if (player.state === 'playing') return;
    if (now) startItem(now.item, now.where, queue, qi); else { showList(); render(); }
    return;
  }
  const it = cwd().nodes[selected];
  if (!it) { say(m('Nejdřív stiskněte Novinky.'), true); return; }
  if (it.kind === 'folder') openFolder(selected); else playHere(selected);
}
function toggleRandom(scope) {
  if (shuffle === scope) { shuffle = null; refresh(); } else playRandom(scope);
}

const actions = {
  news: async () => {
    say('Hledám novinky…');
    await loadFeed(true);
    if (!MOBILE) return;
    if (newCount(tree)) { expand('/__news'); showList(); render(); const el = [...listEl.querySelectorAll('.trow')].find((x) => x.dataset.key === '/__news'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); } else say(m('Žádné nové pořady.'));
  },
  browse: showListAtPlaying,
  fav: toggleFav,
  offer: offerSomething,
  subs: toggleSubs,
  shuf: toggleShuffle,
  play: playSelected,
  pp: () => { if (player.state === 'playing') player.pause(); else playSelected(); },
  homeplay: () => { expanded.clear(); openOrder = []; showList(); render(); listEl.scrollTop = 0; },
  pause: () => { if (player.state === 'paused') player.resume(); else player.pause(); },
  stop: () => { clearTimeout(timer); player.stop(); closeExternal(); },
  full: toggleFullscreen,
  tune,
  channels: showChannels,
  mini: toggleMini,
  close: () => { if (!powered) wake(); else sleep(); },
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
    if (!powered && act !== 'close') return;
    const key = act + (btn.dataset.index || '') + (btn.dataset.key || '');
    const t = Date.now();
    const burst = t - (lastClick.get(key) || 0) < BURST_MS;
    lastClick.set(key, t);
    if (burst) return; // jedno kliknutí, dvojklik i rychlé vícenásobné klikání dělají totéž
    const i = Number(btn.dataset.index);
    if (act === 'item') {
      const it = cwd().nodes[i];
      if (it && isCurrent(it) && player.state !== 'idle') { clearTimeout(timer); player.stop(); } else playHere(i);
    } else if (act === 'open') openFolder(i);
    else if (act === 'trow') tapRow(btn.dataset.key);
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
// Prohlížeč nepovolí celou obrazovku bez dotyku, proto se zapne při prvním klepnutí. Nainstalovaná aplikace (manifest) startuje na celou obrazovku sama.
if (MOBILE && !PREVIEW_MODE) {
  const first = () => {
    document.removeEventListener('pointerup', first, true);
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  };
  document.addEventListener('pointerup', first, true);
}

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
if (MOBILE) { setScreen('play'); say(m('Vítejte. Vyberte pořad.')); }
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
