# Nastavení tátova zařízení (Windows + Chrome nebo Edge)

Cíl: počítač, na kterém táta vidí jen hrací skříň a nic jiného nejde spustit ani stáhnout.

## 1. Účet
- Vytvořte pro tátu **standardní účet (bez práv správce)**. Správcovský účet má jen Stanislav a heslo mu nikdo neřekne.
- Zapněte automatické aktualizace Windows a prohlížeče (kvůli záplatám je to nejdůležitější bezpečnostní krok).

## 2. Prohlížeč v režimu kiosk
Zástupce na ploše / ve složce Po spuštění (shell:startup) tátova účtu:

- Edge: `msedge.exe --kiosk "https://bonkerbrno.github.io/senior-university/" --edge-kiosk-type=fullscreen`
- Chrome: `chrome.exe --kiosk "https://bonkerbrno.github.io/senior-university/"`

Přehrávání po stisku Pustit nepotřebuje žádné povolení. Hlasitost nechte na reproduktorech.

## 3. Zásady prohlížeče (omezení, co všechno může)
Nastavují se jako správce v registru, pro Chrome pod `HKLM\SOFTWARE\Policies\Google\Chrome`, pro Edge pod `HKLM\SOFTWARE\Policies\Microsoft\Edge`:

| Zásada | Hodnota | Účel |
|---|---|---|
| `URLBlocklist` | `1 = *` | zakáže všechny adresy |
| `URLAllowlist` | `1 = https://bonkerbrno.github.io`, `2 = https://www.youtube-nocookie.com` (+ další servery s vlastními soubory) | povolí jen tohle |
| `DownloadRestrictions` | `3` | zakáže stahování |
| `ExtensionInstallBlocklist` | `1 = *` | žádná rozšíření |
| `DeveloperToolsAvailability` | `2` | bez vývojářských nástrojů |
| `PasswordManagerEnabled` | `0` | bez nabídky hesel |

Ověření: v prohlížeči otevřete `chrome://policy` (v Edge `edge://policy`) a zásady zkontrolujte. Zkuste otevřít jinou adresu, musí být zablokovaná.
Přehrávání YouTube s přísným seznamem adres je třeba vyzkoušet na místě; pokud by video nešlo, přidejte do `URLAllowlist` `https://www.youtube.com`.

## 4. Co chodí a nechodí
- „Zavřít“ zastaví vše a ukáže obrazovku „Hrací skříň odpočívá“ s tlačítkem Zapnout. Okno prohlížeče zavřít z webu nelze; zavře se kombinací Alt+F4 (zkratku mu můžete ukázat, nebo se počítač prostě vypne).
- „Zmenšit“ vytvoří lištu s ovládáním dole v okně. Skutečné schování na hlavní panel stránka sama neumí.
- Při výpadku internetu se ukáže poslední stažený seznam.

## 5. Jiná zařízení
Aplikace je obyčejná webová stránka, proto poběží i na tabletu (Android: Chrome → Přidat na plochu, spustí se na celou obrazovku), Chromeboxu nebo mini PC. Zamykání se řeší jinak (např. Android „připnutí aplikace“).
