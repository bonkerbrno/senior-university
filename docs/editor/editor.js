import { validateItem, parseMediaUrl, validateFeed } from '../js/validate.js';

const $ = (s) => document.querySelector(s);
const msg = $('#msg');
let lib = [];       // { id, title, note, url, show, added }
let shas = {};      // sha souborů pro GitHub API
let dirty = false;

function say(t, cls = '') { msg.textContent = t; msg.className = cls; }
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* nic */ } }

$('#repo').value = lsGet('ed.repo') || $('#repo').value;
$('#branch').value = lsGet('ed.branch') || $('#branch').value;
$('#token').value = lsGet('ed.token') || '';
$('#remember').checked = !!lsGet('ed.token');

function setDirty(d) { dirty = d; $('#save').disabled = !d; $('#dirty').textContent = d ? 'Neuložené změny' : ''; }
function newId() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

/* ---------- GitHub API ---------- */
function api(path, opts = {}) {
  const token = $('#token').value.trim();
  const repo = $('#repo').value.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Repozitář musí být ve tvaru uživatel/název.');
  return fetch('https://api.github.com/repos/' + repo + '/contents/' + path, {
    ...opts,
    headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) },
    credentials: 'omit', referrerPolicy: 'no-referrer',
  });
}
function b64decode(b64) { const bin = atob(b64.replace(/\s/g, '')); return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))); }
function b64encode(text) { let s = ''; new TextEncoder().encode(text).forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); }

async function readFile(name) {
  const branch = encodeURIComponent($('#branch').value.trim());
  const r = await api('docs/' + name + '?ref=' + branch);
  if (r.status === 404) return { text: null, sha: null };
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'Token nemá přístup (kód ' + r.status + ').' : 'GitHub vrátil chybu ' + r.status + '.');
  const j = await r.json();
  return { text: b64decode(j.content), sha: j.sha };
}
async function writeFile(name, text, message) {
  const body = { message, content: b64encode(text), branch: $('#branch').value.trim() };
  if (shas[name]) body.sha = shas[name];
  const r = await api('docs/' + name, { method: 'PUT', body: JSON.stringify(body) });
  if (!r.ok) throw new Error(r.status === 409 || r.status === 422 ? 'Seznam se mezitím změnil jinde. Načtěte jej znovu.' : 'Uložení selhalo (kód ' + r.status + ').');
  shas[name] = (await r.json()).content.sha;
}

function parseLibrary(text) {
  const data = JSON.parse(text);
  if (!data || data.schema !== 1 || !Array.isArray(data.items)) throw new Error('Neznámý formát knihovny.');
  return data.items.map((x) => {
    const it = validateItem(x);
    return it && { id: it.id, title: it.title, note: it.note, url: it.url, show: x.show === true, added: it.added };
  }).filter(Boolean);
}

async function load() {
  try {
    say('Načítám…');
    if ($('#token').value.trim()) {
      const lf = await readFile('library.json');
      shas['library.json'] = lf.sha;
      const ff = await readFile('feed.json');
      shas['feed.json'] = ff.sha;
      lib = lf.text ? parseLibrary(lf.text) : [];
    } else {
      const r = await fetch('../library.json', { cache: 'no-store' });
      lib = parseLibrary(await r.text());
      say('Bez tokenu je seznam jen ke čtení. Vložte token v nastavení.', '');
    }
    setDirty(false); render();
    if ($('#token').value.trim()) say('Seznam načten.', 'ok');
  } catch (e) { say(e.message || 'Načtení selhalo.', 'err'); }
}

/* ---------- vykreslení (jen textContent / value) ---------- */
function render() {
  const ul = $('#items');
  ul.replaceChildren();
  lib.forEach((it, i) => {
    const li = document.createElement('li');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = it.show; cb.title = 'Ukázat tátovi';
    cb.addEventListener('change', () => { it.show = cb.checked; setDirty(true); });
    const mid = document.createElement('div');
    const t = document.createElement('input'); t.value = it.title; t.maxLength = 120;
    t.addEventListener('input', () => { it.title = t.value; setDirty(true); });
    const n = document.createElement('textarea'); n.value = it.note; n.rows = 2; n.maxLength = 400;
    n.addEventListener('input', () => { it.note = n.value; setDirty(true); });
    const m = document.createElement('div'); m.className = 'meta'; m.textContent = it.url;
    mid.append(t, n, m);
    const tools = document.createElement('div'); tools.className = 'tools';
    const mk = (label, title, fn, disabled) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.disabled = disabled; b.addEventListener('click', fn); return b; };
    tools.append(
      mk('↑', 'Výš', () => { [lib[i - 1], lib[i]] = [lib[i], lib[i - 1]]; setDirty(true); render(); }, i === 0),
      mk('↓', 'Níž', () => { [lib[i + 1], lib[i]] = [lib[i], lib[i + 1]]; setDirty(true); render(); }, i === lib.length - 1),
      mk('✕', 'Smazat', () => { lib.splice(i, 1); setDirty(true); render(); }, false));
    li.append(cb, mid, tools);
    ul.append(li);
  });
}

/* ---------- přidání ---------- */
$('#n-url').addEventListener('input', () => {
  const m = parseMediaUrl($('#n-url').value);
  $('#n-info').textContent = !$('#n-url').value ? '' : m ? 'Rozpoznáno: ' + ({ youtube: 'YouTube', video: 'video', audio: 'audio' })[m.kind] : 'Tento odkaz tátův přehrávač nepřehraje.';
});
$('#add').addEventListener('click', () => {
  const it = validateItem({ id: newId(), title: $('#n-title').value, note: $('#n-note').value, url: $('#n-url').value, added: new Date().toISOString().slice(0, 10) });
  if (!it) { say('Vyplňte platný https odkaz (YouTube nebo soubor) a název.', 'err'); return; }
  lib.unshift({ id: it.id, title: it.title, note: it.note, url: it.url, show: true, added: it.added });
  $('#n-url').value = $('#n-title').value = $('#n-note').value = ''; $('#n-info').textContent = '';
  setDirty(true); render(); say('Přidáno. Nezapomeňte uložit.', 'ok');
});

/* ---------- uložení ---------- */
$('#save').addEventListener('click', async () => {
  if (!$('#token').value.trim()) { say('Chybí token (nastavení nahoře).', 'err'); return; }
  try {
    $('#save').disabled = true; say('Ukládám…');
    const libText = JSON.stringify({ schema: 1, items: lib.map(({ id, title, note, url, show, added }) => ({ id, title, note, url, show, added })) }, null, 2) + '\n';
    const feedItems = lib.filter((x) => x.show).map(({ id, title, note, url, added }) => ({ id, title, note, url, added }));
    const feedText = JSON.stringify({ schema: 1, updated: new Date().toISOString(), items: feedItems }, null, 2) + '\n';
    validateFeed(feedText); // pojistka: do tátova seznamu půjde jen to, co projde jeho kontrolou
    await writeFile('library.json', libText, 'Editor: úprava knihovny');
    await writeFile('feed.json', feedText, 'Editor: nový seznam pro tátu');
    setDirty(false);
    say('Uloženo. Táta to uvidí po stisku Novinky (do několika minut).', 'ok');
  } catch (e) { setDirty(true); say(e.message || 'Uložení selhalo.', 'err'); }
});

$('#load').addEventListener('click', () => {
  lsSet('ed.repo', $('#repo').value.trim()); lsSet('ed.branch', $('#branch').value.trim());
  lsSet('ed.token', $('#remember').checked ? $('#token').value.trim() : null);
  load();
});
window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
load();
