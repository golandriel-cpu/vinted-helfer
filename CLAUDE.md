# CLAUDE.md – Vinted-Inserat-Helfer

## Projekt
Private, schlanke PWA für Fredi: Aus Fotos eines Kleidungsstücks wird ein Vinted-Inserat erstellt
(Erkennung, Titel, Beschreibung, Hashtags, Vinted-Felder, Preisvorschlag) und die Fotos werden
automatisch bearbeitet (weißer Hintergrund, Tageslicht). Hauptnutzung: **Android-Handy**, installiert als App.
Sprache der App und der Kommunikation: **Deutsch**.

## Leitplanken
- **Schlank bleiben:** kein Framework, kein Build-Schritt, keine Server-Komponente. Vanilla JS als ES-Module.
- **Kostenlos:** KI über Google Gemini Free Tier; der API-Schlüssel liegt nur im localStorage des Geräts,
  niemals im Repo.
- **Kein automatisches Einstellen bei Vinted:** Es gibt keine offizielle API für private Verkäufer, und Bots
  verstoßen gegen die Vinted-Nutzungsbedingungen. Die App bereitet alles zum Kopieren/Teilen vor und
  öffnet `/items/new`.
- Preise sind KI-Schätzungen ohne Live-Marktdaten. Das muss in der UI so erkennbar bleiben.

## Architektur
- `js/app.js`: State (`state.images`, `state.result`, `state.archive`), UI-Rendering, Prompt (`buildPrompt`,
  `SCHEMA`), `normalize()` für die KI-Antwort, `applyImageHints()` (die KI liefert pro Foto `typ` +
  `box` 0–1000 → genaueres Freistellen; Etikett/Detail → nur Lichtkorrektur).
- `js/ai.js`: `askGemini({apiKey, model, prompt, images})` → JSON-Text (`responseMimeType: application/json`).
  Fehlercodes: `bad_key`, `model`, `rate_limited`, `network`, `empty`, `http`. Modellliste in `MODELS`.
- `js/imaging.js`: `editImage(img, mode, box, {shadow, format}, memo)` mit `mode` ∈ `weiss | licht`.
  Freistellen per KI-Modell im Browser: `@imgly/background-removal` (ISNet, `isnet_quint8`, AGPL) lazy von
  jsDelivr, Modell + WASM von `staticimgly.com` (~55 MB einmalig, danach per Service Worker gecacht).
  `cleanAlpha()` behält nur große Teile (bei KI-Rahmen die im Rahmen) und strafft die Kante.
  `memo` cached die KI-Maske pro Foto (neuer Rahmen → kein erneutes Freistellen).
  Farbkorrektur: Weißabgleich nur bei neutralen Lichtern, Belichtung so begrenzt, dass der Artikel nicht ausbrennt.
  KI-Rahmen kommen von Gemini als `box_2d` = `[ymin, xmin, ymax, xmax]` (Gemini-natives Format!), intern `[x0, y0, x1, y1]`.
  **Achtung:** Dynamisch geladene Module nie direkt resolven/awaiten, falls „thenable“ – immer verpacken (`{ m }`).
- `js/storage.js`: IndexedDB-Store `listings` (Archiv inkl. kleinem Thumbnail als Data-URL).
- `sw.js`: App-Shell network-first, CDN cache-first. **Bei Änderungen an App-Dateien `VERSION` hochzählen.**

## Entwickeln & Testen
- Lokal: `python3 -m http.server 8000` → <http://localhost:8000> (Service Worker nur über https aktiv).
- Ohne echten Schlüssel testen: Gemini-Requests im Browser mocken (z. B. Playwright `page.route`
  auf `generativelanguage.googleapis.com`) und eine Antwort im `SCHEMA`-Format zurückgeben.
- `dev/bildtest.html`: erzeugt Testfotos (Holzboden, helles Laken, zweifarbiger Hintergrund) und zeigt
  Vorher/Nachher von `editImage`. Achtung: Browser cached Module – nach Änderungen hart neu laden.
- Bildbearbeitung zusätzlich mit echten Fotos prüfen: unruhiger oder zweifarbiger Untergrund, dunkle Kleidung,
  weißes Shirt auf hellem Grund.

## Ideen / Backlog
- Preise mit echten Vergleichsdaten (z. B. Gemini mit Google-Search-Grounding)
- Mehrere Artikel als Stapel verarbeiten
- Manuelles Nachbessern der Freistell-Maske (Pinsel)
