import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFeed, parseMediaUrl, LIMITS } from '../docs/js/validate.js';

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
  assert.equal(validateFeed(feed(many)).items.length, LIMITS.items);
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
