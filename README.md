# Vinted-Inserat-Helfer

Schlanke Web-App (installierbar als App auf dem Handy), die aus Fotos eines Kleidungsstücks ein fertiges Vinted-Inserat macht:

- **Kleidungserkennung** per KI (Google Gemini): Artikel, Marke, Größe, Material, Farbe, Zustand, Mängel
- **Titel, Beschreibung und Hashtags**, Tonalität wählbar, eigener Standardtext am Ende
- **Felder für Vinted**: Kategorie, Marke, Größe, Zustand (Vinted-Stufen), Farbe, Material, Paketgröße
- **Preisvorschlag**: „Schnell weg“, „Empfohlen“ und „Startpreis“ mit Begründung, dazu ein Link zu vergleichbaren Artikeln
- **Automatische Bildbearbeitung**: Freistellen per KI (läuft auf dem Gerät, beim ersten Mal ca. 55 MB Download) auf weißem Hintergrund, Tageslicht-Korrektur, leichter Schatten, 4:5 oder 1:1
- **Fotos teilen/speichern**: auf dem Handy über das Teilen-Menü direkt an die Vinted-App
- **Archiv** mit Status (Entwurf / Online / Verkauft), gespeichert auf dem Gerät

Kein Server, kein Build-Schritt: reines HTML/CSS/JavaScript (ES-Module).

## Nutzung

1. Kostenlosen Gemini-API-Schlüssel erstellen: <https://aistudio.google.com/apikey>
2. App öffnen → **Einstellungen** → Schlüssel eintragen
3. Fotos aufnehmen → **Inserat erstellen** → Texte kopieren → **Vinted öffnen**

### Als App installieren
Voraussetzung: Die App muss über **https** erreichbar sein (z. B. GitHub Pages oder Netlify, siehe unten) –
eine lokal geöffnete Datei oder `http://` im WLAN lässt sich nicht installieren.

- **Android (Chrome):** Seite öffnen → Menü ⋮ → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“
- **iPhone (Safari):** Teilen → „Zum Home-Bildschirm“

## Lokal starten

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

(Die Datei direkt per `file://` zu öffnen funktioniert nicht, weil ES-Module einen Server brauchen.)

## Veröffentlichen

**Am einfachsten (ohne Git):** <https://app.netlify.com/drop> öffnen und den Projektordner hineinziehen →
man bekommt sofort eine https-Adresse, die man auf dem Handy öffnet und installiert.


GitHub Pages: *Settings → Pages → Deploy from a branch → `main` / root*. Die App ist dann unter
`https://<benutzer>.github.io/vinted-helfer/` erreichbar.

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html` | Markup (drei Ansichten: Neu, Archiv, Einstellungen) |
| `css/style.css` | Styles inkl. Handy-Layout und Dark Mode |
| `js/app.js` | UI-Logik, Prompt, Ergebnis-Darstellung, Archiv-Ansicht |
| `js/ai.js` | Gemini-Aufruf (Bilder + Prompt → JSON) |
| `js/imaging.js` | Bildbearbeitung (KI-Freistellung im Browser, Farbkorrektur, Komposition) |
| `js/storage.js` | Archiv in IndexedDB |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA (installierbar, App-Shell offline) |
