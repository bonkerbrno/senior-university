# Bezpečnostní model

**Cíl:** k tátovi nesmí cestou dojít nic spustitelného a jeho zařízení nesmí samo spouštět nové skripty nebo programy.

1. Mezi vámi putuje jediný soubor `feed.json`, čistý text. Čte se přes `JSON.parse` a vypisuje přes `textContent`. V kódu není `innerHTML`, `eval`, `new Function`, `document.write` ani otevírání nových oken (hlídá to `tests/security.test.mjs`).
2. `docs/js/validate.js` zahodí vše mimo schéma: odkaz musí být `https://` na YouTube nebo soubor `mp4/webm/ogv/mp3/m4a/ogg/oga/wav`, bez přihlašovacích údajů a portu, délky jsou omezené, max. 200 položek a 256 kB. Z YouTube odkazu zbude jen 11znakové ID videa.
3. Content-Security-Policy ve stránce: `script-src 'self'` (žádný inline skript, žádný eval), `connect-src 'self'`, `frame-src` jen `youtube-nocookie.com`, `object-src 'none'`, `form-action 'none'`.
4. YouTube běží v iframe s `sandbox="allow-scripts allow-same-origin"` na doméně bez cookies.
5. Aplikace nic nestahuje do souboru, jen streamuje média přes prohlížeč.
6. Prohlížeč na tátově zařízení je zamčený zásadami (viz [tatovo-zarizeni.md](tatovo-zarizeni.md)).
7. Hosting je statický (žádný server, žádná databáze). Každá změna je commit, takže ji lze vrátit.

## Co zůstává jako riziko
- zranitelnost samotného prohlížeče nebo dekodéru médií (řeší aktualizace),
- převzetí GitHub účtu (řeší dvoufázové ověření a token omezený na jeden repozitář),
- odkaz na přímý soubor může vést na kterýkoli https server; do tátova seznamu dávejte jen důvěryhodné zdroje.

## Možné zpevnění do budoucna
Podepsaný feed (Ed25519): editor feed podepíše, přehrávač s pevně zabudovaným veřejným klíčem odmítne cokoli nepodepsaného. Pro ještě vyšší jistotu může být aplikace jen lokální soubor na tátově disku a z internetu stahovat pouze podepsaný feed.

## Známá omezení
- Obsah repozitáře je veřejný (nutné pro bezplatné Pages).
- Některá YouTube videa nedovolí vložení; aplikace ukáže hlášku „Tento pořad nejde přehrát“.
- Reálné přehrání YouTube nebylo možné vyzkoušet z cloudového prostředí (bez přístupu na internet), testy používají simulaci.
