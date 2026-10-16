# Zprovoznění (jednorázově, asi 10 minut)

1. **Sloučit pull request** s prototypem do větve `main`.
2. **Repozitář musí být veřejný**, jinak GitHub Pages u bezplatného účtu nefungují:
   Settings → General → Danger Zone → Change visibility → Public. (Veřejné budou kód a seznam tipů, žádné klíče v repozitáři nejsou.)
3. **Zapnout Pages:** Settings → Pages → Source: *Deploy from a branch* → Branch `main`, složka `/docs` → Save.
4. Po minutě až dvou běží:
   - táta: `https://bonkerbrno.github.io/senior-university/`
   - editor: `https://bonkerbrno.github.io/senior-university/editor/`
5. **Token pro editor:** GitHub → Settings → Developer settings → Fine-grained tokens → Generate:
   - Repository access: *Only select repositories* → `senior-university`
   - Permissions: *Contents: Read and write* (nic jiného)
   - Expirace podle chuti (např. 90 dní)
   Token vložte v editoru do Nastavení (zaškrtněte „Zapamatovat“ jen na vlastním počítači).
6. **Zabezpečte účet:** na GitHubu zapnout dvoufázové ověření, nejlépe passkey.
7. Další postup: [nastavení tátova zařízení](tatovo-zarizeni.md).

Poznámka: po uložení v editoru trvá zveřejnění obvykle 1 až 2 minuty, CDN může soubor držet několik minut.
