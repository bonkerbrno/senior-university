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

const boot = async (url = base + '?mobil=1') => { await page.goto(url); await page.waitForSelector('#m-panel .btn'); };
await page.goto(base);
await page.waitForSelector('#m-panel .btn');
const row = (name) => page.locator('.trow', { hasText: name }).first();
const rows = () => page.locator('.trow .tt').allInnerTexts();
const fsOn = () => page.evaluate(() => !!document.fullscreenElement);

await step('telefon se pozná sám a domovská obrazovka je přehrávání se dvěma řádky pod videem', async () => {
  assert.equal(await page.evaluate(() => document.body.classList.contains('m')), true);
  assert.equal(await screenName(), 'play');
  assert.equal(await vis('#listbox'), false);
  assert.equal(await vis('#m-start'), false);
  assert.match(await status(), /Vítejte/);
  assert.match(await page.locator('#substatus').innerText(), /Programy/);
  const lines = await page.locator('#infobar').evaluate((e) => [...e.children].map((c) => c.getBoundingClientRect().height));
  assert.equal(lines.length, 2);
  assert.equal(await page.locator('#infobar .flag').count(), 0);
  await noOverflow();
});
await step('tlačítko Celá obrazovka svítí modře a první klepnutí zapne celou obrazovku', async () => {
  assert.equal(await act('full').getAttribute('data-lit'), 'blue');
  await page.locator('#m-panel').tap({ position: { x: 3, y: 3 } });
  await wait(300);
  assert.equal(await fsOn(), true);
  assert.equal(await page.locator('[data-act="full"] .lbl:visible').first().innerText(), 'Zmenšit');
  assert.equal(await act('full').getAttribute('data-lit'), 'blue');
});
await step('Zmenšit vypne celou obrazovku a nápis se vrátí na Celá obrazovka', async () => {
  await wait();
  await act('full').tap();
  await wait(300);
  assert.equal(await fsOn(), false);
  assert.equal(await page.locator('[data-act="full"] .lbl:visible').first().innerText(), 'Celá obrazovka');
  assert.equal(await act('full').getAttribute('data-lit'), 'blue');
  await wait();
  await act('full').tap();
  await wait(300);
  assert.equal(await fsOn(), true);
});
await page.screenshot({ path: path.join(shots, 'm1-domov.png') });

await step('Programy otevře strom: složky sbalené, dole Domů, Zpět a Celá obrazovka s modrou', async () => {
  await wait();
  await act('browse').tap();
  assert.equal(await screenName(), 'list');
  assert.match(await page.locator('#marquee').innerText(), /^programy$/i);
  assert.equal(await vis('.arrowrow'), false);
  assert.equal(await vis('#crumbs'), false);
  assert.equal(await act('back').isDisabled(), false);
  assert.equal(await act('home').isDisabled(), false);
  assert.equal(await page.locator('#listbox [data-act="full"]').getAttribute('data-lit'), 'blue');
  const r = await rows();
  assert.equal(r.length, 3); // Novinky, Hudba, Rádio
  assert.match(r[0], /Novinky/);
  await noOverflow();
});
await step('klepnutí na složku ji rozbalí na místě a program je odsazený; vnořená složka se rozbalí také', async () => {
  await row('Rádio').tap();
  assert.equal(await row('Hlubší').isVisible(), true);
  assert.equal(await row('Hlubší').evaluate((e) => e.classList.contains('d1')), true);
  await row('Hlubší').tap();
  assert.equal(await row('Třetí tón').evaluate((e) => e.classList.contains('d2')), true);
  assert.equal(await row('Rádio').getAttribute('aria-expanded'), 'true');
  const t = await page.locator('body').innerText();
  assert.doesNotMatch(t, /adresář|složk/i);
});
await page.screenshot({ path: path.join(shots, 'm2-seznam.png') });
await step('Zpět sbalí naposledy rozbalenou složku, Domů sbalí vše', async () => {
  await act('back').tap();
  assert.equal(await page.locator('.trow', { hasText: 'Třetí tón' }).count(), 0);
  assert.equal(await row('Hlubší').isVisible(), true);
  await wait();
  await row('Hudba').tap();
  await wait();
  await act('home').tap();
  assert.equal((await rows()).length, 3);
});
await step('Domů ve sbaleném seznamu vrátí na domovskou obrazovku', async () => {
  await wait();
  await act('home').tap();
  assert.equal(await screenName(), 'play');
  await act('browse').tap();
});
await step('klepnutí na program spustí přehrávání na domovské obrazovce', async () => {
  await row('Hudba').tap();
  await row('První tón').tap();
  assert.equal(await screenName(), 'play');
  assert.match(await status(), /Hraje: První tón/);
  assert.match(await page.locator('#substatus').innerText(), /Domů › Hudba/);
  assert.equal(await vis('#cabinet'), true);
  assert.equal(await page.locator('#m-panel .btn:visible').count(), 3);
  assert.equal(await page.locator('#m-play .btn:visible').count(), 3);
  assert.equal(await page.locator('#m-bottom .btn:visible').count(), 4);
  assert.equal(await page.locator('.flag:visible').count(), 3);
  assert.equal(await act('pp').getAttribute('data-lit'), 'green');
  assert.equal(await act('pp').innerText(), 'Pozastavit');
  await noOverflow();
});
await step('panel Vypnout, Pustit/Pozastavit, Ukončit je pod přepínači a před ostatními tlačítky', async () => {
  assert.deepEqual(await page.locator('#m-panel .lbl').allInnerTexts(), ['Vypnout', 'Pozastavit', 'Ukončit']);
  const f = await page.locator('#m-flags').boundingBox(), p = await page.locator('#m-panel').boundingBox(), r2 = await page.locator('#m-play').boundingBox();
  assert.ok(p.y >= f.y + f.height - 1 && p.y < f.y + f.height + 40, 'panel je pod přepínači');
  const br = await page.locator('#m-browse').boundingBox();
  assert.ok(br.y >= p.y + p.height - 1 && br.y < p.y + p.height + 24, 'Programy je hned pod panelem');
  assert.ok(r2.y > br.y + br.height, 'ostatní tlačítka jsou pod ním');
  const hs = await page.locator('#m-browse .btn, #m-play .btn, #m-bottom .btn').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  assert.equal(new Set(hs).size, 1, 'stejná výška ostatních tlačítek: ' + hs);
  const ph = await page.locator('#m-panel .btn').first().evaluate((e) => Math.round(e.getBoundingClientRect().height));
  assert.ok(ph >= hs[0] * 1.25, 'tlačítka panelu jsou o 30 % vyšší: ' + ph + ' proti ' + hs[0]);
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
await step('Pozastavit a Pokračovat', async () => {
  await act('pp').tap();
  assert.match(await status(), /Pozastaveno/);
  assert.equal(await act('pp').innerText(), 'Pustit');
  await wait();
  await act('pp').tap();
  assert.match(await status(), /Hraje/);
});
await step('srdce přidá hrající program do oblíbených', async () => {
  await act('fav').tap();
  assert.match(await status(), /Přidáno do oblíbených/);
  assert.equal(await act('fav').getAttribute('data-lit'), 'green');
});
await step('Programy ukáže seznam rozbalený u hrajícího programu; hudba hraje dál', async () => {
  await wait();
  await act('browse').tap();
  assert.equal(await screenName(), 'list');
  assert.equal(await row('První tón').evaluate((e) => e.classList.contains('playing')), true);
  assert.equal(await vis('#screen-wrap'), false);
  assert.equal(await page.evaluate(() => !document.querySelector('audio').paused), true);
  await page.screenshot({ path: path.join(shots, 'm4-seznam-hraje.png') });
  await wait();
  await act('home').tap();
  await wait();
  await act('home').tap();
  assert.equal(await screenName(), 'play');
});
await step('Ukončit zůstane na domovské obrazovce', async () => {
  await wait();
  await act('stop').tap();
  assert.equal(await screenName(), 'play');
  assert.match(await status(), /Nic nehraje/);
});
await boot();
await step('Nové otevře strom s rozbalenými Novinkami; puštěný tón v nich už není', async () => {
  await act('news').tap();
  await wait();
  assert.equal(await screenName(), 'list');
  const r = await rows();
  assert.match(r[0], /Novinky/);
  assert.equal(await row('Novinky').getAttribute('aria-expanded'), 'true');
  const inNews = await page.locator('.trow.d1 .tt').allInnerTexts();
  assert.equal(inNews.filter((t) => /tón|zvony/.test(t)).length >= 3, true);
  assert.ok(!inNews.slice(0, 3).some((t) => /První tón/.test(t)));
});
await step('Oblíbené je složka na začátku stromu a obsahuje označený program', async () => {
  await act('home').tap();
  await wait();
  await row('Oblíbené').tap();
  assert.equal(await row('Oblíbené').getAttribute('aria-expanded'), 'true');
  assert.match(await page.locator('.trow.d1 .tt').first().innerText(), /První tón/);
});
await boot();
await step('Nabídni mi pustí program z oblíbených', async () => {
  await act('browse').tap();
  await row('Hudba').tap();
  await row('Pražské zvony').tap();
  assert.equal(await screenName(), 'play');
  await act('offer').tap();
  assert.match(await status(), /Hraje: První tón/);
});
await step('Titulky u YouTube přidají cc_load_policy a spustí program znovu', async () => {
  await boot();
  await act('browse').tap();
  await row('Hudba').tap();
  await row('Pražské zvony').tap();
  assert.match(await status(), /Hraje: Pražské zvony/);
  ytUrl = '';
  await page.locator('.flag[data-flag="subs"]').tap();
  await wait(400);
  assert.match(ytUrl, /cc_load_policy=1/);
  await wait();
  await page.locator('.flag[data-flag="subs"]').tap();
});
await step('Vypnout: vše zešedne, jen Zapnout je aktivní; Zapnout vrátí na domovskou obrazovku', async () => {
  await boot();
  await act('browse').tap();
  await row('Hudba').tap();
  await row('První tón').tap();
  assert.equal(await page.locator('[data-act="close"] .lbl:visible').first().innerText(), 'Vypnout');
  await act('close').tap();
  assert.equal(await page.evaluate(() => document.body.dataset.power), 'off');
  assert.equal(await page.locator('[data-act="close"] .lbl:visible').first().innerText(), 'Zapnout');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#m-play [data-act="auto"]')).pointerEvents), 'none');
  await page.screenshot({ path: path.join(shots, 'm5-spi.png') });
  await wait();
  await act('close').tap();
  assert.equal(await page.evaluate(() => document.body.dataset.power), 'on');
  assert.equal(await screenName(), 'play');
});
await step('na šířku: video, dva řádky a jedna řada tlačítek Vypnout, Pustit, Celá obrazovka, Domů, Programy 2× širší, bez popisku', async () => {
  const l = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pg = await l.newPage();
  await l.route('https://media.test/**', (route) => route.fulfill({ status: 200, body: fs.readFileSync(wav), headers: { 'content-type': 'audio/wav', 'accept-ranges': 'none' } }));
  await pg.goto(base + '?mobil=1');
  await pg.waitForSelector('#m-land .btn');
  assert.equal(await pg.locator('#m-land').isVisible(), true);
  assert.equal(await pg.locator('#m-panel').isVisible(), false);
  assert.deepEqual(await pg.locator('#m-land .lbl').allInnerTexts(), ['Vypnout', 'Pustit', 'Celá obrazovka', 'Domů', 'Programy']);
  const ys = await pg.locator('#m-land .btn').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  assert.equal(new Set(ys).size, 1, 'jedna řada: ' + ys);
  const xs = await pg.locator('#m-land .btn').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left));
  assert.deepEqual([...xs].sort((a, b) => a - b), xs, 'zleva doprava ve správném pořadí');
  const wide = await pg.locator('#m-land .btn.wide').boundingBox(), narrow = await pg.locator('#m-land .btn').first().boundingBox();
  assert.ok(wide.width > narrow.width * 1.8, 'Programy je 2× širší');
  assert.equal(await pg.locator('#infobar').isVisible(), false, 'video nemá popisek');
  assert.equal(await pg.locator('#m-land [data-act="full"]').getAttribute('data-lit'), 'blue');
  const sw = await pg.locator('#screen-wrap').boundingBox();
  assert.ok(sw.height > 120, 'video má místo: ' + sw.height);
  assert.equal(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollHeight <= innerHeight + 1), true, 'bez přetékání');
  await pg.screenshot({ path: path.join(shots, 'm7-sirka.png') });
  await l.close();
});
await step('na počítači se mobilní rozvržení nezobrazí (panel je společný)', async () => {
  const d = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const pg = await d.newPage();
  await pg.goto(base);
  await pg.waitForSelector('#d-row');
  assert.equal(await pg.evaluate(() => document.body.classList.contains('m')), false);
  assert.equal(await pg.locator('#m-play').isVisible(), false);
  assert.equal(await pg.locator('#m-panel').isVisible(), true);
  assert.equal(await pg.locator('#m-bottom').isVisible(), false);
  assert.equal(await pg.locator('#m-browse').isVisible(), false);
  assert.equal(await pg.locator('#m-land').isVisible(), false);
  assert.equal(await pg.locator('.m-only').first().isVisible(), false);
  assert.equal(await pg.locator('.m-flags').isVisible(), false);
  await d.close();
});

assert.deepEqual(errors, [], 'v konzoli nesmí být chyby: ' + errors.join(' | '));
console.log('\nVše prošlo. Snímky:', shots);
await browser.close(); server.close();
