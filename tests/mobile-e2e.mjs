// End-to-end test mobilní verze (Chromium s rozměry telefonu). Spuštění: node tests/mobile-e2e.mjs
// Síť se nepoužívá: média jsou simulovaná přes page.route.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs');
const shots = process.env.SHOTS || path.join(os.tmpdir(), 'jukebox-shots');
fs.mkdirSync(shots, { recursive: true });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jbm-'));
const wav = path.join(tmp, 'tone.wav');
{ const n = 8000 * 40, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / 8000)), 44 + i * 2);
  fs.writeFileSync(wav, b); }

const med = (id, title) => ({ id, title, note: 'Soubor ' + title, url: 'https://media.test/tone.wav', added: '2026-10-16' });
const yt = (id, title, vid) => ({ id, title, note: '', url: 'https://www.youtube.com/watch?v=' + vid, added: '2026-10-16' });
const feed = { schema: 1, updated: '2026-10-16T12:00:00Z', items: [
  { id: 'f1', kind: 'folder', title: 'Hudba', note: 'Písničky', items: [ med('au1', 'První tón'), med('au2', 'Druhý tón'), yt('yt1', 'Pražské zvony', 'dQw4w9WgXcQ') ] },
  { id: 'f2', kind: 'folder', title: 'Rádio', note: '', items: [ { id: 'f3', kind: 'folder', title: 'Hlubší', note: '', items: [ med('au3', 'Třetí tón') ] } ] },
] };

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/feed.json') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(feed)); }
  let p = path.join(root, decodeURIComponent(u.pathname));
  if (p.endsWith(path.sep) || (fs.existsSync(p) && fs.statSync(p).isDirectory())) p = path.join(p, 'index.html');
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.statusCode = 404; return res.end('nic'); }
  res.setHeader('content-type', types[path.extname(p)] || 'application/octet-stream');
  res.end(fs.readFileSync(p));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
await ctx.route('https://media.test/**', (route) => route.fulfill({ status: 200, body: fs.readFileSync(wav), headers: { 'content-type': 'audio/wav', 'accept-ranges': 'none' } }));
let ytUrl = '';
await ctx.route('https://www.youtube-nocookie.com/**', (route) => { ytUrl = route.request().url(); route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><body>YT</body>' }); });

const step = async (name, fn) => { await fn(); console.log('✓', name); };
const act = (a) => page.locator(`button[data-act="${a}"]:visible`).first();
const vis = (sel) => page.locator(sel).first().isVisible();
const status = () => page.locator('#status').innerText();
const screenName = () => page.evaluate(() => document.body.dataset.screen);
const wait = (ms = 700) => page.waitForTimeout(ms);
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollHeight <= innerHeight + 1), true, 'stránka nesmí přetékat');

await page.goto(base);
await page.waitForSelector('#m-start .btn');

await step('telefon se pozná sám a ukáže obrazovku 1', async () => {
  assert.equal(await page.evaluate(() => document.body.classList.contains('m')), true);
  assert.equal(await screenName(), 'start');
  assert.equal(await vis('#m-start .btn'), true);
  assert.match(await page.locator('#m-start .lbl').first().innerText(), /Listování mezi pořady/);
  assert.match(await page.locator('.m-caption').innerText(), /Rychlá volba/i);
  assert.equal(await vis('#listbox'), false);
  assert.equal(await vis('#controls'), false);
  assert.deepEqual(await page.locator('.m-quick .lbl').allInnerTexts(), ['Rozhovory', 'Hudba', 'Zajímavosti', 'Relaxační', 'Oblíbené', 'Nové']);
  assert.equal(await page.locator('#m-bottom').isVisible(), false);
  const hs = await page.locator('#m-start .btn:visible').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  assert.equal(new Set(hs).size, 1, 'všechna tlačítka na úvodu mají stejnou výšku: ' + hs);
  await noOverflow();
});
await page.screenshot({ path: path.join(shots, 'm1-start.png') });

await step('Listování otevře seznam; Domů a Zpět jsou aktivní a Nahoru/Dolů tam není', async () => {
  await act('m-choose').tap();
  assert.equal(await screenName(), 'list');
  assert.equal(await vis('#listbox'), true);
  assert.equal(await vis('#cabinet'), false);
  assert.match(await page.locator('#marquee').innerText(), /^programy$/i);
  assert.equal(await vis('.arrowrow'), false);
  assert.equal(await act('back').isDisabled(), false);
  assert.equal(await act('home').isDisabled(), false);
  assert.equal(await page.locator('.item').count(), 3); // Novinky, Hudba, Rádio
  await noOverflow();
});
await step('v seznamu se nikde neukáže slovo adresář ani složka', async () => {
  await page.locator('button[data-act="open"][data-index="2"]').tap();
  const t = await page.locator('body').innerText();
  assert.doesNotMatch(t, /adresář|složk/i);
  await act('home').tap();
});
await page.screenshot({ path: path.join(shots, 'm2-seznam.png') });

await step('program se otevře, Zpět a Domů se rozsvítí', async () => {
  await page.locator('button[data-act="open"][data-index="1"]').tap();
  assert.equal(await page.locator('#crumbs').innerText(), 'Domů › Hudba');
  assert.equal(await act('back').isDisabled(), false);
});
await step('klepnutí na program spustí přehrávání a přepne na obrazovku 3', async () => {
  await page.locator('button[data-act="item"][data-index="0"]').tap();
  assert.equal(await screenName(), 'play');
  assert.match(await status(), /Hraje: První tón/);
  assert.equal(await vis('#cabinet'), true);
  assert.equal(await page.locator('#m-play .btn:visible').count(), 8);
  assert.deepEqual(await page.locator('#m-play .m-row').first().locator('.lbl').allInnerTexts(), ['Vypnout', 'Pustit', 'Pozastavit', 'Ukončit']);
  const hs = await page.locator('#m-play .btn:visible, #m-bottom .btn:visible').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  assert.equal(new Set(hs).size, 1, 'stejná výška tlačítek: ' + hs);
  assert.equal(await page.locator('#m-bottom .btn:visible').count(), 4);
  assert.equal(await page.locator('.flag:visible').count(), 3);
  assert.equal(await act('play').getAttribute('data-lit'), 'green');
  await noOverflow();
});
await page.screenshot({ path: path.join(shots, 'm3-hraje.png') });

await step('oválné přepínače mají dva stavy', async () => {
  const f = (k) => page.locator(`.flag[data-flag="${k}"]`);
  const flip = async (k, before, after) => {
    assert.equal(await f(k).innerText(), before);
    await f(k).tap();
    assert.equal(await f(k).innerText(), after);
    assert.equal(await f(k).evaluate((e) => e.classList.contains('on')), true);
    await wait();
    await f(k).tap();
    assert.equal(await f(k).innerText(), before);
    await wait();
  };
  await flip('auto', 'Přehraje jeden', 'Hraje automaticky');
  await flip('shuf', 'Hraje za sebou', 'Náhodné pořadí');
  await flip('subs', 'Titulky vypnuty', 'Titulky zapnuty');
});
await step('Pauza a Pokračovat', async () => {
  await act('pause').tap();
  assert.match(await status(), /Pozastaveno/);
  await wait();
  await act('pause').tap();
  assert.match(await status(), /Hraje/);
});
await step('srdce přidá hrající program do oblíbených a Oblíbené se objeví v seznamu', async () => {
  await act('fav').tap();
  assert.match(await status(), /Přidáno do oblíbených/);
  assert.equal(await act('fav').getAttribute('data-lit'), 'red');
});
await step('Zmenšit ukáže seznam a malé okno, Zvětšit se vrátí', async () => {
  await act('mini').tap();
  assert.equal(await screenName(), 'list');
  assert.equal(await page.evaluate(() => document.body.classList.contains('mini')), true);
  assert.equal(await vis('#screen-wrap'), true);
  await page.screenshot({ path: path.join(shots, 'm4-mini.png') });
  await wait();
  await page.locator('#m-restore').tap();
  assert.equal(await screenName(), 'play');
});
await step('Ukončit vrátí na seznam programů', async () => {
  await act('stop').tap();
  assert.equal(await screenName(), 'list');
});
await page.goto(base + '?mobil=1');
await page.waitForSelector('#m-start .btn');
await step('Nové otevře program Novinky s duplicitami (pustený tón už není nový)', async () => {
  await act('news').tap();
  await wait();
  assert.equal(await screenName(), 'list');
  assert.equal(await page.locator('#crumbs').innerText(), 'Domů › Novinky');
  const titles = await page.locator('.item h3').allInnerTexts();
  assert.equal(titles.length, 3);
  assert.ok(!titles.some((t) => /První tón/.test(t)));
  await act('home').tap();
  const root = await page.locator('.item h3').allInnerTexts();
  assert.match(root[0], /Novinky/);
  assert.match(root[1], /Oblíbené/);
  assert.ok(root.some((t) => /Hudba/.test(t)));
});
await step('Oblíbené obsahuje srdíčkem označený program', async () => {
  await page.locator('button[data-act="open"][data-index="1"]').tap();
  assert.equal(await page.locator('#crumbs').innerText(), 'Domů › Oblíbené');
  assert.match(await page.locator('.item h3').first().innerText(), /První tón/);
});
await page.goto(base + '?mobil=1');
await page.waitForSelector('#m-start .btn');
await step('Nabídni mi pustí program z oblíbených', async () => {
  await act('m-choose').tap();
  await page.locator('button[data-act="open"][data-index="2"]').tap();
  await page.locator('button[data-act="item"][data-index="2"]').tap();
  assert.equal(await screenName(), 'play');
  await act('offer').tap();
  assert.match(await status(), /Hraje: První tón/);
});
await step('Titulky u YouTube přidají cc_load_policy a spustí program znovu', async () => {
  await page.goto(base + '?mobil=1');
  await page.waitForSelector('#m-start .btn');
  await act('m-choose').tap();
  await page.locator('button[data-act="open"][data-index="2"]').tap();
  await page.locator('button[data-act="item"][data-index="2"]').tap();
  assert.match(await status(), /Hraje: Pražské zvony/);
  ytUrl = '';
  await page.locator('.flag[data-flag="subs"]').tap();
  await wait(400);
  assert.match(ytUrl, /cc_load_policy=1/);
  await page.locator('.flag[data-flag="subs"]').tap();
});

await page.goto(base + '?mobil=1');
await page.waitForSelector('#m-start .btn');
await step('rychlá volba Hudba otevře program Hudba; Zpět v kořeni vrátí na úvod', async () => {
  await page.locator('.m-quick [data-name="Hudba"]').tap();
  assert.equal(await screenName(), 'list');
  assert.equal(await page.locator('#crumbs').innerText(), 'Domů › Hudba');
  await act('home').tap();
  assert.equal(await page.locator('#crumbs').innerText(), 'Domů');
  await wait();
  await act('back').tap();
  assert.equal(await screenName(), 'start');
});
await step('rychlá volba bez takového programu to řekne', async () => {
  await page.locator('.m-quick [data-name="Rozhovory"]').tap();
  assert.match(await status(), /Rozhovory.*zatím není/);
  assert.equal(await screenName(), 'start');
});
await step('na celou obrazovku zůstane Pozastavit, Ukončit, Zmenšit a Seznam programů', async () => {
  await act('m-choose').tap();
  await page.locator('button[data-act="open"][data-index="2"]').tap();
  await page.locator('button[data-act="item"][data-index="0"]').tap();
  await wait();
  await act('full').tap();
  await wait();
  assert.equal(await page.evaluate(() => document.body.classList.contains('fakefs') || !!document.fullscreenElement), true);
  const labels = await page.locator('.fs-bar .btn:visible .lbl').allInnerTexts();
  assert.deepEqual(labels, ['Pozastavit', 'Ukončit', 'Zmenšit', 'Seznam programů']);
  await page.screenshot({ path: path.join(shots, 'm6-cela.png') });
  await page.locator('.fs-bar [data-act="channels"]').tap();
  assert.equal(await screenName(), 'list');
});

await step('Vypnout: vše zešedne, jen Zapnout je aktivní; Zapnout vrátí na začátek', async () => {
  await page.goto(base + '?mobil=1');
  await page.waitForSelector('#m-start .btn');
  await act('m-choose').tap();
  await page.locator('button[data-act="open"][data-index="2"]').tap();
  await page.locator('button[data-act="item"][data-index="0"]').tap();
  assert.equal(await page.locator('[data-act="close"] .lbl:visible').first().innerText(), 'Vypnout');
  await act('close').tap();
  assert.equal(await page.evaluate(() => document.body.dataset.power), 'off');
  assert.equal(await page.locator('[data-act="close"] .lbl:visible').first().innerText(), 'Zapnout');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#m-play [data-act="play"]')).pointerEvents), 'none');
  await page.screenshot({ path: path.join(shots, 'm5-spi.png') });
  await wait();
  await act('close').tap();
  assert.equal(await page.evaluate(() => document.body.dataset.power), 'on');
  assert.equal(await screenName(), 'start');
});

await step('na počítači se mobilní prvky nezobrazí', async () => {
  const d = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const pg = await d.newPage();
  await pg.goto(base);
  await pg.waitForSelector('#controls');
  assert.equal(await pg.evaluate(() => document.body.classList.contains('m')), false);
  assert.equal(await pg.locator('#m-start').isVisible(), false);
  assert.equal(await pg.locator('#m-play').isVisible(), false);
  assert.equal(await pg.locator('.m-flags').isVisible(), false);
  await d.close();
});

assert.deepEqual(errors, [], 'v konzoli nesmí být chyby: ' + errors.join(' | '));
console.log('\nVše prošlo. Snímky:', shots);
await browser.close(); server.close();
