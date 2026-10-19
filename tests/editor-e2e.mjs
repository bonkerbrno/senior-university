// Test editoru: GitHub API je simulované přes page.route, nic se neposílá ven.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = path.join(root, new URL(req.url, 'http://x').pathname);
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', types[path.extname(p)] || 'text/plain'); res.end(fs.readFileSync(p));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/editor/`;
const browser = await pw.chromium.launch();
const page = await (await browser.newContext()).newPage();
const puts = {};
await page.route('https://api.github.com/**', async (route) => {
  const req = route.request(); const name = req.url().match(/docs\/([\w.]+)/)[1];
  assert.equal(req.headers().authorization, 'Bearer tok123');
  if (req.method() === 'GET') {
    const body = name === 'library.json' ? '{"schema":1,"items":[]}' : '{"schema":1,"items":[]}';
    return route.fulfill({ json: { sha: 'sha-' + name, content: Buffer.from(body).toString('base64') } });
  }
  puts[name] = JSON.parse(Buffer.from(JSON.parse(req.postData()).content, 'base64').toString());
  assert.equal(JSON.parse(req.postData()).sha, 'sha-' + name);
  route.fulfill({ json: { content: { sha: 'new-' + name } } });
});
await page.goto(base);
// úvodní strana: bez tří souhlasů se nevstoupí
assert.ok(await page.locator('#gate').isVisible(), 'úvodní strana je vidět');
assert.ok(await page.locator('#enter').isDisabled(), 'vstup je zamčený bez souhlasů');
for (const c of ['#c-terms', '#c-gdpr', '#c-liab']) await page.check(c);
assert.ok(await page.locator('#enter').isEnabled());
await page.click('#enter');
assert.ok(await page.locator('#gate').isHidden());
await page.reload();                                   // souhlasy se pamatují
assert.ok(await page.locator('#gate').isHidden(), 'souhlasy se pamatují');
assert.equal(await page.getAttribute('#to-player', 'href'), '../');
await page.click('#gear');
await page.fill('#token', 'tok123');
await page.click('#load');
await page.waitForFunction(() => /Seznam načten/.test(document.querySelector('#msg').textContent));
await page.click('#x'); await page.click('[data-open=prog]');
await page.fill('#f-title', 'Hudba'); await page.click('#add-folder');
await page.fill('#f-title', 'Rock'); await page.selectOption('#f-parent', { label: 'Hudba' }); await page.click('#add-folder');
await page.click('#tabs [data-tab=link]');
await page.fill('#n-url', 'https://youtu.be/dQw4w9WgXcQ');
assert.match(await page.innerText('#n-info'), /YouTube/);
await page.fill('#n-title', 'Zvony');
await page.fill('#n-note', 'Krásné zvonění');
await page.selectOption('#n-parent', { label: '— Rock' });
await page.click('#add');
await page.fill('#n-url', 'https://a.cz/f.mp3'); await page.fill('#n-title', 'Skryté'); await page.selectOption('#n-parent', { label: 'Hudba' }); await page.click('#add');
await page.fill('#n-url', 'https://a.cz/g.mp3'); await page.fill('#n-title', 'Volné'); await page.selectOption('#n-parent', ''); await page.click('#add');
await page.click('#x');
// schovat „Skryté“ (leží v programu Hudba)
await page.locator('.node', { hasText: 'Hudba' }).first().click();
const idx = await page.evaluate(() => [...document.querySelectorAll('#items li')].findIndex((l) => l.querySelector('input.t') && l.querySelector('input.t').value === 'Skryté'));
const row = page.locator('#items li').nth(idx);
await row.locator('.sw').uncheck();
assert.ok(await page.locator('.save-btn').count() >= 2, 'tlačítko Uložit je nahoře i v okně přidání');
await page.click('#save');
await page.waitForFunction(() => /Uloženo/.test(document.querySelector('#msg').textContent));
assert.ok(await page.evaluate(() => [...document.querySelectorAll('.save-msg')].every((e) => /Uloženo/.test(e.textContent))), 'výsledek je vidět u každého tlačítka');
assert.equal(puts['library.json'].items.length, 5);
const f = puts['feed.json'].items;
assert.deepEqual(f.map((i) => i.title), ['Volné', 'Hudba']);
assert.equal(f[1].kind, 'folder');
assert.deepEqual(f[1].items.map((i) => i.title), ['Rock']);          // „Skryté“ chybí, Rock je podsložka
assert.equal(f[1].items[0].items[0].url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
await page.click('[data-open=link]');
await page.fill('#n-url', 'javascript:alert(1)'); await page.fill('#n-title', 'x'); await page.click('#add');
assert.match(await page.innerText('#msg'), /platný/);
console.log('✓ editor: složky a podsložky, schování, uložení knihovny i stromového feedu, odmítnutí zlého odkazu');
await browser.close(); server.close();
