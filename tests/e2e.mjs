// End-to-end test v Chromiu (Playwright). Spuštění: node tests/e2e.mjs
// Síť se nepoužívá: média a „YouTube“ jsou simulované přes page.route.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs');
const shots = process.env.SHOTS || path.join(os.tmpdir(), 'jukebox-shots');
fs.mkdirSync(shots, { recursive: true });

// --- fixtury ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jb-'));
const wav = path.join(tmp, 'tone.wav');
{ const n = 8000 * 20, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / 8000)), 44 + i * 2);
  fs.writeFileSync(wav, b); }
const webm = path.join(tmp, 'clip.webm');
let haveVideo = true;
try { execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15', '-t', '20', '-c:v', 'libvpx', '-b:v', '200k', webm]); }
catch { haveVideo = false; }

const feed = { schema: 1, updated: '2026-10-16T12:00:00Z', items: [
  { id: 'yt1', title: 'Pražské zvony', note: 'Zvuky Prahy', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', added: '2026-10-16' },
  { id: 'au1', title: 'Hudba z <b>rádia</b>', note: 'Čistý tón', url: 'https://media.test/tone.wav', added: '2026-10-16' },
  ...(haveVideo ? [{ id: 'vi1', title: 'Zkušební video', note: 'Barevné pruhy', url: 'https://media.test/clip.webm', added: '2026-10-16' }] : []),
  { id: 'bad', title: 'Zlý odkaz', note: '', url: 'javascript:alert(1)' },
] };
let feedBody = JSON.stringify(feed);

// --- statický server ---
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/feed.json') { res.setHeader('content-type', 'application/json'); return res.end(feedBody); }
  let p = path.join(root, decodeURIComponent(u.pathname));
  if (p.endsWith(path.sep) || (fs.existsSync(p) && fs.statSync(p).isDirectory())) p = path.join(p, 'index.html');
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.statusCode = 404; return res.end('nic'); }
  res.setHeader('content-type', types[path.extname(p)] || 'application/octet-stream');
  res.end(fs.readFileSync(p));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

await ctx.route('https://media.test/**', (route) => {
  const f = route.request().url().endsWith('.wav') ? wav : webm;
  const body = fs.readFileSync(f);
  route.fulfill({ status: 200, body, headers: { 'content-type': f === wav ? 'audio/wav' : 'video/webm', 'accept-ranges': 'none' } });
});
let ytMode = 'ok';
await ctx.route('https://www.youtube-nocookie.com/**', (route) => {
  route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><body style="background:#123;color:#fff">YT STUB<script>
    ${ytMode === 'error' ? "parent.postMessage(JSON.stringify({event:'onError',info:150}),'*');" : ''}
    </script>` });
});

const text = (sel) => page.locator(sel).first().innerText();
const step = async (name, fn) => { await fn(); console.log('✓', name); };

await page.goto(base);
await page.waitForSelector('.item');

await step('seznam se vykreslí a zlá položka se zahodí', async () => {
  assert.equal(await page.locator('.item').count(), feed.items.length - 1);
  assert.equal(await page.locator('.item .badge').count(), feed.items.length - 1);
});
await step('HTML v názvu zůstane textem', async () => {
  assert.equal(await page.locator('.item h3 b').count(), 0);
  assert.match(await text('.item:nth-child(2) h3'), /<b>rádia<\/b>/);
});
await step('všech 7 tlačítek a 2 šipky existuje', async () => {
  assert.equal(await page.locator('#controls .btn').count(), 7);
  const h = await page.locator('#controls .btn').first().boundingBox();
  assert.ok(h.height >= 96, 'výška tlačítka ' + h.height);
});
await page.screenshot({ path: path.join(shots, '1-uvod.png') });

await step('Pustit YouTube: iframe je izolovaný a hraje se', async () => {
  await page.locator('[data-act="item"][data-index="0"]').click();
  const f = page.locator('#stage iframe');
  assert.equal(await f.count(), 1);
  assert.match(await f.getAttribute('src'), /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
  assert.equal(await f.getAttribute('sandbox'), 'allow-scripts allow-same-origin');
  assert.match(await text('#status'), /Hraje: Pražské zvony/);
  assert.equal(await page.locator('#controls [data-act="play"]').getAttribute('data-lit'), 'green');
  assert.equal(await page.locator('.item.playing').count(), 1);
  assert.equal(await page.locator('.item .badge').count(), feed.items.length - 2);
});
await page.screenshot({ path: path.join(shots, '2-hraje.png') });

await step('Pauza / Pokračovat přepíná stav a svítí oranžově', async () => {
  await page.locator('#controls [data-act="pause"]').click();
  assert.match(await text('#status'), /Pozastaveno/);
  assert.equal(await page.locator('#controls [data-act="pause"]').getAttribute('data-lit'), 'orange');
  assert.match(await text('#controls [data-act="pause"] .lbl'), /Pokračovat/);
  await page.waitForTimeout(450);
  await page.locator('#controls [data-act="pause"]').click();
  assert.match(await text('#status'), /Hraje/);
});
await step('druhý stisk téže položky přehrávání vypne', async () => {
  await page.waitForTimeout(450);
  await page.locator('[data-act="item"][data-index="0"]').click();
  assert.match(await text('#status'), /Nic nehraje/);
  assert.equal(await page.locator('#stage iframe').count(), 0);
});
await step('audio se spustí a běží', async () => {
  await page.locator('[data-act="item"][data-index="1"]').click();
  await page.waitForFunction(() => { const a = document.querySelector('#stage audio'); return a && a.currentTime > 0.3 && !a.paused; }, null, { timeout: 8000 });
  assert.match(await text('#status'), /Hraje: Hudba/);
});
await page.screenshot({ path: path.join(shots, '3-audio.png') });
await step('Pauza zastaví audio, Pokračovat ho rozběhne', async () => {
  await page.locator('#controls [data-act="pause"]').click();
  assert.equal(await page.evaluate(() => document.querySelector('#stage audio').paused), true);
  await page.waitForTimeout(450);
  await page.locator('#controls [data-act="pause"]').click();
  await page.waitForFunction(() => !document.querySelector('#stage audio').paused);
});
if (haveVideo) await step('video se spustí', async () => {
  await page.waitForTimeout(450);
  await page.locator('[data-act="item"][data-index="2"]').click();
  await page.waitForFunction(() => { const v = document.querySelector('#stage video'); return v && v.currentTime > 0.3 && !v.paused; }, null, { timeout: 8000 });
});
if (haveVideo) await page.screenshot({ path: path.join(shots, '4-video.png') });

await step('Ukončit vrátí úvodní obrazovku', async () => {
  await page.waitForTimeout(450);
  await page.locator('#controls [data-act="stop"]').click();
  assert.match(await text('#status'), /Nic nehraje/);
  assert.equal(await page.locator('#stage video, #stage audio, #stage iframe').count(), 0);
  assert.equal(await page.locator('#controls [data-act="pause"]').isDisabled(), true);
});
await step('šipka nahoru posune výběr a Pustit spustí vybranou', async () => {
  await page.locator('[data-act="up"]').click();
  assert.equal(await page.locator('.item.selected h3').innerText(), 'Hudba z <b>rádia</b>');
  await page.waitForTimeout(450);
  await page.locator('#controls [data-act="play"]').click();
  assert.match(await text('#status'), /Hraje: Hudba/);
  await page.locator('#controls [data-act="stop"]').click();
});
await step('Zmenšit přepne na lištu a zpět', async () => {
  await page.waitForTimeout(450);
  await page.locator('#controls [data-act="mini"]').click();
  assert.equal(await page.evaluate(() => document.body.classList.contains('mini')), true);
  assert.equal(await page.locator('#listbox').isVisible(), false);
  await page.screenshot({ path: path.join(shots, '5-mini.png') });
  await page.waitForTimeout(450);
  await page.locator('#controls [data-act="mini"]').click();
  assert.equal(await page.locator('#listbox').isVisible(), true);
});
await step('Celá obrazovka zapne a vypne režim fullscreen', async () => {
  await page.locator('#controls [data-act="full"]').click();
  await page.waitForFunction(() => !!document.fullscreenElement).catch(() => {});
  const fs1 = await page.evaluate(() => !!document.fullscreenElement);
  if (fs1) { await page.waitForTimeout(450); await page.locator('#fs-bar [data-act="full"]').click(); await page.waitForFunction(() => !document.fullscreenElement); }
  else console.log('  (headless: fullscreen API nepotvrzeno, přeskočeno)');
});
await step('chyba přehrávání ukáže srozumitelnou hlášku', async () => {
  ytMode = 'error';
  await page.waitForTimeout(450);
  await page.locator('[data-act="item"][data-index="0"]').click();
  await page.waitForFunction(() => /nejde přehrát/.test(document.querySelector('#status').textContent), null, { timeout: 5000 });
});
await step('Zavřít uspí skříň, Zapnout ji vrátí', async () => {
  await page.waitForTimeout(450);
  await page.locator('#controls [data-act="close"]').click();
  assert.equal(await page.locator('#asleep').isVisible(), true);
  assert.equal(await page.locator('#app').isVisible(), false);
  await page.screenshot({ path: path.join(shots, '6-spi.png') });
  await page.locator('#asleep [data-act="wake"]').click();
  assert.equal(await page.locator('#app').isVisible(), true);
});
await step('Novinky načtou nový seznam', async () => {
  feed.items.push({ id: 'new1', title: 'Nový pořad', note: 'Čerstvě přidáno', url: 'https://media.test/tone.wav' });
  feedBody = JSON.stringify(feed);
  await page.waitForTimeout(450);
  await page.locator('#controls [data-act="news"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.item').length >= 3 && /Nový pořad/.test(document.querySelector('#list').textContent));
  assert.match(await text('#status'), /nov/i);
});
await step('offline: zůstane poslední seznam a hláška', async () => {
  await ctx.setOffline(true);
  await page.waitForTimeout(450);
  await page.locator('#controls [data-act="news"]').click();
  await page.waitForFunction(() => /Nejsem připojen/.test(document.querySelector('#status').textContent));
  assert.ok(await page.locator('.item').count() >= 3);
  await ctx.setOffline(false);
});
await step('škodlivý feed (nesprávné schéma) nepřepíše seznam', async () => {
  const before = await page.locator('.item').count();
  feedBody = '{"schema":9,"items":[]}';
  await page.waitForTimeout(450);
  await page.locator('#controls [data-act="news"]').click();
  await page.waitForFunction(() => /Nejsem připojen/.test(document.querySelector('#status').textContent));
  assert.equal(await page.locator('.item').count(), before);
});
await step('CSP blokuje vložený skript a stránka nemá chyby', async () => {
  // page.evaluate obchází CSP, proto vložíme skript jako element, jako by to udělal útočník
  const ran = await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__pwned = 1'; document.head.append(s); return !!window.__pwned; });
  assert.equal(ran, false);
  assert.deepEqual(errors.filter((e) => !/Content Security Policy/.test(e)), []);
});

await browser.close(); server.close();
console.log('\nVše prošlo. Snímky:', shots);
