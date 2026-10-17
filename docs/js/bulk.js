// Hromadné vkládání: čtení tabulky vložené z Excelu (oddělené tabulátory) a cest kategorií.

// text ze schránky -> pole řádků (každý řádek pole buněk). Podporuje buňky v uvozovkách (Excel je používá při zalomení řádku).
export function parseTable(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = String(text).replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell); rows.push(row);
  while (rows.length && rows[rows.length - 1].every((x) => x.trim() === '')) rows.pop(); // prázdný konec (poslední Enter z Excelu)
  return rows;
}

// "Televize / Zprávy" nebo "Televize > Zprávy" -> ['Televize', 'Zprávy']; prázdné = hlavní seznam
export function categoryPath(text) {
  return String(text).split(/\s*[\/>]\s*/).map((x) => x.trim()).filter(Boolean);
}

// Odkaz po vložení z chatu nebo webu: "[https://x](https://x)", "<https://x>", "https://x)." -> "https://x"
export function cleanUrl(text) {
  const s = String(text).trim();
  const md = s.match(/\]\(\s*<?(https?:\/\/[^)\s>]+)/i);
  const raw = md ? md[1] : (s.match(/https?:\/\/[^\s<>"'\]\)\[]+/i) || [s])[0];
  return raw.replace(/[.,;:!?]+$/, '');
}
