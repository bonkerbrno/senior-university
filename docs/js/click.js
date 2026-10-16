// Slyšitelné cvaknutí při stisku tlačítka. Zvuk se vyrábí v prohlížeči (žádný soubor, žádný cizí server).
// Hlasitost: základ 0,5, o 25 % hlasitější = 0,625 špičkového výstupu před zesílením.
export const CLICK_GAIN = 0.5 * 1.25;
let ctx = null;

export function clickSound() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = CLICK_GAIN * 1.6; // kompenzace krátkého a tlumeného zvuku
    out.connect(ctx.destination);
    // krátký šum (cvak) + nízké „klap“
    const len = Math.floor(ctx.sampleRate * 0.035);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const noise = ctx.createBufferSource(); noise.buffer = buf;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
    noise.connect(hp); hp.connect(out); noise.start(t);
    const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.setValueAtTime(320, t); osc.frequency.exponentialRampToValueAtTime(90, t + 0.05);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(g); g.connect(out); osc.start(t); osc.stop(t + 0.07);
  } catch { /* bez zvuku to jde také */ }
}
