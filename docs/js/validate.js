// Sdílený validátor. Používá ho přehrávač, editor i testy.
// Feed je jen text: nikdy se nevyhodnocuje jako kód ani HTML.

export const LIMITS = { bytes: 262144, nodes: 300, depth: 5, title: 120, note: 400, id: 40 };

const YT_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'ogv']);
const AUDIO_EXT = new Set(['mp3', 'm4a', 'ogg', 'oga', 'wav']);
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function cleanText(v, max) {
  if (typeof v !== 'string') return null;
  const t = v.replace(CONTROL, '').trim();
  return t.length > max ? null : t;
}

// Vrátí { kind, url, id? } nebo null. Z YouTube odkazu zůstane jen ID videa.
export function parseMediaUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (YT_HOSTS.has(host)) {
    let id = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/^\/(embed|shorts|live)\/([^/]+)/);
      if (m) id = m[2];
    }
    if (!id || !YT_ID.test(id)) return null;
    return { kind: 'youtube', id, url: 'https://www.youtube.com/watch?v=' + id };
  }
  const ext = (u.pathname.split('.').pop() || '').toLowerCase();
  if (VIDEO_EXT.has(ext)) return { kind: 'video', url: u.href };
  if (AUDIO_EXT.has(ext)) return { kind: 'audio', url: u.href };
  return null;
}

function baseFields(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = cleanText(raw.id, LIMITS.id);
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const title = cleanText(raw.title, LIMITS.title);
  if (!title) return null;
  const note = raw.note === undefined ? '' : cleanText(raw.note, LIMITS.note);
  if (note === null) return null;
  const added = typeof raw.added === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.added) ? raw.added : '';
  return { id, title, note, added };
}

// Přehrávatelná položka: { id, title, note, kind, mediaId, url, added } nebo null
export function validateItem(raw) {
  const b = baseFields(raw);
  if (!b) return null;
  const media = parseMediaUrl(raw.url);
  if (!media) return null;
  return { ...b, kind: media.kind, mediaId: media.id || '', url: media.url };
}

// Složka (bez dětí): { id, title, note, kind: 'folder', children: [] } nebo null
export function validateFolder(raw) {
  const b = baseFields(raw);
  return b ? { ...b, kind: 'folder', children: [] } : null;
}

// text -> { items (strom), dropped } ; při vážné chybě vyhodí Error
export function validateFeed(text) {
  if (typeof text !== 'string' || text.length > LIMITS.bytes) throw new Error('Seznam je příliš velký.');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Seznam je poškozený.'); }
  if (!data || typeof data !== 'object' || data.schema !== 1 || !Array.isArray(data.items)) {
    throw new Error('Seznam má neznámý formát.');
  }
  const seen = new Set();
  let budget = LIMITS.nodes;
  let dropped = 0;
  const walk = (list, depth) => {
    const out = [];
    for (const raw of list) {
      if (budget <= 0) { dropped++; continue; }
      const isFolder = raw && typeof raw === 'object' && raw.kind === 'folder';
      const node = isFolder ? (depth < LIMITS.depth ? validateFolder(raw) : null) : validateItem(raw);
      if (!node || seen.has(node.id)) { dropped++; continue; }
      seen.add(node.id);
      budget--;
      if (isFolder && Array.isArray(raw.items)) node.children = walk(raw.items, depth + 1);
      out.push(node);
    }
    return out;
  };
  return { items: walk(data.items, 0), dropped };
}

// Všechny přehrávatelné položky ve stromu (pořadí jako v seznamu)
export function playableIn(nodes, recursive = false) {
  const out = [];
  for (const n of nodes) {
    if (n.kind === 'folder') { if (recursive) out.push(...playableIn(n.children, true)); } else out.push(n);
  }
  return out;
}
