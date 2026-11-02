import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { libraryToCsv, parseCsv, decodeCsv, fileToRows, jsonToRows, csvPath } from '../docs/js/csv.js';
import { parseLibrary, buildFeed } from '../docs/js/library.js';

const libText = fs.readFileSync(new URL('../docs/library.json', import.meta.url), 'utf8');
const lib = parseLibrary(libText);

// řádky souboru -> knihovna stejným postupem jako editor (kanály podle cesty názvů)
function rowsToLib(rows) {
  const out = [];
  let n = 0;
  const folder = (names) => {
    let parent = '';
    for (const name of names) {
      let f = out.find((x) => x.kind === 'folder' && x.parent === parent && x.title === name);
      if (!f) { f = { id: 'f' + n++, kind: 'folder', title: name, note: '', show: true, parent }; out.push(f); }
      parent = f.id;
    }
    return parent;
  };
  for (const r of rows) {
    const parent = folder(r.path);
    if (!r.title && !r.url) { const f = out.find((x) => x.id === parent); if (f) { f.note = r.note; f.show = r.show; } continue; }
    out.push({ id: 'i' + n++, title: r.title, note: r.note, url: r.url, show: r.show, parent });
  }
  return out;
}
// strom kanálů a pořadů bez id a dat, jen co uvidí senior
const shape = (items) => items.map((x) => (x.items ? { t: x.title, n: x.note, items: shape(x.items) } : { t: x.title, n: x.note, u: x.url }));

test('export a import CSV zachová kanály, podkanály, pořady i viditelnost', () => {
  const csv = libraryToCsv(lib);
  assert.ok(csv.startsWith('﻿Kanál;Název;Odkaz;Popis;Zobrazit\r\n'));
  const back = rowsToLib(parseCsv(csv).rows);
  assert.deepEqual(shape(buildFeed(back).items), shape(buildFeed(lib).items));
  assert.equal(back.filter((x) => !x.show).length, lib.filter((x) => !x.show).length);
});

test('prázdný kanál má vlastní řádek a přežije přenos', () => {
  const l = [{ id: 'a', kind: 'folder', title: 'Prázdný', note: 'nic', show: true, parent: '' },
    { id: 'b', kind: 'folder', title: 'Pod', note: '', show: false, parent: 'a' }];
  const rows = parseCsv(libraryToCsv(l)).rows;
  assert.deepEqual(rows.map((r) => [r.path, r.title, r.note, r.show]), [[['Prázdný'], '', 'nic', true], [['Prázdný', 'Pod'], '', '', false]]);
});

test('středník, uvozovky, zalomení řádku a vzorce pro Excel', () => {
  const l = [{ id: 'a', title: '=SUM(A1); "x"', note: 'řádek 1\nřádek 2', url: 'https://example.org/a.mp3', show: true, parent: '' }];
  const csv = libraryToCsv(l);
  assert.match(csv, /"'=SUM\(A1\); ""x"""/);
  const [r] = parseCsv(csv).rows;
  assert.equal(r.title, '=SUM(A1); "x"');
  assert.equal(r.note, 'řádek 1\nřádek 2');
});

test('CSV z Excelu: windows-1250, čárka nebo tabulátor, jiné pořadí sloupců, bez hlavičky', () => {
  const cp1250 = Buffer.from([0x4e, 0xe1, 0x7a, 0x65, 0x76, 0x3b, 0x4f, 0x64, 0x6b, 0x61, 0x7a, 0x0d, 0x0a, // Název;Odkaz
    0x8a, 0x6b, 0x6f, 0x6c, 0x61, 0x3b, 0x68, 0x74, 0x74, 0x70, 0x73, 0x3a, 0x2f, 0x2f, 0x65, 0x2e, 0x63, 0x7a, 0x2f, 0x61, 0x2e, 0x6d, 0x70, 0x33]); // Škola;https://e.cz/a.mp3
  const r1 = parseCsv(decodeCsv(cp1250)).rows;
  assert.deepEqual(r1.map((r) => [r.title, r.url, r.path]), [['Škola', 'https://e.cz/a.mp3', []]]);
  const r2 = parseCsv('Odkaz,Název,Kategorie\nhttps://e.cz/b.mp3,"Pes, kočka",Zvířata / Psi\n').rows;
  assert.deepEqual(r2.map((r) => [r.title, r.url, r.path]), [['Pes, kočka', 'https://e.cz/b.mp3', ['Zvířata', 'Psi']]]);
  const r3 = parseCsv('Hudba\tPísnička\thttps://e.cz/c.mp3\tpopis\tne\n\n').rows;
  assert.deepEqual(r3.map((r) => [r.path, r.title, r.url, r.note, r.show]), [[['Hudba'], 'Písnička', 'https://e.cz/c.mp3', 'popis', false]]);
});

test('cesta kanálu: export s mezerami nechá AC/DC celé', () => {
  assert.deepEqual(csvPath('Hudba / AC/DC'), ['Hudba', 'AC/DC']);
  assert.deepEqual(csvPath('Televize/Zprávy'), ['Televize', 'Zprávy']);
  assert.deepEqual(csvPath(''), []);
});

test('jednouživatelská verze: library.json i feed.json dají stejný strom', () => {
  const flat = rowsToLib(fileToRows(libText));
  assert.deepEqual(shape(buildFeed(flat).items), shape(buildFeed(lib).items));
  const feedText = JSON.stringify(buildFeed(lib));
  const tree = rowsToLib(jsonToRows(feedText));
  assert.deepEqual(shape(buildFeed(tree).items), shape(buildFeed(lib).items));
  assert.throws(() => fileToRows('{"items": 5}'), /formát/);
});
