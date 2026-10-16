// Knihovna editoru (plochý seznam s polem parent) a její převod na stromový feed pro tátu.
import { validateItem, validateFolder, LIMITS } from './validate.js';

export function parseLibrary(text) {
  const data = JSON.parse(text);
  if (!data || data.schema !== 1 || !Array.isArray(data.items)) throw new Error('Neznámý formát knihovny.');
  const out = [];
  for (const x of data.items) {
    const n = x && x.kind === 'folder' ? validateFolder(x) : validateItem(x);
    if (!n) continue;
    const parent = typeof x.parent === 'string' && /^[A-Za-z0-9_-]{0,40}$/.test(x.parent) ? x.parent : '';
    out.push({ id: n.id, title: n.title, note: n.note, added: n.added, parent, show: x.show === true,
      ...(n.kind === 'folder' ? { kind: 'folder' } : { url: n.url }) });
  }
  return out;
}

export function libraryToText(lib) {
  return JSON.stringify({ schema: 1, items: lib }, null, 2) + '\n';
}

// Je kandidát `parentId` bezpečným rodičem pro složku `id` (ne ona sama ani její potomek)?
export function canParent(lib, id, parentId) {
  let cur = parentId;
  for (let i = 0; cur && i < 50; i++) {
    if (cur === id) return false;
    const p = lib.find((x) => x.id === cur);
    cur = p ? p.parent : '';
  }
  return true;
}

// Strom pro feed: jen zaškrtnuté položky, složky jen když mají co ukázat.
export function buildFeed(lib) {
  const ids = new Set(lib.filter((x) => x.kind === 'folder').map((x) => x.id));
  const kids = new Map();
  for (const x of lib) {
    const p = x.parent && ids.has(x.parent) ? x.parent : '';
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(x);
  }
  const visit = new Set();
  const build = (parent, depth) => {
    const out = [];
    for (const x of kids.get(parent) || []) {
      if (!x.show || visit.has(x.id)) continue;
      if (x.kind === 'folder') {
        if (depth >= LIMITS.depth) continue;
        visit.add(x.id);
        const items = build(x.id, depth + 1);
        if (items.length) out.push({ id: x.id, kind: 'folder', title: x.title, note: x.note, added: x.added, items });
      } else {
        out.push({ id: x.id, title: x.title, note: x.note, url: x.url, added: x.added });
      }
    }
    return out;
  };
  return { schema: 1, updated: new Date().toISOString(), items: build('', 0) };
}
