// Přehrávač: YouTube (izolovaný iframe, řízený přes postMessage) a nativní video/audio.
// Nic se nestahuje do souboru, nic se nespouští mimo přehrávací prvek.

const YT_ORIGIN = 'https://www.youtube-nocookie.com';

export function createPlayer(stage, onState) {
  let current = null;      // { item, el, kind }
  let state = 'idle';      // idle | playing | paused | error
  let hs = 0;              // časovač handshaku s YouTube přehrávačem

  function set(s, detail) { state = s; onState(s, detail); }

  function clear() {
    clearInterval(hs);
    delete stage.dataset.yt;
    window.removeEventListener('message', onYtMessage);
    if (current && current.el) {
      if (current.el.pause) { try { current.el.pause(); } catch { /* nic */ } }
      current.el.remove();
    }
    current = null;
    stage.replaceChildren();
  }

  function idleScreen() {
    const wrap = document.createElement('div');
    wrap.className = 'idle';
    const s = document.createElement('span'); s.textContent = '♪';
    const p = document.createElement('p'); p.textContent = 'Vyberte pořad a stiskněte Pustit';
    wrap.append(s, p);
    stage.replaceChildren(wrap);
  }

  function ytCmd(func, args = '') {
    if (!current || current.kind !== 'youtube') return;
    current.el.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), YT_ORIGIN);
  }

  // YouTube načítá přehrávač později než iframe, proto se „listening“ opakuje, dokud neodpoví.
  function startHandshake(el) {
    let n = 0;
    clearInterval(hs);
    hs = setInterval(() => {
      if (!current || current.el !== el || ++n > 60) { clearInterval(hs); return; }
      const post = (m) => el.contentWindow.postMessage(JSON.stringify(m), YT_ORIGIN);
      post({ event: 'listening', id: 1, channel: 'widget' });
      post({ event: 'command', func: 'addEventListener', args: ['onStateChange'] });
      post({ event: 'command', func: 'addEventListener', args: ['onError'] });
    }, 300);
  }

  // fromChange: událost onStateChange (změna stavu, např. klepnutí do videa); infoDelivery jen informuje
  function ytState(code, fromChange) {
    stage.dataset.yt = String(code);
    if (code === 0) finish();
    else if (!fromChange) return;
    else if (code === 2 && state === 'playing') set('paused');
    else if (code === 1 && state === 'paused') set('playing');
  }

  function onYtMessage(ev) {
    if (!current || current.kind !== 'youtube' || ev.origin !== YT_ORIGIN || ev.source !== current.el.contentWindow) return;
    let d;
    try { d = typeof ev.data === 'string' ? JSON.parse(ev.data) : null; } catch { return; }
    if (!d || typeof d !== 'object') return;
    clearInterval(hs); // přehrávač odpovídá, další handshake není potřeba
    if (d.event === 'onError') set('error', 'embed');
    else if (d.event === 'onStateChange' && Number.isInteger(d.info)) ytState(d.info, true);
    else if (d.event === 'infoDelivery' && d.info && Number.isInteger(d.info.playerState)) ytState(d.info.playerState, false);
  }

  function play(item) {
    clear();
    let el;
    if (item.kind === 'youtube') {
      el = document.createElement('iframe');
      const q = new URLSearchParams({ enablejsapi: '1', autoplay: '1', controls: '0', rel: '0', playsinline: '1',
        modestbranding: '1', fs: '0', disablekb: '1', origin: location.origin });
      el.src = YT_ORIGIN + '/embed/' + encodeURIComponent(item.mediaId) + '?' + q;
      el.title = item.title;
      el.setAttribute('allow', 'autoplay; encrypted-media');
      el.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      el.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      el.addEventListener('load', () => startHandshake(el));
      window.addEventListener('message', onYtMessage);
      stage.append(el);
    } else if (item.kind === 'video') {
      el = document.createElement('video');
      el.playsInline = true;
      stage.append(el);
    } else {
      el = document.createElement('audio');
      const n = document.createElement('div'); n.className = 'note-screen';
      const s = document.createElement('span'); s.textContent = '♫';
      const p = document.createElement('p'); p.textContent = item.title;
      n.append(s, p);
      stage.append(n);
    }
    current = { item, el, kind: item.kind };
    if (item.kind !== 'youtube') {
      el.referrerPolicy = 'no-referrer';
      el.addEventListener('ended', finish);
      el.addEventListener('error', () => set('error', 'media'));
      el.src = item.url;
      const pr = el.play();
      if (pr && pr.catch) pr.catch(() => set('error', 'media'));
      if (item.kind === 'audio') stage.append(el); // prvek zůstane v DOM kvůli stavu, bez ovládacích prvků
    }
    set('playing');
  }

  function pause() {
    if (!current || state !== 'playing') return;
    if (current.kind === 'youtube') ytCmd('pauseVideo'); else current.el.pause();
    set('paused');
  }
  function resume() {
    if (!current || state !== 'paused') return;
    if (current.kind === 'youtube') ytCmd('playVideo'); else current.el.play().catch(() => set('error', 'media'));
    set('playing');
  }
  function finish() { if (!current) return; clear(); idleScreen(); set('ended'); }

  function stop() {
    clear();
    idleScreen();
    if (state !== 'idle') set('idle');
  }

  idleScreen();
  return { play, pause, resume, stop, get state() { return state; }, get item() { return current && current.item; } };
}
