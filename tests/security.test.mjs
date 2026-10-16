// Statická kontrola: v kódu nesmí být nic, co by z dat udělalo kód nebo HTML.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = walk(docs);
const js = files.filter((f) => f.endsWith('.js'));
const html = files.filter((f) => f.endsWith('.html'));

test('žádné nebezpečné API v JavaScriptu', () => {
  const bad = /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|setTimeout\s*\(\s*['"`]|createContextualFragment|srcdoc|window\.open|location\.(assign|replace)\s*=/;
  for (const f of js) {
    const code = fs.readFileSync(f, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(code, bad, f);
    for (const m of code.matchAll(/location\.href\s*=\s*([^;]+);/g)) assert.equal(m[1].trim(), "'editor/'", 'jediné povolené přesměrování je do editoru: ' + f);
  }
});

test('každá stránka má přísnou CSP bez unsafe-inline a unsafe-eval', () => {
  for (const f of html) {
    const t = fs.readFileSync(f, 'utf8');
    const csp = (t.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1];
    assert.ok(csp, 'chybí CSP v ' + f);
    assert.doesNotMatch(csp, /unsafe-/);
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(t, /<script(?![^>]*\bsrc=)[^>]*>/, 'inline skript v ' + f);
    assert.doesNotMatch(t, /\son\w+\s*=/i, 'inline handler v ' + f);
    assert.doesNotMatch(t, /\sstyle\s*=/i, 'inline styl v ' + f);
  }
});

test('tátova stránka nenačítá nic z cizích serverů kromě YouTube iframe', () => {
  const t = fs.readFileSync(path.join(docs, 'index.html'), 'utf8');
  assert.doesNotMatch(t, /(src|href)="https?:/);
  const csp = t.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /connect-src 'self'(;|$)/);
  assert.match(csp, /frame-src https:\/\/www\.youtube-nocookie\.com https:\/\/embed\.windy\.com https:\/\/www\.yr\.no(;|$)/);
});

test('feed.json v repozitáři projde validátorem', async () => {
  const { validateFeed } = await import('../docs/js/validate.js');
  const r = validateFeed(fs.readFileSync(path.join(docs, 'feed.json'), 'utf8'));
  assert.equal(r.dropped, 0);
});
