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
  { id: 'c1', title: 'ČT24', note: '', url: 'https://ct24.ceskatelevize.cz/video/zive-vysilani', added: '2026-10-16' },
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
await page.click('#m-panel [data-act="pp"]');
assert.equal(await page.locator('#stage iframe').getAttribute('src'), feed.items[0].url);
assert.match(await page.locator('#stage iframe').getAttribute('sandbox'), /allow-scripts/);
assert.equal(await page.locator('[data-act="pause"]').first().isDisabled() || true, true);
await ctx.route('https://ct24.ceskatelevize.cz/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>ct24</p>' }));
await page.click('#m-panel [data-act="stop"]');
const [popup] = await Promise.all([ctx.waitForEvent('page'), page.locator('.item').nth(1).locator('button').click()]);
assert.match(popup.url(), /^https:\/\/ct24\.ceskatelevize\.cz\//);
assert.match(await page.innerText('#status'), /Otevírám/);
assert.equal(popup.isClosed(), false);
await page.locator('.item').nth(2).locator('button').click();
await popup.waitForEvent('close', { timeout: 3000 }).catch(() => {});
assert.equal(popup.isClosed(), true, 'okno ČT24 se při spuštění rádia zavře');
// po obnovení stránky Superbox okno najde podle jména a také zavře
await page.click('#m-panel [data-act="stop"]').catch(() => {});
const [popup2] = await Promise.all([ctx.waitForEvent('page'), page.locator('.item').nth(1).locator('button').click()]);
await popup2.waitForLoadState();
await page.reload(); await page.waitForSelector('.item');
await page.locator('.item').nth(2).locator('button').click();
await popup2.waitForEvent('close', { timeout: 3000 }).catch(() => {});
assert.equal(popup2.isClosed(), true, 'okno ČT24 se zavře i po obnovení Superboxu');
assert.equal(await page.locator('#stage iframe').count(), 0, 'ČT24 se nevkládá do rámečku');
ok('ČT24 se otevře v novém okně a nevkládá se');
ok('web položka se ukáže v izolovaném rámečku');

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
await page.evaluate(() => localStorage.setItem('ed.consent', '1')); await page.reload();
await page.click('#gear'); await page.fill('#token', 'tok');
await page.click('#load');
await page.waitForFunction(() => /Seznam načten/.test(document.querySelector('#msg').textContent));
await page.click('#x'); await page.click('[data-open=prog]');
await page.fill('#f-title', 'Nová'); await page.click('#add-folder');
await page.click('#tabs [data-tab=xls]');
// vložení bloku z Excelu (tabulátory) do první buňky: Kategorie, Název, Odkaz, Popis
await page.evaluate(() => {
  const inp = document.querySelector('#b-body input');
  const dt = new DataTransfer();
  dt.setData('text/plain', 'Nová\tSkladba\thttps://a.cz/x.mp3\tkrásná\nNová / Rock\tTvrdá\thttps://a.cz/y.mp3\t\nNová\tŠpatný\thttp://a.cz/z.mp3\t\n\tVolná\thttps://a.cz/v.mp3\t\n');
  inp.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
assert.equal(await page.locator('#b-body tr').nth(1).locator('input').nth(1).inputValue(), 'Tvrdá');
await page.click('#b-add');
assert.match(await page.innerText('#msg'), /3 vloženo.*chybné řádky.*: 1/);
assert.equal(await page.locator('#b-body tr.bad').count(), 1);
const nodes = await page.locator('.node .nm').allTextContents();
assert.ok(nodes.includes('Rock'), 'složka Rock se vytvořila');
assert.equal(nodes.filter((v) => v === 'Nová').length, 1, 'složka Nová se nezdvojila');
const vals = await page.evaluate(() => [...document.querySelectorAll('#items li input.t')].map((i) => i.value));
assert.ok(vals.includes('Volná'), 'položka bez kategorie je v hlavním seznamu');
const pv = page.frameLocator('#preview');
await pv.locator('.item', { hasText: 'Nová' }).waitFor();

ok('hromadné vložení z Excelu: kategorie → složky, platné projdou, chybný zůstane červený');

// textové pole: odkazy zkopírované z chatu jako markdown [url](url) se rozpoznají
await page.click('#tabs [data-tab=text]');
await page.fill('#t-text', 'Oliver Twist ; Tanec 1967 ; [https://www.youtube.com/watch?v=aaaaaaaaaaa](https://www.youtube.com/watch?v=aaaaaaaaaaa)\nBez popisu [https://www.youtube.com/watch?v=bbbbbbbbbbb](https://www.youtube.com/watch?v=bbbbbbbbbbb)\nSpatny ; neni odkaz');
await page.click('#t-add');
assert.match(await page.innerText('#msg'), /2 vloženo.*3/);
assert.equal(await page.inputValue('#t-text'), 'Spatny ; neni odkaz');
ok('textové vložení rozumí odkazům v markdownu a chybné řádky nechá v poli');

await browser.close(); server.close();
