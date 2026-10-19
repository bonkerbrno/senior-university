import { validateItem, validateFolder, parseMediaUrl, validateFeed } from '../js/validate.js';
import { parseTable, categoryPath, cleanUrl } from '../js/bulk.js';
import { makeAdminFile, PIN_RE } from '../js/admin.js';
import { parseLibrary, libraryToText, buildFeed, canParent } from '../js/library.js';

const $ = (s) => document.querySelector(s);
const msg = $('#msg');
let lib = [];       // { id, title, note, url, show, added }
let shas = {};      // sha souborů pro GitHub API
let dirty = false;

function say(t, cls = '') { msg.textContent = t; msg.className = cls; }
// výsledek ukládání ukážeme u každého tlačítka, aby nebyl jen nahoře mimo obrazovku
function saySave(t, cls = '') { say(t, cls); document.querySelectorAll('.save-msg').forEach((e) => { e.textContent = t; e.className = 'save-msg ' + cls; }); }
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* nic */ } }

$('#repo').value = lsGet('ed.repo') || $('#repo').value;
$('#branch').value = lsGet('ed.branch') || $('#branch').value;
$('#token').value = lsGet('ed.token') || '';
$('#remember').checked = !!lsGet('ed.token');

function setDirty(d) { dirty = d; document.querySelectorAll('.save-btn').forEach((b) => { b.disabled = !d; }); $('#dirty').textContent = d ? 'Neuložené změny' : ''; }
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
function folders() { return lib.filter((x) => x.kind === 'folder'); }
function depthOf(x) { let d = 0, p = x.parent; while (p && d < 10) { d++; const f = lib.find((y) => y.id === p); p = f ? f.parent : ''; } return d; }

function fillSelect(sel, excludeId, current) {
  sel.replaceChildren();
  const root = document.createElement('option'); root.value = ''; root.textContent = '(hlavní seznam)'; sel.append(root);
  for (const f of orderedTree().map((o) => o.x).filter((x) => x.kind === 'folder')) {
    if (excludeId && !canParent(lib, excludeId, f.id)) continue;
    const o = document.createElement('option'); o.value = f.id;
    o.textContent = '— '.repeat(depthOf(f)) + f.title; sel.append(o);
  }
  sel.value = current || '';
}

// pořadí pro zobrazení: složky se svými potomky hned pod sebou
function orderedTree() {
  const ids = new Set(folders().map((f) => f.id));
  const out = [], seen = new Set();
  const walk = (parent) => {
    for (const x of lib) {
      const p = x.parent && ids.has(x.parent) ? x.parent : '';
      if (p !== parent || seen.has(x.id)) continue;
      seen.add(x.id); out.push({ x, depth: depthOf(x) });
      if (x.kind === 'folder') walk(x.id);
    }
  };
  walk('');
  return out;
}

function move(x, dir) {
  const sibs = lib.filter((y) => y.parent === x.parent);
  const k = sibs.indexOf(x) + dir;
  if (k < 0 || k >= sibs.length) return;
  const a = lib.indexOf(x), b = lib.indexOf(sibs[k]);
  [lib[a], lib[b]] = [lib[b], lib[a]];
  setDirty(true); render();
}

function render() { renderList(); sendPreview(); }
function renderList() {
  const ul = $('#items');
  ul.replaceChildren();
  fillSelect($('#n-parent'), '', $('#n-parent').value); fillSelect($('#f-parent'), '', $('#f-parent').value); fillSelect($('#t-parent'), '', $('#t-parent').value);
  orderedTree().forEach(({ x: it, depth }) => {
    const folder = it.kind === 'folder';
    const li = document.createElement('li'); if (folder) li.className = 'folder';
    li.style.setProperty('margin-left', (depth * 22) + 'px');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = it.show; cb.title = 'Ukázat tátovi';
    cb.addEventListener('change', () => { it.show = cb.checked; setDirty(true); });
    const mid = document.createElement('div');
    const t = document.createElement('input'); t.value = it.title; t.maxLength = 120;
    t.addEventListener('input', () => { it.title = t.value; setDirty(true); sendPreview(); });
    const n = document.createElement('textarea'); n.value = it.note; n.rows = 2; n.maxLength = 400;
    n.addEventListener('input', () => { it.note = n.value; setDirty(true); sendPreview(); });
    const m = document.createElement('div'); m.className = 'meta'; m.textContent = folder ? (it.parent ? 'PODSLOŽKA' : 'HLAVNÍ TLAČÍTKO (první řádek)') : it.url;
    const pick = document.createElement('label'); pick.className = 'pick'; pick.append(document.createTextNode('Program: '));
    const sel = document.createElement('select'); fillSelect(sel, folder ? it.id : '', it.parent);
    sel.addEventListener('change', () => { it.parent = sel.value; setDirty(true); render(); });
    pick.append(sel);
    mid.append(t, n, m, pick);
    const tools = document.createElement('div'); tools.className = 'tools';
    const mk = (label, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.addEventListener('click', fn); return b; };
    tools.append(mk('↑', 'Výš', () => move(it, -1)), mk('↓', 'Níž', () => move(it, 1)),
      mk('✕', 'Smazat', () => {
        const kids = lib.filter((y) => y.parent === it.id);
        kids.forEach((y) => { y.parent = it.parent; }); // obsah smazané složky zůstane, jen se přesune výš
        lib.splice(lib.indexOf(it), 1); setDirty(true); render();
      }));
    li.append(cb, mid, tools);
    ul.append(li);
  });
}

/* ---------- přidání ---------- */
$('#n-url').addEventListener('input', () => {
  const m = parseMediaUrl($('#n-url').value);
  $('#n-info').textContent = !$('#n-url').value ? '' : m ? 'Rozpoznáno: ' + ({ youtube: 'YouTube', video: 'video', audio: 'audio nebo živé rádio', web: 'webová stránka (počasí)', ext: 'oficiální přehrávač (otevře se v novém okně)' })[m.kind] : 'Tento odkaz tátův přehrávač nepřehraje.';
});
$('#add').addEventListener('click', () => {
  const it = validateItem({ id: newId(), title: $('#n-title').value, note: $('#n-note').value, url: $('#n-url').value, added: new Date().toISOString().slice(0, 10) });
  if (!it) { say('Vyplňte platný https odkaz (YouTube nebo soubor) a název.', 'err'); return; }
  lib.unshift({ id: it.id, title: it.title, note: it.note, url: it.url, show: true, added: it.added, parent: $('#n-parent').value });
  $('#n-url').value = $('#n-title').value = $('#n-note').value = ''; $('#n-info').textContent = '';
  setDirty(true); render(); say('Přidáno. Nezapomeňte uložit.', 'ok');
});

$('#add-folder').addEventListener('click', () => {
  const f = validateFolder({ id: newId(), title: $('#f-title').value, note: '', added: new Date().toISOString().slice(0, 10) });
  if (!f) { say('Vyplňte název programu.', 'err'); return; }
  lib.unshift({ id: f.id, title: f.title, note: '', kind: 'folder', show: true, added: f.added, parent: $('#f-parent').value });
  $('#f-title').value = ''; setDirty(true); render(); say('Program přidán. Nezapomeňte uložit.', 'ok');
});

/* ---------- hromadné vložení: tabulka Kategorie | Název | Odkaz | Popis ---------- */
const BCOLS = 4;
const bbody = $('#b-body');
function bRows() { return [...bbody.querySelectorAll('tr')]; }
function bAddRows(n) {
  for (let k = 0; k < n; k++) {
    const tr = document.createElement('tr');
    for (let c = 0; c < BCOLS; c++) {
      const td = document.createElement('td'), inp = document.createElement('input');
      inp.autocomplete = 'off'; inp.dataset.col = String(c);
      inp.setAttribute('aria-label', ['Kategorie', 'Název', 'Odkaz', 'Popis'][c]);
      td.append(inp); tr.append(td);
    }
    bbody.append(tr);
  }
}
bAddRows(6);
bbody.addEventListener('paste', (ev) => {
  const inp = ev.target.closest && ev.target.closest('input');
  if (!inp) return;
  const text = (ev.clipboardData || window.clipboardData).getData('text');
  if (!/[\t\n]/.test(text.trim())) return;          // obyčejný text do jedné buňky vložíme normálně
  ev.preventDefault();
  const grid = parseTable(text);
  const r0 = bRows().indexOf(inp.closest('tr')), c0 = Number(inp.dataset.col);
  while (bRows().length < r0 + grid.length) bAddRows(1);
  grid.forEach((cells, i) => {
    const inputs = bRows()[r0 + i].querySelectorAll('input');
    cells.forEach((v, j) => { if (c0 + j < BCOLS) inputs[c0 + j].value = v.trim(); });
  });
  $('#b-info').textContent = 'Vloženo řádků: ' + grid.length + '. Zkontrolujte a stiskněte „Vložit do seznamu“.';
});
$('#b-more').addEventListener('click', () => bAddRows(5));
$('#b-clear').addEventListener('click', () => { bbody.replaceChildren(); bAddRows(6); $('#b-info').textContent = ''; });

// najde (nebo vytvoří) složku podle cesty názvů; vrátí id nebo '' pro hlavní seznam
function folderForPath(names) {
  let parent = '';
  for (const name of names) {
    let f = lib.find((x) => x.kind === 'folder' && x.parent === parent && x.title.trim().toLowerCase() === name.toLowerCase());
    if (!f) {
      const nf = validateFolder({ id: newId() + 'f', title: name, note: '', added: new Date().toISOString().slice(0, 10) });
      if (!nf) return null;
      f = { id: nf.id, title: nf.title, note: '', kind: 'folder', show: true, added: nf.added, parent };
      lib.push(f);
    }
    parent = f.id;
  }
  return parent;
}
$('#b-add').addEventListener('click', () => {
  let ok = 0, bad = 0;
  bRows().forEach((tr, i) => {
    const [cat, title, rawUrl, note] = [...tr.querySelectorAll('input')].map((x) => x.value.trim());
    const url = cleanUrl(rawUrl);
    tr.classList.remove('bad');
    if (!cat && !title && !url && !note) return;     // prázdný řádek přeskočíme
    const n = validateItem({ id: newId() + i, title, note, url, added: new Date().toISOString().slice(0, 10) });
    const parent = n ? folderForPath(categoryPath(cat)) : null;
    if (!n || parent === null) { tr.classList.add('bad'); bad++; return; }
    lib.push({ id: n.id, title: n.title, note: n.note, url: n.url, show: true, added: n.added, parent });
    tr.remove(); ok++;                                // vložený řádek z tabulky zmizí, špatné zůstanou k opravě
  });
  if (!bRows().length) bAddRows(6);
  if (ok) { setDirty(true); render(); }
  $('#b-info').textContent = '';
  say(ok + ' vloženo' + (bad ? '; chybné řádky (červené, zůstaly v tabulce): ' + bad + '. Zkontrolujte název a https odkaz.' : '. Nezapomeňte uložit.'), bad ? 'err' : 'ok');
});

/* ---------- hromadné vložení textem (název ; popis ; odkaz) ---------- */
$('#t-add').addEventListener('click', () => {
  const rows = $('#t-text').value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let ok = 0; const bad = [];
  rows.forEach((line, i) => {
    const c = line.split(/\t|;/).map((x) => x.trim());
    let [title, note, url] = c.length >= 3 ? [c[0], c.slice(1, -1).join('; '), c[c.length - 1]] : [c[0], '', c[1]];
    if (!url) { const u = cleanUrl(line); const k = line.indexOf(u); if (/^https?:/.test(u) && k > 0) { url = u; title = line.slice(0, k).replace(/[\s;:\-–\[(<]+$/, ''); note = ''; } }
    url = cleanUrl(url || '');
    const n = validateItem({ id: newId() + 't' + i, title, note, url, added: new Date().toISOString().slice(0, 10) });
    if (!n) { bad.push(i + 1); return; }
    lib.push({ id: n.id, title: n.title, note: n.note, url: n.url, show: true, added: n.added, parent: $('#t-parent').value });
    ok++;
  });
  if (ok) { setDirty(true); render(); }
  $('#t-info').textContent = '';
  if (ok) $('#t-text').value = bad.length ? rows.filter((_, i) => bad.includes(i + 1)).join('\n') : '';
  say(ok + ' vloženo' + (bad.length ? '; neplatné řádky (zůstaly v poli): ' + bad.join(', ') : '. Nezapomeňte uložit.'), bad.length ? 'err' : 'ok');
});

/* ---------- uložení ---------- */
async function saveAll() {
  if (!$('#token').value.trim()) { saySave('Chybí token (nastavení nahoře).', 'err'); return; }
  try {
    document.querySelectorAll('.save-btn').forEach((x) => { x.disabled = true; }); saySave('Ukládám…');
    const libText = libraryToText(lib);
    const feedText = JSON.stringify(buildFeed(lib), null, 2) + '\n';
    if (validateFeed(feedText).dropped) throw new Error('Seznam pro tátu obsahuje neplatnou položku.'); // pojistka: do tátova seznamu půjde jen to, co projde jeho kontrolou
    await writeFile('library.json', libText, 'Editor: úprava knihovny');
    await writeFile('feed.json', feedText, 'Editor: nový seznam pro tátu');
    setDirty(false);
    saySave('Uloženo. Táta to uvidí po stisku Novinky (do několika minut).', 'ok');
  } catch (e) { setDirty(true); saySave(e.message || 'Uložení selhalo.', 'err'); }
}
document.querySelectorAll('.save-btn').forEach((b) => b.addEventListener('click', saveAll));

/* ---------- náhled a PIN ---------- */
function sendPreview() {
  const f = $('#preview');
  if (f && f.contentWindow) f.contentWindow.postMessage({ type: 'draft', feed: JSON.stringify(buildFeed(lib)) }, location.origin);
}
window.addEventListener('message', (ev) => { if (ev.origin === location.origin && ev.data && ev.data.type === 'ready') sendPreview(); });
async function savePin(pin) {
  if (!$('#token').value.trim()) { say('Chybí token (nastavení nahoře).', 'err'); return; }
  try {
    say('Ukládám PIN…');
    const cur = await readFile('admin.json');
    shas['admin.json'] = cur.sha;
    if (pin === null) {
      if (!cur.sha) { say('PIN nebyl nastaven.', 'ok'); return; }
      await writeFile('admin.json', '{}\n', 'Editor: zrušen PIN');
      say('PIN zrušen.', 'ok');
    } else {
      await writeFile('admin.json', await makeAdminFile(pin), 'Editor: nový PIN');
      say('PIN nastaven.', 'ok');
    }
    $('#pin-new').value = '';
  } catch (e) { say(e.message || 'PIN se nepodařilo uložit.', 'err'); }
}
$('#pin-set').addEventListener('click', () => {
  const v = $('#pin-new').value.trim();
  if (!PIN_RE.test(v)) { say('PIN má mít 4 až 8 číslic.', 'err'); return; }
  savePin(v);
});
$('#pin-off').addEventListener('click', () => savePin(null));

$('#load').addEventListener('click', () => {
  lsSet('ed.repo', $('#repo').value.trim()); lsSet('ed.branch', $('#branch').value.trim());
  lsSet('ed.token', $('#remember').checked ? $('#token').value.trim() : null);
  load();
});
window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
load();
