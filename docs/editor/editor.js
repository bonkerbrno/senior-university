import { validateItem, validateFolder, parseMediaUrl, validateFeed } from '../js/validate.js';
import { parseTable, categoryPath, cleanUrl } from '../js/bulk.js';
import { makeAdminFile, PIN_RE } from '../js/admin.js';
import { parseLibrary, libraryToText, buildFeed, canParent } from '../js/library.js';

const $ = (s) => document.querySelector(s);
const msg = $('#msg');
let lib = [];       // { id, title, note, url, show, added }
let shas = {};      // sha souborů pro GitHub API
let dirty = false;

function say(t, cls = '') { msg.textContent = t; msg.className = cls; const d = document.querySelector('#dmsg'); if (d) { d.textContent = t; d.className = 'dmsg ' + cls; } }
// výsledek ukládání ukážeme u každého tlačítka, aby nebyl jen nahoře mimo obrazovku
function saySave(t, cls = '') { say(t, cls); document.querySelectorAll('.save-msg').forEach((e) => { e.textContent = t; e.className = 'save-msg ' + cls; }); }
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* nic */ } }

const THEMES = ['noc', 'svetla', 'tyrkys'];
function setTheme(t) { const v = THEMES.includes(t) ? t : 'noc'; document.documentElement.dataset.theme = v; $('#theme').value = v; }
setTheme(lsGet('ed.theme'));
$('#theme').addEventListener('change', () => { setTheme($('#theme').value); lsSet('ed.theme', $('#theme').value); });
$('#repo').value = lsGet('ed.repo') || $('#repo').value;
$('#branch').value = lsGet('ed.branch') || $('#branch').value;
$('#token').value = lsGet('ed.token') || '';
$('#remember').checked = !!lsGet('ed.token');

function setDirty(d) { dirty = d; document.querySelectorAll('.save-btn').forEach((b) => { b.disabled = !d; }); $('#dirty').textContent = d ? 'Neodesláno' : ''; }
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
  if (!r.ok) throw new Error(r.status === 409 || r.status === 422 ? 'Seznam se mezitím změnil jinde. Načtěte jej znovu.' : 'Odeslání selhalo (kód ' + r.status + ').');
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
      say('Bez tokenu je seznam jen ke čtení. Vložte token v Nastavení.', '');
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

let cur = '';            // vybraný program ('' = Domů, hlavní seznam)
let query = '';
const closed = new Set(); // sbalené větve stromu
function parentOf(x) { return x.parent && folders().some((f) => f.id === x.parent) ? x.parent : ''; }
function countIn(id) { return lib.filter((x) => parentOf(x) === id).reduce((n, x) => n + (x.kind === 'folder' ? countIn(x.id) : 1), 0); }
const NS = 'http://www.w3.org/2000/svg';
const PENCIL = 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z';
function pencil() {
  const s = document.createElementNS(NS, 'svg'), p = document.createElementNS(NS, 'path');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ico'); s.setAttribute('aria-hidden', 'true'); p.setAttribute('d', PENCIL); s.append(p); return s;
}
function penBtn(tip) { const b = document.createElement('button'); b.type = 'button'; b.className = 'pen'; b.dataset.tip = tip; b.dataset.tipLeft = ''; b.setAttribute('aria-label', tip); b.append(pencil()); b.addEventListener('mousedown', (ev) => ev.preventDefault()); return b; }

// Pole je napřed jen ke čtení; tužka ho odemkne. Enter nebo opuštění pole změnu přijme, Esc ji vrátí.
// Změna se do přehrávače dostane až tlačítkem „Odeslat do přehrávače“.
function lockedField(inp, pen, { apply, required, done }) {
  let before = inp.value;
  inp.readOnly = true;
  const open = () => { before = inp.value; inp.readOnly = false; inp.classList.add('editing'); pen.classList.add('on'); inp.focus(); inp.select(); };
  const close = (keep) => {
    if (inp.readOnly) return;
    inp.value = inp.value.trim();
    if (!keep || (required && !inp.value)) { inp.value = before; apply(before, false); }
    inp.readOnly = true; inp.classList.remove('editing'); pen.classList.remove('on');
    if (inp.value !== before) done();
  };
  pen.addEventListener('click', () => (inp.readOnly ? open() : close(true)));
  inp.addEventListener('input', () => apply(inp.value, true));
  inp.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') { ev.preventDefault(); close(true); } else if (ev.key === 'Escape') { close(false); }
  });
  inp.addEventListener('blur', () => close(true));
}
// po přejmenování programu se názvy jinde přepíšou na místě (bez překreslení, aby se neztratilo klepnutí)
function syncTitle(it) {
  document.querySelectorAll('.node').forEach((d) => { if (d.dataset.p === it.id) { const nm = d.querySelector('.nm'); if (nm) nm.textContent = it.title; d.dataset.tip = countIn(it.id) ? 'Otevře program ' + it.title + '.' : 'Prázdný program. Přidejte do něj odkazy.'; } });
  document.querySelectorAll('#crumbs button').forEach((b) => { if (b.dataset.p === it.id) b.textContent = it.title; });
  if (cur === it.id) $('#list-h').textContent = it.title;
  document.querySelectorAll('#items select').forEach((sel) => fillSelect(sel, sel.dataset.ex || '', sel.value));
  ['#n-parent', '#t-parent', '#f-parent'].forEach((q) => fillSelect($(q), '', $(q).value));
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

function render() { renderList(); sendPreview(); }
function renderTree() {
  const ul = $('#tree'); ul.replaceChildren();
  const node = (id, title, sub) => {
    const li = document.createElement('li');
    const subs = lib.filter((x) => x.kind === 'folder' && parentOf(x) === id);
    const n = countIn(id);
    const d = el('div', 'node' + (id === cur ? ' sel' : '') + (n ? '' : ' empty')); d.tabIndex = 0; d.dataset.p = id;
    const tw = el('span', 'tw', subs.length ? (closed.has(id) ? '▸' : '▾') : '');
    tw.addEventListener('click', (ev) => { if (!subs.length) return; ev.stopPropagation(); closed.has(id) ? closed.delete(id) : closed.add(id); renderTree(); });
    const nm = el('span', 'nm', title), f = id ? lib.find((x) => x.id === id) : null;
    d.append(tw, nm, el('span', 'cnt', n ? String(n) : ''));
    if (f) {
      const pen = penBtn('Přejmenuje program.');
      pen.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const inp = el('input', 'nodeedit'); inp.value = f.title; inp.maxLength = 120; inp.setAttribute('aria-label', 'Název programu');
        let finished = false;
        const end = (keep) => {
          if (finished) return; finished = true;
          const v = inp.value.trim();
          if (keep && v && v !== f.title) { f.title = v; setDirty(true); sendPreview(); }
          nm.textContent = f.title; inp.replaceWith(nm); syncTitle(f);
        };
        inp.addEventListener('click', (e) => e.stopPropagation());
        inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); end(true); } else if (e.key === 'Escape') end(false); });
        inp.addEventListener('blur', () => end(true));
        nm.replaceWith(inp); inp.focus(); inp.select();
      });
      d.append(pen);
    }
    d.dataset.tip = n ? 'Otevře program ' + title + '.' : 'Prázdný program. Přidejte do něj odkazy.'; d.dataset.tipRight = '';
    const open = () => { cur = id; query = ''; $('#q').value = ''; render(); };
    d.addEventListener('click', open);
    d.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } });
    li.append(d);
    if (subs.length && !closed.has(id)) { const u = document.createElement('ul'); subs.forEach((f) => u.append(node(f.id, f.title))); li.append(u); }
    return li;
  };
  ul.append(node('', 'Domů'));
}
function crumbs() {
  const path = []; let id = cur;
  for (let i = 0; i < 12; i++) { const f = lib.find((x) => x.id === id && x.kind === 'folder'); if (!f) break; path.unshift(f); id = parentOf(f); }
  const box = $('#crumbs'); box.replaceChildren();
  [{ id: '', title: 'Domů' }, ...path].forEach((p, i) => {
    if (i) box.append(el('i', '', '›'));
    const b = el('button', '', p.title); b.type = 'button'; b.dataset.tip = 'Přejde do programu ' + p.title + '.'; b.dataset.p = p.id;
    b.addEventListener('click', () => { cur = p.id; query = ''; $('#q').value = ''; render(); });
    box.append(b);
  });
}
function renderList() {
  if (cur && !lib.some((x) => x.id === cur && x.kind === 'folder')) cur = '';
  renderTree(); crumbs();
  fillSelect($('#n-parent'), '', $('#n-parent').value); fillSelect($('#f-parent'), '', $('#f-parent').value); fillSelect($('#t-parent'), '', $('#t-parent').value);
  const here = lib.find((x) => x.id === cur);
  $('#list-h').textContent = here ? here.title : 'Domů';
  const ul = $('#items'); ul.replaceChildren();
  const q = query.trim().toLowerCase();
  const rows = lib.filter((x) => parentOf(x) === cur && (!q || x.title.toLowerCase().includes(q)));
  if (!rows.length) {
    const li = el('li', 'empty-note', q ? 'Nic neodpovídá hledání.' : 'Tento program je prázdný. Přidejte odkaz tlačítkem „+ Odkaz“ nahoře.'); ul.append(li);
  }
  rows.forEach((it) => {
    const folder = it.kind === 'folder';
    const li = document.createElement('li'); li.className = 'item' + (folder ? ' prog' : '') + (it.show ? '' : ' off');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'sw'; cb.checked = it.show;
    cb.setAttribute('role', 'switch'); cb.setAttribute('aria-label', 'Zobrazit v přehrávači');
    cb.dataset.tip = 'Zapnuto = zobrazí se v přehrávači. Vypnuto = skryté.'; cb.dataset.tipRight = '';
    cb.addEventListener('change', () => { it.show = cb.checked; li.classList.toggle('off', !cb.checked); setDirty(true); sendPreview(); });
    const mid = document.createElement('div');
    const t = document.createElement('input'); t.className = 't'; t.value = it.title; t.maxLength = 120; t.setAttribute('aria-label', 'Název');
    const tp = penBtn(folder ? 'Upraví název programu.' : 'Upraví název odkazu.');
    lockedField(t, tp, { required: true, apply: (v, mark) => { it.title = v; if (mark) setDirty(true); sendPreview(); }, done: () => syncTitle(it) });
    const n = document.createElement('input'); n.className = 'n'; n.value = it.note; n.maxLength = 400; n.placeholder = 'Bez popisu'; n.setAttribute('aria-label', 'Popis');
    const np = penBtn('Upraví popis.');
    lockedField(n, np, { required: false, apply: (v, mark) => { it.note = v; if (mark) setDirty(true); sendPreview(); }, done: () => {} });
    n.addEventListener('focus', () => { n.placeholder = 'Krátký popis'; }); n.addEventListener('blur', () => { n.placeholder = 'Bez popisu'; });
    const m = el('div', 'meta', folder ? (it.parent ? 'Podprogram' : 'Hlavní tlačítko (program)') + ' · položek: ' + countIn(it.id) : it.url);
    const f1 = el('div', 'fld'), f2 = el('div', 'fld'); f1.append(t, tp); f2.append(n, np);
    mid.append(f1, f2, m);
    const tools = el('div', 'tools');
    const mk = (label, tip, fn) => { const b = el('button', 'btn mini', label); b.type = 'button'; b.dataset.tip = tip; b.dataset.tipLeft = ''; b.setAttribute('aria-label', tip); b.addEventListener('click', fn); return b; };
    if (folder) tools.append(mk('Otevřít', 'Otevře program a ukáže jeho obsah.', () => { cur = it.id; query = ''; $('#q').value = ''; render(); }));
    const sel = document.createElement('select'); fillSelect(sel, folder ? it.id : '', it.parent); sel.dataset.ex = folder ? it.id : ''; sel.setAttribute('aria-label', 'Přesunout do programu');
    sel.dataset.tip = 'Přesune položku do jiného programu.'; sel.dataset.tipLeft = '';
    sel.addEventListener('change', () => { it.parent = sel.value; setDirty(true); render(); });
    tools.append(sel, mk('↑', 'Posune výš.', () => move(it, -1)), mk('↓', 'Posune níž.', () => move(it, 1)),
      mk('Smazat', 'Smaže ze seznamu.', () => {
        const kids = lib.filter((y) => y.parent === it.id);
        kids.forEach((y) => { y.parent = it.parent; }); // obsah smazaného programu zůstane, jen se přesune výš
        lib.splice(lib.indexOf(it), 1); setDirty(true); render();
      }));
    li.append(cb, mid, tools);
    ul.append(li);
  });
  const mine = lib.filter((x) => parentOf(x) === cur), links = mine.filter((x) => x.kind !== 'folder');
  $('#list-foot').textContent = 'Odkazů: ' + links.length + ' · viditelných v přehrávači: ' + links.filter((x) => x.show).length + ' · podprogramů: ' + (mine.length - links.length);
  $('#tree-foot').textContent = 'Celkem odkazů: ' + lib.filter((x) => x.kind !== 'folder').length;
}
$('#q').addEventListener('input', () => { query = $('#q').value; renderList(); });

/* ---------- okna (přidat / nastavení) a úvodní strana ---------- */
function openDlg(tab) {
  $('#shade').hidden = false;
  document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  ['link', 'text', 'xls', 'prog', 'gear'].forEach((t) => { $('#d-' + t).hidden = t !== tab; });
  const gear = tab === 'gear';
  $('#tabs').hidden = gear; $('#d-save').hidden = gear; $('#dtitle').textContent = gear ? 'Nastavení' : 'Přidat do seznamu';
  $('#dmsg').textContent = '';
  ['#n-parent', '#t-parent', '#f-parent'].forEach((s) => fillSelect($(s), '', cur));
  const first = $('#d-' + tab).querySelector('input,textarea'); if (first) first.focus();
}
function closeDlg() { $('#shade').hidden = true; }
document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openDlg(b.dataset.open)));
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => openDlg(b.dataset.tab)));
$('#gear').addEventListener('click', () => openDlg('gear'));
$('#x').addEventListener('click', closeDlg);
$('#shade').addEventListener('mousedown', (ev) => { if (ev.target.id === 'shade') closeDlg(); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeDlg(); });
function fitPreview() {
  const box = $('.prevbody'), f = $('#preview'); if (!box || !box.clientWidth) return;
  const k = Math.min(box.clientWidth / 1200, box.clientHeight / 760); f.style.transform = 'scale(' + k + ')';
}
if (window.ResizeObserver) new ResizeObserver(fitPreview).observe($('.prevbody')); window.addEventListener('resize', fitPreview);
$('#btn-prev').addEventListener('click', () => $('#main').classList.toggle('showprev'));

const CONSENTS = ['#c-terms', '#c-gdpr', '#c-liab'];
function consentOk() { return CONSENTS.every((c) => $(c).checked); }
CONSENTS.forEach((c) => $(c).addEventListener('change', () => { $('#enter').disabled = !consentOk(); }));
$('#gform').addEventListener('submit', (ev) => { ev.preventDefault(); if (!consentOk()) return; lsSet('ed.consent', '1'); $('#gate').hidden = true; });
if (lsGet('ed.consent') === '1') $('#gate').hidden = true;

/* ---------- přidání ---------- */
$('#n-url').addEventListener('input', () => {
  const m = parseMediaUrl($('#n-url').value);
  $('#n-info').textContent = !$('#n-url').value ? '' : m ? 'Rozpoznáno: ' + ({ youtube: 'YouTube', video: 'video', audio: 'audio nebo živé rádio', web: 'webová stránka (počasí)', ext: 'oficiální přehrávač (otevře se v novém okně)' })[m.kind] : 'Přehrávač tento odkaz nepřehraje.';
});
$('#add').addEventListener('click', () => {
  const it = validateItem({ id: newId(), title: $('#n-title').value, note: $('#n-note').value, url: $('#n-url').value, added: new Date().toISOString().slice(0, 10) });
  if (!it) { say('Vyplňte platný https odkaz (YouTube nebo soubor) a název.', 'err'); return; }
  lib.unshift({ id: it.id, title: it.title, note: it.note, url: it.url, show: true, added: it.added, parent: $('#n-parent').value });
  $('#n-url').value = $('#n-title').value = $('#n-note').value = ''; $('#n-info').textContent = '';
  setDirty(true); render(); say('Přidáno. Nezapomeňte odeslat do přehrávače.', 'ok');
});

$('#add-folder').addEventListener('click', () => {
  const f = validateFolder({ id: newId(), title: $('#f-title').value, note: '', added: new Date().toISOString().slice(0, 10) });
  if (!f) { say('Vyplňte název programu.', 'err'); return; }
  lib.unshift({ id: f.id, title: f.title, note: '', kind: 'folder', show: true, added: f.added, parent: $('#f-parent').value });
  $('#f-title').value = ''; setDirty(true); render(); say('Program přidán. Nezapomeňte odeslat do přehrávače.', 'ok');
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
  say(ok + ' vloženo' + (bad ? '; chybné řádky (červené, zůstaly v tabulce): ' + bad + '. Zkontrolujte název a https odkaz.' : '. Nezapomeňte odeslat do přehrávače.'), bad ? 'err' : 'ok');
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
  say(ok + ' vloženo' + (bad.length ? '; neplatné řádky (zůstaly v poli): ' + bad.join(', ') : '. Nezapomeňte odeslat do přehrávače.'), bad.length ? 'err' : 'ok');
});

/* ---------- uložení ---------- */
async function saveAll() {
  if (!$('#token').value.trim()) { saySave('Chybí token (Nastavení).', 'err'); return; }
  try {
    document.querySelectorAll('.save-btn').forEach((x) => { x.disabled = true; }); saySave('Odesílám…');
    const libText = libraryToText(lib);
    const feedText = JSON.stringify(buildFeed(lib), null, 2) + '\n';
    if (validateFeed(feedText).dropped) throw new Error('Seznam pro přehrávač obsahuje neplatnou položku.'); // pojistka: do přehrávače půjde jen to, co projde jeho kontrolou
    await writeFile('library.json', libText, 'Editor: úprava knihovny');
    await writeFile('feed.json', feedText, 'Editor: nový seznam pro přehrávač');
    setDirty(false);
    saySave('Odesláno do přehrávače. Zobrazí se po stisku Novinky (do několika minut).', 'ok');
  } catch (e) { setDirty(true); saySave(e.message || 'Odeslání selhalo.', 'err'); }
}
document.querySelectorAll('.save-btn').forEach((b) => b.addEventListener('click', saveAll));

/* ---------- náhled a PIN ---------- */
function sendPreview() {
  const f = $('#preview');
  if (f && f.contentWindow) f.contentWindow.postMessage({ type: 'draft', feed: JSON.stringify(buildFeed(lib)) }, location.origin);
}
window.addEventListener('message', (ev) => { if (ev.origin === location.origin && ev.data && ev.data.type === 'ready') sendPreview(); });
async function savePin(pin) {
  if (!$('#token').value.trim()) { say('Chybí token (Nastavení).', 'err'); return; }
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
