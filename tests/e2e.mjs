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
{ const n = 8000 * 3, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / 8000)), 44 + i * 2);
  fs.writeFileSync(wav, b); }
const webm = path.join(tmp, 'clip.webm');
let haveVideo = true;
try { execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15', '-t', '20', '-c:v', 'libvpx', '-b:v', '200k', webm]); }
catch { haveVideo = false; }

const yt = (id, title, vid) => ({ id, title, note: 'Zkušební ' + title, url: 'https://www.youtube.com/watch?v=' + vid, added: '2026-10-16' });
const med = (id, title, file) => ({ id, title, note: 'Soubor ' + title, url: 'https://media.test/' + file, added: '2026-10-16' });
const feed = { schema: 1, updated: '2026-10-16T12:00:00Z', items: [
  { id: 'f1', kind: 'folder', title: 'Hudba', note: 'Písničky', items: [
    yt('yt1', 'Pražské zvony', 'dQw4w9WgXcQ'),
    med('au1', 'Hudba z <b>rádia</b>', 'tone.wav'),
    { id: 'f2', kind: 'folder', title: 'Podsložka', note: 'Hlubší úroveň', items: haveVideo ? [med('vi1', 'Zkušební video', 'clip.webm')] : [med('au3', 'Druhý tón', 'tone.wav')] },
  ] },
  med('au2', 'Samostatný tón', 'tone.wav'),
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
  // Simulace YouTube přehrávače: odpovídá až na druhé „listening“, hlásí změny stavu a umí skončit nebo selhat.
  route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><body style="background:#123;color:#fff">YT STUB<script>
    const mode = ${JSON.stringify(ytMode)};
    let heard = 0, ready = false;
    const out = (o) => parent.postMessage(JSON.stringify(o), '*');
    if (mode === 'error') setTimeout(() => out({ event: 'onError', info: 150 }), 200);
    addEventListener('message', (e) => {
      let d; try { d = JSON.parse(e.data); } catch { return; }
      if (d.event === 'listening' && ++heard >= 2 && !ready) {
        ready = true;
        out({ event: 'initialDelivery', info: { playerState: 1 } });
        out({ event: 'onStateChange', info: 1 });
        if (mode === 'short') setTimeout(() => out({ event: 'onStateChange', info: 0 }), 1500);
      }
      if (d.event === 'command' && d.func === 'pauseVideo') { out({ event: 'onStateChange', info: 2 }); out({ event: 'infoDelivery', info: { playerState: 2 } }); }
      if (d.event === 'command' && d.func === 'playVideo') { out({ event: 'onStateChange', info: 1 }); out({ event: 'infoDelivery', info: { playerState: 1 } }); }
    });
    </script>` });
});

const text = (sel) => page.locator(sel).first().innerText();
const step = async (name, fn) => { await fn(); console.log('✓', name); };
const act = (a, i) => page.locator(i === undefined ? `button[data-act="${a}"]:visible` : `button[data-act="${a}"][data-index="${i}"]`).first();
const lit = (a) => act(a).getAttribute('data-lit');
const wait = (ms = 650) => page.waitForTimeout(ms);
const status = () => text('#status');

await page.goto(base);
await page.waitForSelector('.item');

await step('nadpis, 8 hlavních tlačítek a Domů/Zpět', async () => {
  assert.match(await text('h1'), /Stanleyho Superbox 85/i);
  assert.deepEqual(await page.locator('#m-panel .lbl').allInnerTexts(), ['Vypnout', 'Pustit', 'Ukončit']);
  assert.deepEqual(await page.locator('#d-row .lbl').allInnerTexts(), ['Celá obrazovka', 'Automat', 'Náhodně', 'Titulky', 'Novinky']);
  assert.equal(await page.locator('#controls').isVisible(), false);
  assert.ok((await page.locator('#m-panel .btn').first().boundingBox()).height >= 90);
  const [v, i, pn, r] = await Promise.all(['#screen-wrap', '#infobar', '#m-panel', '#d-row'].map((q) => page.locator(q).boundingBox()));
  assert.ok(v.y < i.y && i.y < pn.y && pn.y < r.y, 'vlevo shora: okno, popisy, panel, řada tlačítek');
  const [up, down, list] = await Promise.all(['[data-act="up"]', '[data-act="down"]', '#list'].map((q) => page.locator(q).boundingBox()));
  assert.ok(up.x >= list.x + list.width - 2 && Math.abs(up.x - down.x) < 2 && down.y > up.y, 'šipky jsou svisle vpravo od seznamu');
  assert.equal(await page.locator('.arrow .lbl').first().evaluate((e) => e.getBoundingClientRect().width), 1, 'šipky bez viditelného popisu');
  assert.equal(await act('back').isDisabled(), true);
  assert.equal(await act('home').isDisabled(), true);
});
await step('v kořeni je složka a položka, zlá položka je zahozena', async () => {
  assert.equal(await page.locator('.item').count(), 2);
  assert.equal(await page.locator('.item.folder').count(), 1);
  assert.match(await text('.item.folder .ttl'), /Hudba/);
  assert.match(await text('.item.folder .ttl'), /3 programů|\(\d+ program/);
});
await page.screenshot({ path: path.join(shots, '1-uvod.png') });

await step('otevření složky: drobečky, Zpět a Domů se rozsvítí/povolí', async () => {
  await act('open', 0).click();
  assert.equal(await text('#crumbs'), 'Domů › Hudba');
  assert.equal(await page.locator('.item').count(), 3);
  assert.equal(await act('back').isDisabled(), false);
  assert.equal(await act('home').isDisabled(), false);
});
await step('rychlé trojklikání na Pustit dělá totéž co jedno kliknutí', async () => {
  await act('item', 0).click({ clickCount: 3, delay: 40 });
  assert.match(await status(), /Hraje: Pražské zvony/);
  assert.equal(await page.locator('#stage iframe').count(), 1);
  assert.match(await page.locator('#stage iframe').getAttribute('sandbox'), /allow-scripts allow-same-origin/);
  assert.equal(await lit('pp'), 'green');
  assert.match(await text('#substatus'), /Program: Domů › Hudba/);
  assert.match(await text('#substatus'), /Automat: vypnut/);
});
await page.screenshot({ path: path.join(shots, '2-hraje-ve-slozce.png') });
await step('pod videem je pruh s informací (infobar je pod obrazovkou)', async () => {
  const s = await page.locator('#screen-wrap').boundingBox(), i = await page.locator('#infobar').boundingBox();
  assert.ok(i.y >= s.y + s.height - 2, 'infobar pod videem');
});
await step('procházení složek video nezastaví', async () => {
  await act('home').click();
  assert.equal(await text('#crumbs'), 'Domů');
  assert.equal(await page.locator('#stage iframe').count(), 1);
  assert.match(await status(), /Hraje: Pražské zvony/);
  assert.equal(await page.locator('.item.playing').count(), 0); // hrající položka je v jiné složce
  await wait(); await act('open', 0).click();
  assert.equal(await page.locator('.item.playing').count(), 1);
});
await step('rychlé dvojkliknutí na Pauzu = jedna pauza, pak Pokračovat', async () => {
  await act('pp').dblclick();
  assert.match(await status(), /Pozastaveno/);
  assert.equal(await lit('pp'), 'orange');
  await wait(); await act('pp').click();
  assert.match(await status(), /Hraje/);
});
await step('další kliknutí na hrající položku ji vypne', async () => {
  await wait(); await act('item', 0).click();
  assert.match(await status(), /Nic nehraje/);
  assert.equal(await page.locator('#stage iframe').count(), 0);
});
await step('audio ve složce hraje; Ukončit ho zastaví', async () => {
  await act('item', 1).click();
  await page.waitForFunction(() => { const a = document.querySelector('#stage audio'); return a && a.currentTime > 0.3 && !a.paused; }, null, { timeout: 8000 });
  await page.screenshot({ path: path.join(shots, '3-audio.png') });
  await act('stop').click();
  assert.equal(await page.locator('#stage audio, #stage iframe, #stage video').count(), 0);
});
await step('YouTube: handshake, pauza a pokračování se skutečně předají přehrávači', async () => {
  await act('item', 0).click();
  await page.waitForFunction(() => document.querySelector('#stage').dataset.yt === '1', null, { timeout: 5000 });
  await wait(); await act('pp').click();
  await page.waitForFunction(() => document.querySelector('#stage').dataset.yt === '2', null, { timeout: 5000 });
  await wait(); await act('pp').click();
  await page.waitForFunction(() => document.querySelector('#stage').dataset.yt === '1', null, { timeout: 5000 });
  await wait(); await act('stop').click();
});
await step('Automat: po skončení tónu naváže další pořad ze složky', async () => {
  await act('auto').click();
  assert.equal(await lit('auto'), 'green');
  assert.match(await text('#substatus'), /Automat: zapnut/);
  await wait(); await act('item', 1).click();            // au1 (3 s) -> další v pořadí je yt1
  await page.waitForFunction(() => /Hraje: Pražské zvony/.test(document.querySelector('#status').textContent), null, { timeout: 12000 });
  await page.screenshot({ path: path.join(shots, '4-automat.png') });
});
await step('Automat: po skončení YouTube videa naváže další (au1 -> yt1 -> au1)', async () => {
  ytMode = 'short';
  await page.reload(); await page.waitForSelector('.item');
  await act('open', 0).click(); await wait();
  await act('auto').click(); await wait();
  await act('item', 0).click();                                  // yt1 skončí po 1,5 s
  await page.waitForFunction(() => /Hraje: Hudba z/.test(document.querySelector('#status').textContent), null, { timeout: 12000 });
  ytMode = 'ok'; await act('auto').click(); await wait(); await act('stop').click();
});
await step('Náhodně ve složce: rozsvítí se a pustí pořad; druhým stiskem zhasne', async () => {
  await act('shuf').click();
  assert.equal(await lit('shuf'), 'green');
  assert.match(await text('#substatus'), /Náhodně v programu/);
  assert.match(await status(), /Hraje:/);
  await wait(); await act('shuf').click();
  assert.equal(await lit('shuf'), null);
});
await step('Náhodně ze všeho: pustí pořad z celé knihovny', async () => {
  await page.locator('[data-act="rand-all"]').dispatchEvent('click');
  assert.equal(await page.locator('[data-act="rand-all"]').getAttribute('data-lit'), 'blue');
  assert.match(await status(), /Hraje:/);
  assert.match(await text('#substatus'), /Náhodně ze všeho/);
  await wait(); await page.locator('[data-act="rand-all"]').dispatchEvent('click');
  assert.equal(await page.locator('[data-act="rand-all"]').getAttribute('data-lit'), null);
  assert.equal(await lit('auto'), null);
});
await step('podsložka: Zpět vrací o úroveň, Domů do kořene', async () => {
  await act('stop').click(); await wait();
  await act('open', 2).click();
  assert.equal(await text('#crumbs'), 'Domů › Hudba › Podsložka');
  await act('back').click();
  assert.equal(await text('#crumbs'), 'Domů › Hudba');
  await wait(); await act('open', 2).click(); await wait(); await act('home').click();
  assert.equal(await text('#crumbs'), 'Domů');
});
if (haveVideo) await step('video z podsložky se spustí', async () => {
  await wait(); await act('open', 0).click(); await wait(); await act('open', 2).click();
  await act('item', 0).click();
  await page.waitForFunction(() => { const v = document.querySelector('#stage video'); return v && v.currentTime > 0.3 && !v.paused; }, null, { timeout: 8000 });
  await page.screenshot({ path: path.join(shots, '5-video.png') });
  await act('stop').click(); await wait(); await act('home').click();
});
await step('Zmenšit přepne na lištu a zpět', async () => {
  await wait(); await page.locator('#controls [data-act="mini"]').dispatchEvent('click');
  assert.equal(await page.evaluate(() => document.body.classList.contains('mini')), true);
  assert.equal(await page.locator('#listbox').isVisible(), false);
  await page.screenshot({ path: path.join(shots, '6-mini.png') });
  await wait(); await page.locator('#controls [data-act="mini"]').dispatchEvent('click');
  assert.equal(await page.locator('#listbox').isVisible(), true);
});
await step('Celá obrazovka zapne a vypne režim fullscreen', async () => {
  await act('full').click();
  await page.waitForFunction(() => !!document.fullscreenElement).catch(() => {});
  if (await page.evaluate(() => !!document.fullscreenElement)) { await wait(); await page.locator('#fs-bar [data-act="full"]').click(); await page.waitForFunction(() => !document.fullscreenElement); }
  else console.log('  (headless: fullscreen API nepotvrzeno, přeskočeno)');
});
await step('v celé obrazovce je tlačítko Zapnout/Vypnout titulky a svítí modře', async () => {
  const b = page.locator('#fs-bar [data-act="subs"]');
  assert.equal(await b.getAttribute('data-lit'), 'blue');
  assert.equal(await b.locator('.lbl').innerText(), 'Zapnout titulky');
  await b.dispatchEvent('click'); await wait();
  assert.equal(await b.locator('.lbl').innerText(), 'Vypnout titulky');
  assert.equal(await b.getAttribute('data-lit'), 'blue');
  await b.dispatchEvent('click'); await wait();
  assert.equal(await b.locator('.lbl').innerText(), 'Zapnout titulky');
});
await step('v celé obrazovce: Přeladit přepne dál, Seznam kanálů vrátí výchozí vzhled; stisk tlačítka cvakne', async () => {
  await page.evaluate(() => { window.__clicks = 0; const o = AudioContext.prototype.createBufferSource; AudioContext.prototype.createBufferSource = function () { window.__clicks++; return o.call(this); }; });
  await wait(); if (await act('home').isEnabled()) { await act('home').click(); await wait(); } await act('open', 0).click(); await wait(); await act('item', 0).click(); await wait();
  const before = await text('#status');
  await act('full').click(); await wait();
  if (await page.evaluate(() => !!document.fullscreenElement)) {
    await page.locator('#fs-bar [data-act="tune"]').click(); await wait();
    assert.notEqual(await text('#status'), before);
    await page.locator('#fs-bar [data-act="channels"]').click();
    await page.waitForFunction(() => !document.fullscreenElement);
    assert.equal(await page.locator('#listbox').isVisible(), true);
  } else console.log('  (headless: fullscreen API nepotvrzeno, přeskočeno)');
  assert.ok(await page.evaluate(() => window.__clicks) > 0, 'zvuk kliknutí se nespustil');
  await act('stop').click(); await wait(); await act('home').click();
});
await step('chyba přehrávání ukáže srozumitelnou hlášku', async () => {
  ytMode = 'error';
  await wait(); await act('open', 0).click(); await wait();
  await act('item', 0).click();
  await page.waitForFunction(() => /nejde přehrát/.test(document.querySelector('#status').textContent), null, { timeout: 5000 });
  await wait(); await act('home').click();
});
await step('Vypnout zešedne aplikaci do lišty s tlačítkem Zapnout (svítí červeně), Zapnout ji vrátí', async () => {
  await wait(); await act('close').click();
  assert.equal(await page.evaluate(() => document.body.dataset.power), 'off');
  assert.equal(await page.locator('#listbox').isVisible(), false);
  assert.equal(await page.locator('#screen-wrap').isVisible(), false);
  const on = page.locator('#m-panel [data-act="close"]');
  assert.equal(await on.innerText(), 'Zapnout');
  assert.equal(await on.isVisible(), true);
  await wait(400);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#m-panel [data-act="close"] .lamp')).backgroundColor), 'rgb(255, 74, 61)');
  const bar = await page.locator('#cabinet').boundingBox();
  assert.ok(bar.height < 220 && bar.y + bar.height >= page.viewportSize().height - 2, 'lišta dole: ' + JSON.stringify(bar));
  await page.locator('#list').evaluate((e) => e.querySelector('button') && e.querySelector('button').click()).catch(() => {});
  assert.equal(await page.locator('.item.playing').count(), 0);
  await page.screenshot({ path: path.join(shots, '7-spi.png') });
  await wait(); await on.click();
  assert.equal(await page.evaluate(() => document.body.dataset.power), 'on');
  assert.equal(await page.locator('#listbox').isVisible(), true);
});
await step('Novinky načtou nový seznam a pozdrží se ve složce', async () => {
  feed.items.push(med('new1', 'Nový pořad', 'tone.wav'));
  feedBody = JSON.stringify(feed);
  await wait(); await act('news').click();
  await page.waitForFunction(() => /Nový pořad/.test(document.querySelector('#list').textContent));
  assert.match(await status(), /novink|nové/i);
});
await step('offline: zůstane poslední seznam a hláška', async () => {
  await ctx.setOffline(true);
  await wait(); await act('news').click();
  await page.waitForFunction(() => /Nejsem připojen/.test(document.querySelector('#status').textContent));
  assert.ok(await page.locator('.item').count() >= 3);
  await ctx.setOffline(false);
});
await step('škodlivý feed (nesprávné schéma) nepřepíše seznam', async () => {
  const before = await page.locator('.item').count();
  feedBody = '{"schema":9,"items":[]}';
  await wait(); await act('news').click();
  await page.waitForFunction(() => /Nejsem připojen/.test(document.querySelector('#status').textContent));
  assert.equal(await page.locator('.item').count(), before);
});
await step('HTML v názvu zůstane textem', async () => {
  feedBody = JSON.stringify(feed);
  await wait(); await act('news').click();
  await page.waitForSelector('.item.folder'); await wait(); await act('open', 0).click();
  assert.equal(await page.locator('.item .ttl b').count(), 0);
  assert.match(await text('.item:nth-child(2) .ttl'), /<b>rádia<\/b>/);
});
await step('CSP blokuje vložený skript a stránka nemá chyby', async () => {
  const ran = await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__pwned = 1'; document.head.append(s); return !!window.__pwned; });
  assert.equal(ran, false);
  assert.deepEqual(errors.filter((e) => !/Content Security Policy/.test(e)), []);
});

await browser.close(); server.close();
console.log('\nVše prošlo. Snímky:', shots);
