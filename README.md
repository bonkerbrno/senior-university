# Hrací skříň (senior-university)

Vzdálený přehrávač pro tátu: jukebox s velkými 3D tlačítky, který si na stisk „Novinky“ stáhne seznam tipů na videa a audio, které připravuje Stanislav.

- `docs/` – publikovaný web (GitHub Pages)
  - `docs/index.html` – přehrávač pro tátu
  - `docs/editor/` – editor pro přípravu seznamu
  - `docs/feed.json` – seznam pro tátu (jen data; píše ho editor)
  - `docs/library.json` – celá knihovna odkazů včetně těch, které táta nevidí
  - `docs/js/validate.js` – přísná kontrola dat (sdílená)
- `tests/` – testy (`npm test`, `npm run e2e`, `node tests/editor-e2e.mjs`)
- `navody/` – postupy: [zprovoznění](navody/zprovozneni.md), [tátovo zařízení](navody/tatovo-zarizeni.md), [bezpečnost](navody/bezpecnost.md)

Žádné závislosti ani build: jsou to čisté statické soubory.
Testy e2e potřebují `playwright` s Chromiem (ve vývojovém prostředí je předinstalovaný).

## Jak to funguje

Editor ukládá commity `docs/feed.json` a `docs/library.json` do tohoto repozitáře. GitHub Pages je zveřejní. Táta po stisku „Novinky“ stáhne `feed.json`, aplikace ho přísně zkontroluje a vykreslí jen text. Z feedu se nikdy nespouští kód.
