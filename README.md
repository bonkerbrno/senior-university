# Stanleyho Superbox 85 (senior-university)

Vzdálený přehrávač pro tátu: jukebox s velkými 3D tlačítky, který si na stisk „Novinky“ stáhne seznam tipů na videa a audio, které připravuje Stanislav.

- `docs/` – publikovaný web (GitHub Pages)
  - `docs/index.html` – přehrávač pro tátu
  - `docs/editor/` – editor pro přípravu seznamu
  - `docs/feed.json` – seznam pro tátu (jen data; píše ho editor)
  - `docs/library.json` – celá knihovna odkazů včetně těch, které táta nevidí
  - `docs/js/validate.js` – přísná kontrola dat (sdílená)
- `tests/` – testy (`npm test`, `npm run e2e`, `node tests/editor-e2e.mjs`)
- `navody/` – postupy: [zprovoznění](navody/zprovozneni.md), [tátovo zařízení](navody/tatovo-zarizeni.md), [bezpečnost](navody/bezpecnost.md)

## Co umí
- složky a podsložky s velkými tlačítky Domů a Zpět, drobečková cesta, video hraje dál při procházení složek,
- jedno kliknutí i rychlé vícenásobné klikání na totéž tlačítko dělá totéž,
- pruh pod videem ukazuje, co hraje, ve které složce a zda je zapnutý Automat,
- **Automat** pouští pořady jeden po druhém dokola; malá tlačítka **Náhodně ve složce / ze všeho** pustí náhodný pořad a Automat pak volí náhodně,
- editor umí složky, podsložky, řazení a přesun pořadů mezi složkami (`docs/js/library.js` skládá strom pro tátu).

Žádné závislosti ani build: jsou to čisté statické soubory.
Testy e2e potřebují `playwright` s Chromiem (ve vývojovém prostředí je předinstalovaný).

## Jedno rozhraní pro tátu i správce
- Skrytý vstup: 5 rychlých kliknutí na první hvězdičku v nápisu, nebo Ctrl+Alt+Shift+A. Otevře se (případně po PINu) editor na `editor/`.
- PIN (4 až 8 číslic) se nastavuje v editoru. Je to jen pojistka proti omylu, jeho hash leží ve veřejném repozitáři. Skutečná ochrana úprav je přístupový token k GitHubu.
- Editor má dole živý náhled „tak to vidí táta“ (`?preview=1`, jen uvnitř editoru, nic neukládá).
- Odkazy jdou vkládat i hromadně: řádky `název ; popis ; odkaz` (i vložené z Excelu).
- Povolené zdroje: YouTube, přímé soubory, živé streamy z `rozhlas.stream` a stránky z `embed.windy.com` a `www.yr.no` (v izolovaném rámečku). Další hostitele je nutné přidat v `validate.js` a v CSP.

## Jak to funguje

Editor ukládá commity `docs/feed.json` a `docs/library.json` do tohoto repozitáře. GitHub Pages je zveřejní. Táta po stisku „Novinky“ stáhne `feed.json`, aplikace ho přísně zkontroluje a vykreslí jen text. Z feedu se nikdy nespouští kód.
