import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFeed, parseMediaUrl, playableIn, LIMITS } from '../docs/js/validate.js';
import { parseLibrary, buildFeed, canParent } from '../docs/js/library.js';

const feed = (items) => JSON.stringify({ schema: 1, items });
const ok = { id: 'a1', title: 'Zvony', note: 'Pěkné', url: 'https://youtu.be/dQw4w9WgXcQ' };

test('platná položka projde a YouTube se zredukuje na ID', () => {
  const { items } = validateFeed(feed([ok]));
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'youtube');
  assert.equal(items[0].mediaId, 'dQw4w9WgXcQ');
});

test('nebezpečné nebo cizí odkazy se zahodí', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'blob:https://a/b', 'http://a.cz/x.mp4',
    'https://u:p@a.cz/x.mp4', 'https://a.cz/x.exe', 'https://a.cz/x.html', 'https://evil.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=<script>', 'https://a.cz:8443/x.mp4', 42, null]) {
    assert.equal(parseMediaUrl(url), null, String(url));
  }
});

test('přímá média jsou povolena podle přípony', () => {
  assert.equal(parseMediaUrl('https://a.cz/f.mp4').kind, 'video');
  assert.equal(parseMediaUrl('https://a.cz/f.MP3').kind, 'audio');
});

test('položky se špatným schématem, ID nebo délkou se zahodí', () => {
  const bad = [
    { ...ok, id: 'a b' }, { ...ok, id: '' }, { ...ok, title: '' }, { ...ok, title: 'x'.repeat(LIMITS.title + 1) },
    { ...ok, note: 'x'.repeat(LIMITS.note + 1) }, { ...ok, note: 5 }, null, 'x', [],
  ];
  const { items, dropped } = validateFeed(feed([...bad, ok]));
  assert.equal(items.length, 1);
  assert.equal(dropped, bad.length);
});

test('duplicitní ID se zahodí, počet položek je omezen', () => {
  assert.equal(validateFeed(feed([ok, ok])).items.length, 1);
  const many = Array.from({ length: 500 }, (_, i) => ({ ...ok, id: 'i' + i }));
  assert.equal(validateFeed(feed(many)).items.length, LIMITS.nodes);
});

test('HTML v textu zůstane textem (vykresluje se přes textContent)', () => {
  const { items } = validateFeed(feed([{ ...ok, title: '<img src=x onerror=alert(1)>' }]));
  assert.equal(items[0].title, '<img src=x onerror=alert(1)>');
});

test('rozbité, velké a cizí JSON selžou', () => {
  assert.throws(() => validateFeed('{'));
  assert.throws(() => validateFeed('x'.repeat(LIMITS.bytes + 1)));
  assert.throws(() => validateFeed('{"schema":2,"items":[]}'));
  assert.throws(() => validateFeed('{"schema":1,"items":{}}'));
  assert.throws(() => validateFeed(null));
});

test('složky: strom projde, hloubka a duplicity se hlídají', () => {
  const f = (id, items) => ({ id, kind: 'folder', title: 'S' + id, items });
  const nested = f('f1', [ok, f('f2', [{ ...ok, id: 'a2' }])]);
  const r = validateFeed(feed([nested]));
  assert.equal(r.items[0].kind, 'folder');
  assert.equal(r.items[0].children[1].children[0].id, 'a2');
  assert.equal(playableIn(r.items, true).length, 2);
  assert.equal(playableIn(r.items, false).length, 0);
  let deep = { ...ok, id: 'leaf' };
  for (let i = 0; i < LIMITS.depth + 2; i++) deep = f('d' + i, [deep]);
  assert.equal(JSON.stringify(validateFeed(feed([deep])).items).includes('leaf'), false);
  assert.equal(validateFeed(feed([f('x', []), f('x', [])])).items.length, 1);
  assert.equal(validateFeed(feed([{ id: 'q', kind: 'folder', title: 'Q' }])).items[0].children.length, 0);
});

test('knihovna: strom pro feed jen ze zaškrtnutých a neprázdných složek', () => {
  const lib = parseLibrary(JSON.stringify({ schema: 1, items: [
    { id: 'f1', kind: 'folder', title: 'Hudba', show: true },
    { id: 'f2', kind: 'folder', title: 'Prázdná', show: true },
    { id: 'f3', kind: 'folder', title: 'Skrytá', show: false },
    { ...ok, id: 'a', parent: 'f1', show: true },
    { ...ok, id: 'b', parent: 'f1', show: false },
    { ...ok, id: 'c', parent: 'f3', show: true },
    { ...ok, id: 'd', parent: '', show: true },
    { ...ok, id: 'e', parent: 'neexistuje', show: true },
  ] }));
  const feedObj = buildFeed(lib);
  assert.deepEqual(feedObj.items.map((x) => x.id), ['f1', 'd', 'e']);
  assert.deepEqual(feedObj.items[0].items.map((x) => x.id), ['a']);
  assert.equal(validateFeed(JSON.stringify(feedObj)).dropped, 0);
  assert.equal(canParent(lib, 'f1', 'f1'), false);
  assert.equal(canParent(lib, 'f1', 'f2'), true);
});

test('stream z rozhlas.stream a stránky jen z povolených hostitelů', async () => {
  const { parseMediaUrl } = await import('../docs/js/validate.js');
  assert.equal(parseMediaUrl('https://rozhlas.stream/brno.mp3').kind, 'audio');
  assert.equal(parseMediaUrl('https://rozhlas.stream/radiozurnal_aac_128.aac').kind, 'audio');
  assert.equal(parseMediaUrl('https://rozhlas.stream/live').kind, 'audio');
  assert.equal(parseMediaUrl('https://embed.windy.com/embed.html?lat=49.2&lon=16.6').kind, 'web');
  assert.equal(parseMediaUrl('https://www.yr.no/en').kind, 'web');
  assert.equal(parseMediaUrl('https://evil.example/stranka.html'), null);
  assert.equal(parseMediaUrl('https://embed.windy.com.evil.example/x'), null);
  assert.equal(parseMediaUrl('http://embed.windy.com/embed.html'), null);
  assert.equal(parseMediaUrl('https://rozhlas.stream:8443/x'), null);
});
