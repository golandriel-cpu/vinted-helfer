// Service Worker: App-Shell offline verfügbar machen, Freistell-KI & Schriften nach erstem Laden cachen.
// Bei Änderungen an App-Dateien VERSION hochzählen, damit Nutzer die neue Version bekommen.
const VERSION = "v2";
const SHELL = `shell-${VERSION}`, RUNTIME = "runtime-v1";
const FILES = ["./", "index.html", "css/style.css", "js/app.js", "js/imaging.js", "js/ai.js", "js/storage.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== RUNTIME).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.hostname === "generativelanguage.googleapis.com") return;
  // eigene Dateien: erst Netz (aktuell), sonst Cache
  if (url.origin === location.origin){
    e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => { const c = r.clone(); caches.open(SHELL).then(s => s.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true })));
    return;
  }
  // CDN (Freistell-KI: Bibliothek, Modell, WASM; Schriften): Cache zuerst – Dateien sind versioniert
  if (/cdn\.jsdelivr\.net|staticimgly\.com|fonts\.(googleapis|gstatic)\.com/.test(url.hostname)){
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok || r.type === "opaque"){ const c = r.clone(); caches.open(RUNTIME).then(s => s.put(e.request, c)); }
      return r;
    })));
  }
});
