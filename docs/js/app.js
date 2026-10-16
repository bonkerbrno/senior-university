import { validateFeed } from './validate.js';
import { createPlayer } from './player.js';

const $ = (sel) => document.querySelector(sel);
const FEED_URL = 'feed.json';
const LS_FEED = 'jukebox.feed';
const LS_SEEN = 'jukebox.seen';

const statusEl = $('#status');
const listEl = $('#list');
const stage = $('#stage');
const screenWrap = $('#screen-wrap');

let items = [];
let selected = 0;
let seen = new Set();

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* bez úložiště to jde také */ } }
try { seen = new Set(JSON.parse(lsGet(LS_SEEN) || '[]')); } catch { seen = new Set(); }

function say(text, warn = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('warn', warn);
}

const player = createPlayer(stage, (state, detail) => {
  const it = player.item;
  if (state === 'playing') say('Hraje: ' + it.title);
  else if (state === 'paused') say('Pozastaveno: ' + it.title);
  else if (state === 'idle') say('Nic nehraje. Vyberte pořad.');
  else if (state === 'ended') say('Hotovo. Můžete vybrat další pořad.');
  else if (state === 'error') {
    say(detail === 'embed' ? 'Tento pořad nejde přehrát. Zkuste prosím jiný.' : 'Pořad se nepodařilo spustit. Zkuste prosím jiný.', true);
    setTimeout(() => { if (player.state === 'error') player.stop(); }, 4000);
  }
  refresh();
});

/* ---------- vykreslení (jen textContent) ---------- */
function render() {
  listEl.replaceChildren();
  if (!items.length) {
    const e = document.createElement('div'); e.className = 'empty';
    e.textContent = 'Zatím tu nic není. Stiskněte Novinky.';
    listEl.append(e);
    return;
  }
  items.forEach((it, i) => {
    const card = document.createElement('article');
    card.className = 'item'; card.dataset.index = String(i);
    const h = document.createElement('h3');
    if (!seen.has(it.id)) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = 'NOVÉ'; h.append(b); }
    h.append(document.createTextNode(it.title));
    card.append(h);
    if (it.note) { const p = document.createElement('p'); p.textContent = it.note; card.append(p); }
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn'; btn.dataset.act = 'item'; btn.dataset.index = String(i);
    const lamp = document.createElement('span'); lamp.className = 'lamp';
    const lbl = document.createElement('span'); lbl.className = 'lbl';
    btn.append(lamp, lbl);
    card.append(btn);
    listEl.append(card);
  });
  refresh();
}

function isCurrent(i) { const c = player.item; return !!c && items[i] && c.id === items[i].id; }

function refresh() {
  const st = player.state;
  const active = st === 'playing' || st === 'paused';
  listEl.querySelectorAll('.item').forEach((card) => {
    const i = Number(card.dataset.index);
    const cur = active && isCurrent(i);
    card.classList.toggle('selected', i === selected);
    card.classList.toggle('playing', cur);
    const btn = card.querySelector('button');
    btn.querySelector('.lbl').textContent = cur ? (st === 'paused' ? 'Pozastaveno – vypnout' : 'Právě hraje – vypnout') : 'Pustit tento pořad';
    if (cur) btn.dataset.lit = st === 'paused' ? 'orange' : 'green'; else delete btn.dataset.lit;
  });
  const lit = (act, color) => document.querySelectorAll('[data-act="' + act + '"]').forEach((b) => {
    if (color) b.dataset.lit = color; else delete b.dataset.lit;
  });
  lit('play', st === 'playing' ? 'green' : null);
  lit('pause', st === 'paused' ? 'orange' : null);
  lit('stop', null);
  lit('full', document.fullscreenElement ? 'blue' : null);
  lit('mini', document.body.classList.contains('mini') ? 'blue' : null);
  document.querySelectorAll('[data-act="pause"] .lbl').forEach((l) => { l.textContent = st === 'paused' ? 'Pokračovat' : 'Pauza'; });
  document.querySelectorAll('[data-act="pause"]').forEach((b) => { b.disabled = !active; });
  document.querySelectorAll('[data-act="stop"]').forEach((b) => { b.disabled = !active; });
  document.querySelectorAll('[data-act="mini"] .lbl').forEach((l) => { l.textContent = document.body.classList.contains('mini') ? 'Zvětšit' : 'Zmenšit'; });
  document.querySelectorAll('#controls [data-act="full"] .lbl').forEach((l) => { l.textContent = document.fullscreenElement ? 'Zpět' : 'Celá obrazovka'; });
}

/* ---------- seznam ---------- */
function select(i, scroll = true) {
  if (!items.length) return;
  selected = Math.max(0, Math.min(items.length - 1, i));
  refresh();
  if (scroll) {
    const card = listEl.children[selected];
    if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function playIndex(i) {
  const it = items[i];
  if (!it) return;
  selected = i;
  seen.add(it.id);
  lsSet(LS_SEEN, JSON.stringify([...seen]));
  const badge = listEl.children[i] && listEl.children[i].querySelector('.badge');
  if (badge) badge.remove();
  player.play(it);
}

async function loadFeed(userAsked) {
  try {
    const res = await fetch(FEED_URL + '?t=' + Date.now(), { cache: 'no-store', credentials: 'omit' });
    if (!res.ok) throw new Error('http');
    const text = await res.text();
    const { items: fresh } = validateFeed(text);
    const before = new Set(items.map((x) => x.id));
    items = fresh;
    lsSet(LS_FEED, text);
    render();
    const n = fresh.filter((x) => !before.has(x.id) && !seen.has(x.id)).length;
    if (userAsked) say(n ? 'Máte ' + (n === 1 ? 'novou položku' : 'nové položky: ' + n) + '.' : 'Žádné nové pořady.');
    return true;
  } catch {
    const cached = lsGet(LS_FEED);
    if (cached) { try { items = validateFeed(cached).items; render(); } catch { /* nic */ } }
    if (userAsked || !items.length) say(items.length ? 'Nejsem připojen k internetu. Ukazuji poslední seznam.' : 'Nejsem připojen k internetu.', true);
    return false;
  }
}

/* ---------- akce ---------- */
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await screenWrap.requestFullscreen();
  } catch { say('Celou obrazovku se nepodařilo zapnout.', true); }
  refresh();
}

function toggleMini() { document.body.classList.toggle('mini'); refresh(); }

function sleep() {
  player.stop();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  document.body.classList.remove('mini');
  $('#asleep').hidden = false;
  $('#app').hidden = true;
  $('#asleep .btn').focus();
  try { window.close(); } catch { /* prohlížeč nedovolí zavřít okno; zůstane obrazovka „odpočívá“ */ }
}
function wake() { $('#asleep').hidden = true; $('#app').hidden = false; refresh(); }

const actions = {
  news: () => { say('Hledám novinky…'); return loadFeed(true); },
  play: () => { if (items.length) playIndex(selected); else say('Nejdřív stiskněte Novinky.', true); },
  pause: () => { if (player.state === 'paused') player.resume(); else player.pause(); },
  stop: () => player.stop(),
  full: toggleFullscreen,
  mini: toggleMini,
  close: sleep,
  wake,
  up: () => select(selected - 1),
  down: () => select(selected + 1),
};

const lastPress = new Map();
document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-act]');
  if (btn) {
    const act = btn.dataset.act;
    const key = act + (btn.dataset.index || '');
    const now = Date.now();
    if (now - (lastPress.get(key) || 0) < 400) return; // ochrana proti dvojkliku
    lastPress.set(key, now);
    if (act === 'item') {
      const i = Number(btn.dataset.index);
      if (isCurrent(i) && player.state !== 'idle') player.stop(); else playIndex(i);
      return;
    }
    if (actions[act]) actions[act]();
    return;
  }
  const card = ev.target.closest('.item');
  if (card) select(Number(card.dataset.index), false);
});

document.addEventListener('keydown', (ev) => {
  if (ev.target.closest && ev.target.closest('button')) return;
  if (ev.key === 'ArrowDown') { ev.preventDefault(); select(selected + 1); }
  else if (ev.key === 'ArrowUp') { ev.preventDefault(); select(selected - 1); }
  else if (ev.key === 'Enter') { ev.preventDefault(); actions.play(); }
  else if (ev.key === ' ') { ev.preventDefault(); actions.pause(); }
});
document.addEventListener('fullscreenchange', refresh);

/* ---------- start ---------- */
render();
loadFeed(false);
