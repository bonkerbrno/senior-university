// Přenos seznamu mezi Superboxy: export do CSV a načtení CSV (nebo library.json / feed.json z jednouživatelské verze).
// Jen čistý text: nic se nevyhodnocuje jako kód, každá položka projde stejnou kontrolou jako v editoru.
import { parseTable, categoryPath, cleanUrl } from './bulk.js';

export const CSV_HEAD = ['Kanál', 'Název', 'Odkaz', 'Popis', 'Zobrazit'];
export const CSV_MAX_BYTES = 1048576;
const SEP = ' / ';

// Excel by text začínající = + - @ spustil jako vzorec; apostrof to zastaví a při načtení ho zase odebereme.
function cell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function uncell(v) { return String(v).replace(/^'(?=[=+\-@])/, '').trim(); }

// Knihovna editoru (plochý seznam s parent) -> CSV oddělené středníkem, jak ho otevře český Excel.
// Kanál je cesta názvů „Televize / Zprávy“. Kanál bez pořadů má řádek s prázdným Názvem i Odkazem.
export function libraryToCsv(lib) {
  const byId = new Map(lib.filter((x) => x.kind === 'folder').map((x) => [x.id, x]));
  const path = (id) => {
    const names = [];
    for (let i = 0; id && byId.has(id) && i < 20; i++) { const f = byId.get(id); names.unshift(f.title); id = f.parent; }
    return names.join(SEP);
  };
  const kids = new Map();
  for (const x of lib) { const p = x.parent && byId.has(x.parent) ? x.parent : ''; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(x); }
  const rows = [CSV_HEAD], seen = new Set();
  const walk = (parent) => {
    for (const x of kids.get(parent) || []) {
      if (seen.has(x.id)) continue;
      seen.add(x.id);
      const show = x.show === false ? 'ne' : 'ano';
      if (x.kind === 'folder') { rows.push([path(x.id), '', '', x.note || '', show]); walk(x.id); }
      else rows.push([path(parent), x.title, x.url, x.note || '', show]);
    }
  };
  walk('');
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

// Soubor může být v UTF-8 (export Superboxu, Google Tabulky) i ve windows-1250 (český Excel „CSV oddělený středníkem“).
export function decodeCsv(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { /* zkusíme češtinu z Windows */ }
  try { return new TextDecoder('windows-1250').decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

// oddělovač podle prvního řádku (mimo uvozovky): středník, tabulátor nebo čárka
function guessDelim(text) {
  const n = { ';': 0, '\t': 0, ',': 0 };
  let q = false;
  for (const c of text) {
    if (c === '"') q = !q;
    else if (!q && c === '\n') break;
    else if (!q && c in n) n[c]++;
  }
  return n[';'] >= n['\t'] && n[';'] >= n[','] && n[';'] ? ';' : n['\t'] >= n[','] && n['\t'] ? '\t' : n[','] ? ',' : ';';
}

const NAMES = [
  ['path', /^(kanál|kanal|kategorie|program|kanály|channel|category)$/],
  ['title', /^(název|nazev|titul|title|name)$/],
  ['url', /^(odkaz|url|adresa|link)$/],
  ['note', /^(popis|anotace|poznámka|note|description)/],
  ['show', /^(zobrazit|viditelné|viditelne|zobrazeno|show|visible)$/],
];
const strip = (s) => s.toLowerCase().replace(/\(.*\)/, '').trim();

// "Televize / Zprávy" -> ['Televize', 'Zprávy']. Export dává mezery kolem lomítka, takže název „AC/DC“ zůstane celý.
export function csvPath(text) {
  const s = String(text).trim();
  return /\s[\/>]\s/.test(s) ? s.split(/\s+[\/>]\s+/).map((x) => x.trim()).filter(Boolean) : categoryPath(s);
}

// text CSV -> { rows: [{ line, path, title, url, note, show }], header }
export function parseCsv(text) {
  const s = String(text).replace(/^﻿/, '');
  const grid = parseTable(s, guessDelim(s));
  if (!grid.length) return { rows: [], header: false };
  const first = grid[0].map(strip);
  const map = {};
  NAMES.forEach(([k, re]) => { const i = first.findIndex((h) => re.test(h)); if (i >= 0) map[k] = i; });
  const header = 'title' in map || 'url' in map;
  const cols = header ? map : { path: 0, title: 1, url: 2, note: 3, show: 4 };
  const get = (r, k) => (cols[k] === undefined ? '' : uncell(r[cols[k]] || ''));
  const rows = [];
  grid.slice(header ? 1 : 0).forEach((r, i) => {
    const row = { line: i + (header ? 2 : 1), path: csvPath(get(r, 'path')), title: get(r, 'title'), url: cleanUrl(get(r, 'url')), note: get(r, 'note'),
      show: !/^(ne|no|false|0|skryt[ýo]?|vypnuto)$/i.test(get(r, 'show')) };
    if (!row.path.length && !row.title && !row.url && !row.note) return; // prázdný řádek
    rows.push(row);
  });
  return { rows, header };
}

// library.json (plochý seznam s parent) nebo feed.json (strom) z jednouživatelské verze -> stejné řádky jako z CSV
export function jsonToRows(text) {
  const data = JSON.parse(text);
  if (!data || data.schema !== 1 || !Array.isArray(data.items)) throw new Error('Soubor nemá formát seznamu Superboxu.');
  const rows = [];
  let line = 0;
  const str = (v) => (typeof v === 'string' ? v : '');
  if (data.items.some((x) => x && Array.isArray(x.items))) {
    const walk = (list, path, depth) => {
      for (const x of list) {
        if (!x || typeof x !== 'object' || depth > 10) continue;
        line++;
        if (x.kind === 'folder') {
          const p = [...path, str(x.title).trim()];
          rows.push({ line, path: p, title: '', url: '', note: str(x.note), show: true });
          if (Array.isArray(x.items)) walk(x.items, p, depth + 1);
        } else rows.push({ line, path, title: str(x.title), url: str(x.url), note: str(x.note), show: true });
      }
    };
    walk(data.items, [], 0);
    return rows;
  }
  const byId = new Map(data.items.filter((x) => x && x.kind === 'folder' && typeof x.id === 'string').map((x) => [x.id, x]));
  const path = (id) => {
    const names = [];
    for (let i = 0; id && byId.has(id) && i < 20; i++) { const f = byId.get(id); names.unshift(str(f.title).trim()); id = f.parent; }
    return names;
  };
  // rodiče před dětmi, aby kanály vznikly ve stejném pořadí jako v původním seznamu
  const kids = new Map();
  for (const x of data.items) { if (!x || typeof x !== 'object') continue; const p = byId.has(x.parent) ? x.parent : ''; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(x); }
  const seen = new Set();
  const walk = (parent) => {
    for (const x of kids.get(parent) || []) {
      if (seen.has(x)) continue;
      seen.add(x); line++;
      if (x.kind === 'folder') { rows.push({ line, path: path(x.id), title: '', url: '', note: str(x.note), show: x.show !== false }); walk(x.id); }
      else rows.push({ line, path: path(parent), title: str(x.title), url: str(x.url), note: str(x.note), show: x.show !== false });
    }
  };
  walk('');
  return rows;
}

// obsah souboru -> řádky; podle obsahu pozná CSV nebo JSON
export function fileToRows(text) {
  const s = String(text).replace(/^﻿/, '');
  if (/^\s*\{/.test(s)) return jsonToRows(s);
  return parseCsv(s).rows;
}
