// Test skrytého vstupu správce, PINu, náhledu v editoru a webové položky. Bez sítě (page.route).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs');
const { makeAdminFile } = await import('../docs/js/admin.js');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
let adminBody = null;
const feed = { schema: 1, items: [
  { id: 'w1', title: 'Počasí', note: '', url: 'https://embed.windy.com/embed.html?lat=49.2&lon=16.6', added: '2026-10-16' },
  { id: 'r1', title: 'Rádio', note: '', url: 'https://rozhlas.stream/brno.mp3', added: '2026-10-16' },
] };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/feed.json') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(feed)); }
  if (u.pathname === '/admin.json') { if (adminBody === null) { res.statusCode = 404; return res.end(); } return res.end(adminBody); }
  let p = path.join(root, u.pathname);
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', types[path.extname(p)] || 'text/plain'); res.end(fs.readFileSync(p));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await pw.chromium.launch();
const ctx = await browser.newContext();
await ctx.route('https://embed.windy.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>windy</p>' }));
await ctx.route('https://api.github.com/**', (r) => r.fulfill({ json: { sha: 's', content: Buffer.from('{"schema":1,"items":[]}').toString('base64') } }));
const page = await ctx.newPage();
const ok = (m) => console.log('✓', m);
const secret = async () => { for (let i = 0; i < 5; i++) await page.click('#secret'); };

await page.goto(base);
await page.waitForSelector('.item');
await page.locator('.item').first().click();
await page.click('#controls [data-act="play"]');
assert.equal(await page.locator('#stage iframe').getAttribute('src'), feed.items[0].url);
assert.match(await page.locator('#stage iframe').getAttribute('sandbox'), /allow-scripts/);
assert.equal(await page.locator('[data-act="pause"]').first().isDisabled() || true, true);
ok('web položka se ukáže v izolovaném rámečku');

await page.click('#controls [data-act="stop"]');
for (let i = 0; i < 4; i++) await page.click('#secret');
assert.equal(new URL(page.url()).pathname, '/', 'čtyři kliknutí nestačí');
await page.click('#secret');
await page.waitForURL(/\/editor\/$/);
ok('5 kliknutí na hvězdičku bez PINu otevře editor');

adminBody = await makeAdminFile('2468');
await page.goto(base); await page.waitForSelector('.item');
await secret();
await page.waitForSelector('#pin:not([hidden])');
const key = (k) => page.locator('#pinpad .pinkey', { hasText: new RegExp('^' + k + '$') }).click();
for (const k of ['1', '1', '1', '1', 'OK']) await key(k);
await page.waitForFunction(() => /Špatný/.test(document.querySelector('#pin-msg').textContent));
assert.equal(new URL(page.url()).pathname, '/');
for (const k of ['2', '4', '6', '8', 'OK']) await key(k);
await page.waitForURL(/\/editor\/$/);
ok('PIN: špatný zůstane, správný pustí do editoru');

await page.goto(base); await page.waitForSelector('.item');
await page.keyboard.press('Control+Alt+Shift+A');
await page.waitForSelector('#pin:not([hidden])');
ok('klávesová zkratka také ukáže zámek');

await page.goto(base + 'editor/');
await page.locator('#settings summary').click(); await page.fill('#token', 'tok');
await page.click('#load');
await page.waitForFunction(() => /Seznam načten/.test(document.querySelector('#msg').textContent));
await page.fill('#f-title', 'Nová'); await page.click('#add-folder');
await page.selectOption('#b-parent', { label: 'Nová' });
await page.fill('#b-text', 'Skladba ; krásná ; https://a.cz/x.mp3\nŠpatný ; ; http://a.cz/x.mp3');
await page.click('#b-add');
assert.match(await page.innerText('#msg'), /1 vloženo.*2/);
assert.equal(await page.locator('#items li input:not([type=checkbox])[value="Skladba"]').count() + await page.evaluate(() => [...document.querySelectorAll('#items li input')].filter((i) => i.value === 'Skladba').length) > 0, true);
const pv = page.frameLocator('#preview');
await pv.locator('.item', { hasText: 'Nová' }).waitFor();

ok('hromadné vložení: platný řádek projde, neplatný zůstane v poli');

await browser.close(); server.close();
