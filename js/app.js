// Vinted-Inserat-Helfer – Hauptlogik (UI, KI-Aufruf, Archiv)
import { loadImg, canvasOf, canvasBlob, toBlob, editImage, setStatusHandler } from "./imaging.js";
import { askGemini, MODELS, DEFAULT_MODEL } from "./ai.js";
import { archiveStore } from "./storage.js";

const $ = id => document.getElementById(id);
const state = { images: [], result: null, savedId: null, maxImages: 8, archive: [] };
setStatusHandler(t => { $("imgStatus").textContent = t; });

// ---------- storage helpers ----------
const ls = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
const settings = Object.assign({ footer:"", emoji:true, domain:"www.vinted.de", hashtags:8, apiKey:"", model:DEFAULT_MODEL }, ls.get("vh-settings", {}));
$("s-model").innerHTML = MODELS.map(m => `<option value="${m.id}">${m.label}</option>`).join("");
$("s-key").value = settings.apiKey; $("s-model").value = settings.model;
$("s-footer").value = settings.footer; $("s-emoji").checked = settings.emoji;
$("s-domain").value = settings.domain; $("s-hashtags").value = settings.hashtags;
// Schlüssel sofort beim Tippen sichern (auf dem Handy feuert "change" oft erst beim Verlassen des Feldes)
$("s-key").addEventListener("input", () => { settings.apiKey = $("s-key").value.trim(); ls.set("vh-settings", settings); updateKeyNote(); });
// Browser bitten, die Daten (Schlüssel, Archiv) nie automatisch zu löschen
if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {});
["s-footer","s-emoji","s-domain","s-hashtags","s-key","s-model"].forEach(id => $(id).addEventListener("change", () => {
  settings.apiKey = $("s-key").value.trim();
  settings.model = $("s-model").value || DEFAULT_MODEL;
  updateKeyNote();
  settings.footer = $("s-footer").value.trim();
  settings.emoji = $("s-emoji").checked;
  settings.domain = $("s-domain").value;
  settings.hashtags = Math.max(0, Math.min(20, parseInt($("s-hashtags").value || "8", 10)));
  ls.set("vh-settings", settings); toast("Gespeichert");
  if (state.result) renderResult();
}));

// ---------- nav ----------
document.querySelectorAll("nav button").forEach(b => b.onclick = () => {
  document.querySelectorAll("nav button").forEach(x => x.classList.toggle("on", x === b));
  ["neu","archiv","setup"].forEach(v => $("v-"+v).classList.toggle("hidden", v !== b.dataset.view));
  if (b.dataset.view === "archiv") renderArchive();
  window.scrollTo({ top: 0 });
});

// ---------- toast / copy ----------
let tt;
function toast(msg){ const t=$("toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(tt); tt=setTimeout(()=>t.classList.remove("show"),1600); }
async function copy(text){
  try { await navigator.clipboard.writeText(text); toast("Kopiert"); }
  catch(e){
    const ta=document.createElement("textarea"); ta.value=text; document.body.appendChild(ta); ta.select();
    let ok=false; try{ ok=document.execCommand("copy"); }catch(_){}
    ta.remove(); toast(ok ? "Kopiert" : "Kopieren nicht möglich – bitte markieren");
  }
}

// ---------- images ----------
const drop = $("drop"), file = $("file");
drop.onclick = () => file.click();
file.onchange = () => { addFiles(file.files); file.value = ""; };
const cam = $("cam");
$("camBtn").onclick = () => cam.click();
$("galBtn").onclick = () => file.click();
cam.onchange = () => { addFiles(cam.files); cam.value = ""; };
["dragover","dragenter"].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add("over"); }));
["dragleave","drop"].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", ev => addFiles(ev.dataTransfer.files));


// image options
const iopt = Object.assign({ edit: true, shadow: true, format: "45", style: "wand" }, ls.get("vh-imgopts", {}));
$("o-edit").checked = iopt.edit; $("o-shadow").checked = iopt.shadow; $("o-format").value = iopt.format; $("o-style").value = iopt.style;
["o-edit","o-shadow","o-format","o-style"].forEach(id => $(id).addEventListener("change", () => {
  iopt.edit = $("o-edit").checked; iopt.shadow = $("o-shadow").checked; iopt.format = $("o-format").value; iopt.style = $("o-style").value;
  ls.set("vh-imgopts", iopt);
  state.images.forEach(im => { if (!iopt.edit) im.mode = "original"; else if (im.mode === "original" && !im.userMode) im.mode = im.autoMode || "weiss"; });
  processAll();
}));

async function addFiles(list){
  const files = [...list].filter(f => f.type.startsWith("image/"));
  for (const f of files){
    if (state.images.length >= state.maxImages){ toast(`Maximal ${state.maxImages} Fotos`); break; }
    try{
      const {img, url} = await loadImg(f);
      const big = await toBlob(img, 1280, .85);
      const small = await toBlob(img, 220, .7);
      state.images.push({ id: Math.random().toString(36).slice(2), img, url, blob: big.blob, origThumb: small.dataUrl, thumb: small.dataUrl,
        mode: iopt.edit ? "weiss" : "original", box: null, edited: null, editedUrl: null, busy: false, showOrig: false });
    }catch(e){ toast("Foto konnte nicht gelesen werden"); }
  }
  renderThumbs(); processAll();
}

const MODE_LABEL = { weiss: "Bearbeitet", licht: "Nur Licht", original: "Original" };
const NEXT_MODE = { weiss: "licht", licht: "original", original: "weiss" };
function renderThumbs(){
  const box = $("thumbs"); box.innerHTML = "";
  state.images.forEach((im, i) => {
    const d = document.createElement("div");
    const src = (!im.showOrig && im.editedUrl && im.mode !== "original") ? im.editedUrl : im.url;
    d.innerHTML = `<img src="${src}" alt="Foto ${i+1}">
      ${im.showOrig && im.mode !== "original" ? `<span class="orig-badge">Vorher</span>` : ""}
      <button class="x" title="Entfernen">×</button>
      <button class="mode" title="Bearbeitung wechseln">${MODE_LABEL[im.mode]}</button>
      <button class="dl" title="Foto speichern">⬇</button>
      ${im.busy ? `<div class="busy"><span class="spinner"></span></div>` : ""}`;
    d.querySelector(".x").onclick = ev => { ev.stopPropagation(); URL.revokeObjectURL(im.url); if (im.editedUrl) URL.revokeObjectURL(im.editedUrl); state.images.splice(i,1); renderThumbs(); };
    d.querySelector(".mode").onclick = ev => { ev.stopPropagation(); im.mode = NEXT_MODE[im.mode]; im.userMode = true; im.showOrig = false; processOne(im); };
    const dl = d.querySelector(".dl"); if (dl) dl.onclick = ev => { ev.stopPropagation(); saveOne(im, i); };
    d.onclick = () => { if (im.mode !== "original" && im.editedUrl){ im.showOrig = !im.showOrig; renderThumbs(); } };
    box.appendChild(d);
  });
  $("go").disabled = !state.images.length;
  $("imgHint").classList.toggle("hidden", !state.images.length);
  $("imgActions").classList.toggle("hidden", !state.images.length);
}

// ---------- processing queue ----------
let queue = Promise.resolve();
function processAll(){ state.images.forEach(im => processOne(im)); }
function processOne(im){
  im.ver = (im.ver || 0) + 1; const ver = im.ver;
  im.busy = im.mode !== "original"; renderThumbs();
  queue = queue.then(async () => {
    if (ver !== im.ver || !state.images.includes(im)) return;
    try{
      if (im.mode === "original"){ setEdited(im, null); }
      else {
        const c = await editImage(im.img, im.mode, im.box, { ...iopt, hang: im.hang }, im.memo || (im.memo = {}));
        if (ver !== im.ver) return;
        setEdited(im, await canvasBlob(c, .9), c);
      }
    }catch(e){ console.error(e); $("imgStatus").textContent = "Ein Foto konnte nicht bearbeitet werden – Original bleibt erhalten."; setEdited(im, null); }
    if (ver === im.ver){ im.busy = false; renderThumbs(); }
  });
  return queue;
}
function setEdited(im, blob, canvas){
  if (im.editedUrl) URL.revokeObjectURL(im.editedUrl);
  im.edited = blob; im.editedUrl = blob ? URL.createObjectURL(blob) : null;
  im.thumb = canvas ? canvasOf(canvas, 220).toDataURL("image/jpeg", .7) : im.origThumb;
}

// ---------- saving photos ----------
const fileBase = () => (state.result && (state.result.titel || state.result.artikel) || "vinted").toLowerCase().replace(/[^a-z0-9äöüß]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) || "vinted";
const outBlob = im => im.edited || im.blob;
const fileOf = (im, i) => new File([outBlob(im)], `${fileBase()}-${i+1}.jpg`, { type: "image/jpeg" });
// Android/iOS: Teilen-Menü (z. B. direkt an die Vinted-App), sonst Download
async function shareOrDownload(files){
  try{
    if (navigator.canShare && navigator.canShare({ files })){ await navigator.share({ files }); return; }
  }catch(e){ if (e && e.name === "AbortError") return; }
  files.forEach((f, k) => setTimeout(() => {
    const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, k * 350));
}
// Speichern = Download (landet auf Android im Ordner „Download“ und in der Galerie, von dort in Vinted hochladen)
function download(files){
  files.forEach((f, k) => setTimeout(() => {
    const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, k * 400));
}
async function saveOne(im, i){
  if (im.busy) await queue;
  download([fileOf(im, i)]); toast("Foto gespeichert (Ordner „Download“)");
}
$("saveAll").onclick = async () => {
  if (!state.images.length) return;
  const btn = $("saveAll"); setBusy(btn, true, "Bereite Fotos vor…");
  try{ await queue; download(state.images.map(fileOf)); toast(`${state.images.length} Foto(s) gespeichert (Ordner „Download“)`); }
  finally{ setBusy(btn, false, "💾 Alle Fotos speichern"); }
};
$("dlAll").onclick = async () => {
  if (!state.images.length) return;
  const btn = $("dlAll"); setBusy(btn, true, "Bereite Fotos vor…");
  try{ await queue; await shareOrDownload(state.images.map(fileOf)); }
  catch(e){ toast("Teilen nicht möglich"); }
  finally{ setBusy(btn, false, "↗ Teilen (z. B. an Vinted)"); }
};

// ---------- AI ----------
const SCHEMA = `{
"artikel": "kurze Artikelbezeichnung, z. B. 'Levi's 501 Jeans'",
"titel": "Vinted-Titel, max. 60 Zeichen: Marke + Artikel + wichtigstes Merkmal + Größe",
"beschreibung": "fertiger Beschreibungstext (siehe Regeln), OHNE Hashtags",
"hashtags": ["#beispiel", "..."],
"kategorie": "Vinted-Kategoriepfad, z. B. 'Herren > Kleidung > Jeans > Gerade'",
"marke": "Marke oder '' wenn nicht erkennbar",
"groesse": "Größe oder '' wenn nicht erkennbar",
"zustand": "genau eins von: Neu mit Etikett | Neu ohne Etikett | Sehr gut | Gut | Zufriedenstellend",
"farben": ["max. 2 Farben"],
"material": "Material oder ''",
"paketgroesse": "Klein | Mittel | Groß",
"preis": { "schnell": 0, "empfohlen": 0, "max": 0, "neupreis_geschaetzt": 0, "begruendung": "1–2 Sätze" },
"unsicher": ["Dinge, die der Nutzer prüfen/ergänzen sollte, z. B. 'Größe auf dem Etikett nicht lesbar'"],
"suchbegriff": "2–4 Wörter für die Vinted-Suche nach Vergleichsartikeln",
"bilder": [{ "typ": "gesamt | detail | etikett", "box_2d": [ymin, xmin, ymax, xmax], "haengen": "buegel | klammer | vorhanden | keiner" }]
}`;

function buildPrompt(notes){
  return `Du bist ein erfahrener Vinted-Verkäufer in Deutschland. Analysiere die Fotos eines Second-Hand-Artikels (meist Kleidung, Schuhe oder Accessoires) und erstelle ein verkaufsfertiges Inserat auf Deutsch.

Zusatzinfos vom Verkäufer (haben Vorrang vor deiner Einschätzung): ${notes || "keine"}
Tonalität: ${$("tone").value}
Verkaufsziel: ${$("goal").value}
Emojis: ${settings.emoji ? "sparsam erlaubt (max. 3)" : "keine"}
Anzahl Hashtags: ${settings.hashtags}
Standardtext für das Ende der Beschreibung: ${settings.footer ? `"${settings.footer}"` : "keiner"}

Regeln:
- Erkenne Artikeltyp, Marke (Logo, Etikett), Größe, Material, Farbe, Schnitt/Stil und sichtbare Mängel. Lies Etiketten genau. Erfinde nichts: was du nicht sicher erkennst, lässt du leer und nennst es unter "unsicher".
- Titel: suchoptimiert, ohne Füllwörter, ohne Emojis, ohne Hashtags.
- Beschreibung: 1 einladender Einstiegssatz, dann kompakte Details (Marke, Größe/Passform, Material, Farbe, Stil), dann ehrlicher Zustand inkl. Mängel, ggf. Styling-Idee. Kurze Absätze, gut lesbar am Handy, 400–900 Zeichen. Falls ein Standardtext vorgegeben ist, hänge ihn wörtlich als letzten Absatz an.
- Hashtags: deutsch, kleingeschrieben, ohne Leerzeichen; Mix aus Marke, Artikeltyp, Stil/Trend (z. B. y2k, vintage, streetwear), Farbe, Anlass. Keine irreführenden Marken-Tags.
- "bilder": genau ein Eintrag pro Foto in der Reihenfolge der Fotos. "typ": "gesamt" = Artikel ganz zu sehen, "detail" = Nahaufnahme/Mangel, "etikett" = Etikett/Label. "box_2d" = enger Rahmen um den Artikel (inkl. Kleiderbügel, falls er daran hängt; ohne Hände, Möbel) als [ymin, xmin, ymax, xmax], normiert auf 0–1000. "haengen" = wie der Artikel für ein Foto vor weißer Wand aufgehängt wird: "buegel" (Oberteile, Kleider, Jacken), "klammer" (Hosen, Röcke, Shorts), "vorhanden" (hängt im Foto schon auf einem Bügel), "keiner" (Schuhe, Taschen, Accessoires).
- Preis in ganzen Euro für den deutschen Vinted-Markt, realistisch nach Marke, Zustand und typischer Nachfrage. "schnell" = verkauft sich zügig, "empfohlen" = guter Kompromiss, "max" = Startpreis mit Verhandlungsspielraum. Beim Ziel "schnell" eher niedriger, bei "maximal" eher höher ansetzen.

Antworte AUSSCHLIESSLICH mit gültigem JSON in genau diesem Format, ohne Markdown:
${SCHEMA}`;
}

function parseJSON(text){
  if (text && typeof text === "object") return text;
  let t = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

async function ask(prompt, opts = {}){
  if (!settings.apiKey){ openSetup(); throw { code: "no_key" }; }
  const text = await askGemini({ apiKey: settings.apiKey, model: settings.model, prompt, images: opts.images || [] });
  return parseJSON(text);
}

function setBusy(btn, busy, label){
  btn.disabled = busy;
  btn.innerHTML = busy ? `<span class="spinner"></span> ${label}` : label;
}

$("go").onclick = async () => {
  const btn = $("go");
  setBusy(btn, true, "Analysiere Fotos…");
  $("status").textContent = "Erkenne Artikel, Marke und Zustand – dauert meist 10–30 Sekunden.";
  try{
    const res = await ask(buildPrompt($("notes").value.trim()), { images: state.images.map(i => i.blob) });
    state.result = normalize(res); state.savedId = null;
    applyImageHints(res && res.bilder);
    renderResult(); $("status").textContent = "";
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  }catch(e){
    $("status").textContent = errMsg(e);
  }finally{ setBusy(btn, false, "Inserat erstellen"); renderThumbs(); }
};

$("refineBtn").onclick = async () => {
  const instr = $("refine").value.trim(); if (!instr || !state.result) return;
  readEdits();
  const btn = $("refineBtn"); setBusy(btn, true, "…");
  try{
    const prompt = `Hier ist ein Vinted-Inserat als JSON:\n${JSON.stringify(state.result)}\n\nÜberarbeite es nach dieser Anweisung des Verkäufers: "${instr}".\nBehalte alles andere bei, erfinde keine neuen Fakten. Emojis: ${settings.emoji ? "sparsam erlaubt" : "keine"}. Standardtext am Ende: ${settings.footer ? `"${settings.footer}"` : "keiner"}.\nAntworte AUSSCHLIESSLICH mit gültigem JSON im selben Format:\n${SCHEMA}`;
    state.result = normalize(await ask(prompt));
    renderResult(); $("refine").value = ""; toast("Überarbeitet");
  }catch(e){ toast(errMsg(e)); }
  finally{ setBusy(btn, false, "Überarbeiten"); }
};

function applyImageHints(list){
  if (!Array.isArray(list) || !iopt.edit) return;
  state.images.forEach((im, i) => {
    const h = list[i]; if (!h || im.userMode) return;
    // Gemini liefert Rahmen nativ als [ymin, xmin, ymax, xmax] → intern [x0, y0, x1, y1]
    const r = Array.isArray(h.box_2d) && h.box_2d.length === 4 ? h.box_2d.map(Number) : null;
    const b = r ? [r[1], r[0], r[3], r[2]] : null;
    const okBox = b && b.every(v => isFinite(v) && v >= 0 && v <= 1000) && b[2] > b[0] && b[3] > b[1];
    const auto = (h.typ === "detail" || h.typ === "etikett") ? "licht" : "weiss";
    const changed = auto !== im.mode || (auto === "weiss" && okBox && JSON.stringify(b) !== JSON.stringify(im.box));
    const hang = ["buegel", "klammer", "vorhanden", "keiner"].includes(h.haengen) ? h.haengen : "buegel";
    const changed2 = changed || hang !== (im.hang || "buegel");
    im.autoMode = auto; im.mode = auto; im.hang = hang; if (okBox) im.box = b;
    if (changed2) processOne(im);
  });
}

function errMsg(e){
  if (e && e.code === "no_key") return "Bitte zuerst in den Einstellungen deinen kostenlosen Gemini-API-Schlüssel eintragen.";
  if (e && e.code === "bad_key") return "Der Gemini-API-Schlüssel ist ungültig – bitte in den Einstellungen prüfen.";
  if (e && e.code === "model") return "Das gewählte Gemini-Modell ist nicht verfügbar – bitte in den Einstellungen ein anderes wählen.";
  if (e && e.code === "rate_limited") return "Gerade zu viele Anfragen – bitte kurz warten und erneut versuchen.";
  if (e && e.code === "not_granted") return "Die KI-Funktion wurde nicht freigegeben.";
  if (e instanceof SyntaxError) return "Die Antwort war unvollständig – bitte noch einmal versuchen.";
  return "Das hat nicht geklappt" + (e && e.message ? `: ${e.message}` : "") + ". Bitte erneut versuchen.";
}

function normalize(r){
  r = r || {};
  const p = r.preis || {};
  let tags = Array.isArray(r.hashtags) ? r.hashtags : String(r.hashtags || "").split(/\s+/);
  tags = tags.map(t => "#" + String(t).replace(/^#+/, "").replace(/\s+/g, "").toLowerCase()).filter(t => t.length > 1);
  return {
    artikel: r.artikel || "", titel: r.titel || "", beschreibung: r.beschreibung || "",
    hashtags: [...new Set(tags)], kategorie: r.kategorie || "", marke: r.marke || "", groesse: r.groesse || "",
    zustand: r.zustand || "", farben: Array.isArray(r.farben) ? r.farben.join(", ") : (r.farben || ""),
    material: r.material || "", paketgroesse: r.paketgroesse || "",
    preis: { schnell: num(p.schnell), empfohlen: num(p.empfohlen), max: num(p.max), neupreis: num(p.neupreis_geschaetzt), begruendung: p.begruendung || "" },
    unsicher: Array.isArray(r.unsicher) ? r.unsicher.filter(Boolean) : [], suchbegriff: r.suchbegriff || r.artikel || ""
  };
}
const num = v => { const n = Math.round(parseFloat(String(v).replace(",", "."))); return isFinite(n) && n > 0 ? n : null; };
const eur = n => n ? `${n} €` : "–";
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

// ---------- render result ----------
const FACTS = [["kategorie","Kategorie"],["marke","Marke"],["groesse","Größe"],["zustand","Zustand"],["farben","Farbe"],["material","Material"],["paketgroesse","Paketgröße"]];
function renderResult(){
  const r = state.result; if (!r) return;
  $("result").classList.remove("hidden");
  $("f-titel").value = r.titel; updLen();
  $("f-beschreibung").value = r.beschreibung;
  $("f-tags").innerHTML = r.hashtags.map(t => `<span class="tag">${esc(t)}</span>`).join("") || `<span class="muted">keine</span>`;
  $("facts").innerHTML = FACTS.map(([k, l]) => `<div class="fact"><b>${l}</b><input type="text" data-k="${k}" value="${esc(r[k] || "")}" placeholder="bitte ergänzen"></div>`).join("");
  $("facts").querySelectorAll("input").forEach(i => i.oninput = () => { r[i.dataset.k] = i.value; });
  const u = $("unsure");
  if (r.unsicher.length){ u.classList.remove("hidden"); u.innerHTML = `<b>Bitte prüfen</b><ul>${r.unsicher.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`; }
  else u.classList.add("hidden");
  $("p-schnell").textContent = eur(r.preis.schnell);
  $("p-empf").textContent = eur(r.preis.empfohlen);
  $("p-max").textContent = eur(r.preis.max);
  $("p-why").textContent = (r.preis.neupreis ? `Geschätzter Neupreis ca. ${r.preis.neupreis} €. ` : "") + r.preis.begruendung;
  $("openVinted").href = `https://${settings.domain}/items/new`;
  $("p-link").href = `https://${settings.domain}/catalog?search_text=${encodeURIComponent(r.suchbegriff)}&order=relevance`;
  $("save").textContent = state.savedId ? "Änderungen speichern" : "Im Archiv speichern";
}
function updLen(){ const n = $("f-titel").value.length; $("tlen").textContent = `${n} Zeichen`; }
$("f-titel").oninput = () => { updLen(); if (state.result) state.result.titel = $("f-titel").value; };
$("f-beschreibung").oninput = () => { if (state.result) state.result.beschreibung = $("f-beschreibung").value; };
function readEdits(){ if (!state.result) return; state.result.titel = $("f-titel").value; state.result.beschreibung = $("f-beschreibung").value; }

document.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => {
  readEdits(); const r = state.result; if (!r) return;
  const k = b.dataset.copy;
  copy(k === "hashtags" ? r.hashtags.join(" ") : r[k]);
});
$("copyall").onclick = () => { readEdits(); const r = state.result; copy(r.beschreibung.trim() + (r.hashtags.length ? "\n\n" + r.hashtags.join(" ") : "")); };

$("reset").onclick = () => {
  state.images.forEach(i => URL.revokeObjectURL(i.url));
  state.images = []; state.result = null; state.savedId = null;
  $("notes").value = ""; $("result").classList.add("hidden"); renderThumbs();
  window.scrollTo({ top: 0, behavior: "smooth" });
};

// ---------- archive ----------
$("save").onclick = async () => {
  readEdits(); if (!state.result) return;
  const id = state.savedId || ("l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const prev = state.archive.find(a => a.id === id);
  const item = { id, created: prev ? prev.created : Date.now(), updated: Date.now(), status: prev ? prev.status : "entwurf",
    thumb: state.images[0] ? state.images[0].thumb : (prev ? prev.thumb : ""), result: JSON.parse(JSON.stringify(state.result)) };
  const btn = $("save"); setBusy(btn, true, "Speichere…");
  try{
    await putItem(item); state.savedId = id; toast("Im Archiv gespeichert");
  }catch(e){ toast(e && e.name === "QuotaExceededError" ? "Speicher voll – bitte alte Einträge löschen" : "Speichern fehlgeschlagen"); }
  finally{ setBusy(btn, false, "Änderungen speichern"); }
};

async function putItem(item){
  const i = state.archive.findIndex(a => a.id === item.id);
  if (i >= 0) state.archive[i] = item; else state.archive.unshift(item);
  await archiveStore.put(item);
}
async function delItem(id){
  state.archive = state.archive.filter(a => a.id !== id);
  await archiveStore.delete(id);
}

const STATUS = { entwurf: "Entwurf", online: "Online", verkauft: "Verkauft" };
function renderArchive(){
  const list = $("archList");
  const a = [...state.archive].sort((x, y) => y.created - x.created);
  const sold = a.filter(x => x.status === "verkauft");
  const sum = sold.reduce((s, x) => s + (x.soldPrice || x.result.preis.empfohlen || 0), 0);
  $("stats").innerHTML = a.length ? `<span class="pill">${a.length} Inserate</span><span class="pill">${a.filter(x => x.status === "online").length} online</span><span class="pill">${sold.length} verkauft · ca. ${sum} €</span>` : "";
  if (!a.length){ list.innerHTML = `<p class="muted">Noch nichts gespeichert. Erstelle ein Inserat und tippe auf „Im Archiv speichern“.</p>`; return; }
  list.innerHTML = "";
  a.forEach(x => {
    const el = document.createElement("div"); el.className = "arch-item";
    el.innerHTML = `${x.thumb ? `<img src="${x.thumb}" alt="">` : `<img alt="">`}
      <div class="t"><div>${esc(x.result.titel || x.result.artikel || "Ohne Titel")}</div>
      <span class="muted">${eur(x.result.preis.empfohlen)} · ${new Date(x.created).toLocaleDateString("de-DE")}</span></div>
      <select>${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${x.status === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <button class="btn ghost small" data-a="open">Öffnen</button>
      <button class="btn ghost small" data-a="del" title="Löschen">✕</button>`;
    el.querySelector("select").onchange = async ev => { x.status = ev.target.value; x.updated = Date.now(); try{ await putItem(x); renderArchive(); }catch(e){ toast("Speichern fehlgeschlagen"); } };
    el.querySelector('[data-a="open"]').onclick = () => {
      state.result = JSON.parse(JSON.stringify(x.result)); state.savedId = x.id;
      state.images.forEach(i => URL.revokeObjectURL(i.url)); state.images = []; renderThumbs();
      document.querySelector('nav button[data-view="neu"]').click(); renderResult();
      $("result").scrollIntoView({ behavior: "smooth" });
    };
    const del = el.querySelector('[data-a="del"]');
    del.onclick = async () => {
      if (del.dataset.confirm){ try{ await delItem(x.id); renderArchive(); toast("Gelöscht"); }catch(e){ toast("Löschen fehlgeschlagen"); } }
      else { del.dataset.confirm = "1"; del.textContent = "Löschen?"; setTimeout(() => { delete del.dataset.confirm; del.textContent = "✕"; }, 2500); }
    };
    list.appendChild(el);
  });
}

// ---------- init ----------
function openSetup(){ document.querySelector('nav button[data-view="setup"]').click(); $("s-key").focus(); }
function updateKeyNote(){ $("noai").classList.toggle("hidden", !!settings.apiKey); }
$("noaiBtn").onclick = openSetup;
updateKeyNote();
renderThumbs();
archiveStore.all().then(items => { state.archive = items; renderArchive(); }).catch(() => renderArchive());

// Installation als App (Android/Chrome zeigt dafür ein eigenes Angebot)
let installEvt = null;
const standalone = () => matchMedia("(display-mode: standalone)").matches;
if (standalone()) $("installCard").classList.add("hidden");
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; $("installBtn").classList.remove("hidden"); });
window.addEventListener("appinstalled", () => { $("installCard").classList.add("hidden"); toast("Installiert – du findest den Helfer jetzt auf dem Startbildschirm"); });
$("installBtn").onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; $("installBtn").classList.add("hidden"); };

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")){
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
