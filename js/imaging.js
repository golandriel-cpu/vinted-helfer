// Bildbearbeitung: Freistellen per KI-Modell im Browser (@imgly/background-removal, ISNet),
// Tageslicht-Korrektur und Komposition auf weißem Hintergrund. Läuft komplett auf dem Gerät.

let status = () => {};
export function setStatusHandler(fn){ status = fn || (() => {}); }

const BGR_URL = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm";
const BGR_MODEL = "isnet_quint8";   // ~44 MB, gute Qualität bei vertretbarer Größe fürs Handy

export function loadImg(f){ return new Promise((res, rej) => { const url = URL.createObjectURL(f); const img = new Image(); img.onload = () => res({img, url}); img.onerror = rej; img.src = url; }); }
export function canvasOf(img, max){
  const s = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round((img.naturalWidth || img.width) * s)); c.height = Math.max(1, Math.round((img.naturalHeight || img.height) * s));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c;
}
export const canvasBlob = (c, q, type = "image/jpeg") => new Promise(r => c.toBlob(r, type, q));
export async function toBlob(img, max, q){ const c = canvasOf(img, max); return { blob: await canvasBlob(c, q), dataUrl: max <= 300 ? c.toDataURL("image/jpeg", q) : null }; }

// ---------- Freistell-KI (lazy) ----------
// Modul in ein Objekt verpacken (nie direkt resolven), falls es „thenable“ ist.
let bgrPromise = null;
function loadBGR(){
  if (!bgrPromise) bgrPromise = import(BGR_URL).then(m => ({ m })).catch(e => { bgrPromise = null; throw e; });
  return bgrPromise;
}
let firstRun = true;
function progress(key, cur, total){
  if (!firstRun || !/fetch/.test(key) || !total) return;
  status(`Lade Freistell-KI (einmalig, ca. 55 MB) … ${Math.round(cur / total * 100)} %`);
}

// liefert Uint8ClampedArray (Alpha 0–255) in Größe von `c`, oder null
async function aiAlpha(c){
  const { m } = await loadBGR();
  const blob = await canvasBlob(c, .95);
  const out = await m.removeBackground(blob, { model: BGR_MODEL, output: { format: "image/png" }, progress });
  if (firstRun) status("");
  firstRun = false;
  const bmp = await createImageBitmap(out);
  const t = document.createElement("canvas"); t.width = c.width; t.height = c.height;
  const ctx = t.getContext("2d"); ctx.drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close();
  const d = ctx.getImageData(0, 0, c.width, c.height).data, a = new Uint8ClampedArray(c.width * c.height);
  for (let p = 0; p < a.length; p++) a[p] = d[p*4 + 3];
  return a;
}

// Maske aufräumen: nur große Teile behalten (bei KI-Rahmen bevorzugt die im Rahmen),
// Kanten etwas straffen, damit kein Saum vom alten Hintergrund bleibt.
function cleanAlpha(a, w, h, box){
  const lab = new Int32Array(w*h), comps = [{}], st = [];
  for (let p = 0; p < a.length; p++){
    if (a[p] < 128 || lab[p]) continue;
    const c = { n: 0, x0: w, y0: h, x1: 0, y1: 0 }; const id = comps.length; comps.push(c);
    st.push(p); lab[p] = id;
    while (st.length){
      const q = st.pop(), x = q % w, y = (q / w) | 0; c.n++;
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      if (x > 0 && a[q-1] >= 128 && !lab[q-1]){ lab[q-1] = id; st.push(q-1); }
      if (x < w-1 && a[q+1] >= 128 && !lab[q+1]){ lab[q+1] = id; st.push(q+1); }
      if (y > 0 && a[q-w] >= 128 && !lab[q-w]){ lab[q-w] = id; st.push(q-w); }
      if (y < h-1 && a[q+w] >= 128 && !lab[q+w]){ lab[q+w] = id; st.push(q+w); }
    }
  }
  if (comps.length < 2) return null;
  let cand = comps.slice(1);
  if (box){
    const bx0 = box[0]/1000*w, by0 = box[1]/1000*h, bx1 = box[2]/1000*w, by1 = box[3]/1000*h;
    const inBox = cand.filter(c => {
      const ix = Math.max(0, Math.min(c.x1, bx1) - Math.max(c.x0, bx0)), iy = Math.max(0, Math.min(c.y1, by1) - Math.max(c.y0, by0));
      return ix * iy > .3 * (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1);
    });
    if (inBox.length) cand = inBox;   // Rahmen passt nicht? Dann ignorieren statt Artikel abzuschneiden
  }
  const max = Math.max(...cand.map(c => c.n));
  const keep = new Set(cand.filter(c => c.n >= max * .06).map(c => comps.indexOf(c)));
  // Weiche Kante: Pixel nahe an behaltenen Teilen bleiben (Halbtransparenz), alles andere raus
  const keepPx = new Uint8Array(w*h);
  for (let p = 0; p < a.length; p++) if (keep.has(lab[p])) keepPx[p] = 1;
  const grow = new Uint8Array(keepPx), R = 3;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const p = y*w + x; if (!keepPx[p]) continue;
    const onEdge = (x > 0 && !keepPx[p-1]) || (x < w-1 && !keepPx[p+1]) || (y > 0 && !keepPx[p-w]) || (y < h-1 && !keepPx[p+w]);
    if (!onEdge) continue;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++){
      const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) grow[yy*w + xx] = 1;
    }
  }
  const out = new Uint8ClampedArray(w*h); let n = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let p = 0; p < a.length; p++){
    if (!grow[p]) continue;
    const v = Math.max(0, Math.min(255, (a[p] - 30) * 255 / 190)); out[p] = v;
    if (v >= 128){ n++; const x = p % w, y = (p / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const f = n / (w*h);
  if (f < .02 || f > .97) return null;
  return { alpha: out, bbox: [x0, y0, x1, y1] };
}

// ---------- Tageslicht-Korrektur ----------
// alpha (optional): Maske des Artikels – dann wird darauf geachtet, dass seine Farben nicht ausbrennen
function correctColors(c, alpha){
  const ctx = c.getContext("2d"), id = ctx.getImageData(0, 0, c.width, c.height), d = id.data, n = c.width * c.height;
  const lum = [], step = 3;
  for (let p = 0; p < n; p += step){ const i = p*4; lum.push(0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2]); }
  const sorted = lum.slice().sort((a, b) => a - b), pct = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  // Weißabgleich nur, wenn die hellsten Stellen ein leicht getöntes Weiß/Grau sind
  // (bei Holzboden, roter Kleidung o. Ä. würde ein Abgleich die Farben verfälschen)
  const hiT = pct(.975);
  let sr = 0, sg = 0, sb = 0, cnt = 0;
  for (let k = 0, p = 0; p < n; p += step, k++){
    if (lum[k] >= hiT){ const i = p*4; if (d[i] > 250 && d[i+1] > 250 && d[i+2] > 250) continue; sr += d[i]; sg += d[i+1]; sb += d[i+2]; cnt++; }
  }
  let gr = 1, gg = 1, gb = 1;
  if (cnt > 20){
    sr /= cnt; sg /= cnt; sb /= cnt; const avg = (sr + sg + sb) / 3;
    const tint = (Math.max(sr, sg, sb) - Math.min(sr, sg, sb)) / Math.max(1, avg);
    if (avg > 120 && tint < .22){
      const str = .8, clampG = v => Math.max(.88, Math.min(1.14, v));
      gr = clampG(1 + (avg / sr - 1) * str); gg = clampG(1 + (avg / sg - 1) * str); gb = clampG(1 + (avg / sb - 1) * str);
    }
  }
  // Belichtung: Lichter Richtung Weiß, aber höchstens +35 %, dunkle Kleidung nicht ausgrauen
  const hi = pct(.995), lo = pct(.005);
  // Obergrenze: kräftige Farben des Artikels (z. B. Rot) dürfen nicht ausbrennen
  const mx = [];
  for (let p = 0; p < n; p += step){ if (alpha && alpha[p] < 128) continue; const i = p*4; mx.push(Math.max(d[i] * gr, d[i+1] * gg, d[i+2] * gb)); }
  mx.sort((a, b) => a - b);
  const mx99 = mx.length ? mx[Math.floor(mx.length * .99)] : hi;
  // (Reserve für Gamma/Sättigung, die danach noch etwas aufhellen)
  const expo = Math.max(1, Math.min(1.35, 245 / Math.max(1, hi), 228 / Math.max(1, mx99)));
  const med = pct(.5) * expo;
  const gamma = med < 90 ? .9 : med < 120 ? .95 : 1;
  const blk = Math.min(14, lo * .5);
  const lut = g => { const t = new Uint8ClampedArray(256); for (let v = 0; v < 256; v++){ let x = Math.max(0, v * g * expo - blk) / (255 - blk); x = Math.pow(Math.min(1, x), gamma); t[v] = Math.round(x * 255); } return t; };
  const Lr = lut(gr), Lg = lut(gg), Lb = lut(gb), sat = 1.05;
  for (let i = 0; i < d.length; i += 4){
    const r = Lr[d[i]], g = Lg[d[i+1]], b = Lb[d[i+2]];
    const l = 0.299*r + 0.587*g + 0.114*b;
    d[i] = l + (r - l) * sat; d[i+1] = l + (g - l) * sat; d[i+2] = l + (b - l) * sat;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

// mode: "weiss" (freistellen auf Weiß) | "licht" (nur Lichtkorrektur); box: [x0,y0,x1,y1] 0–1000 oder null
// memo: beliebiges Objekt pro Foto; die KI-Maske wird darin zwischengespeichert,
// damit z. B. ein neuer KI-Rahmen nicht erneut die langsame Freistellung auslöst.
export async function editImage(img, mode, box, opts = {}, memo = {}){
  const full = canvasOf(img, 1600);
  if (mode === "licht") return correctColors(full);
  let seg = null;
  try{
    if (!memo.alpha || memo.w !== full.width || memo.h !== full.height){
      memo.alpha = await aiAlpha(full); memo.w = full.width; memo.h = full.height;
    }
    const a = memo.alpha;
    seg = a && cleanAlpha(a, full.width, full.height, box);
    if (!seg) status("Artikel nicht sicher erkennbar – nur Licht korrigiert. Tipp: Artikel ganz und mit etwas Abstand zum Rand fotografieren.");
  }catch(e){
    console.warn("Freistellen", e);
    status("Freistellen nicht möglich (Internetverbindung beim ersten Mal nötig) – nur Licht korrigiert.");
  }
  correctColors(full, seg && seg.alpha);
  if (!seg) return full;
  const W = full.width, H = full.height;
  // Alpha-Maske als Canvas
  const fm = document.createElement("canvas"); fm.width = W; fm.height = H;
  const fctx = fm.getContext("2d"), mid = fctx.createImageData(W, H);
  for (let p = 0; p < seg.alpha.length; p++) mid.data[p*4 + 3] = seg.alpha[p];
  fctx.putImageData(mid, 0, 0);
  // Artikel ausschneiden
  const cut = document.createElement("canvas"); cut.width = W; cut.height = H;
  const cctx = cut.getContext("2d"); cctx.drawImage(full, 0, 0); cctx.globalCompositeOperation = "destination-in"; cctx.drawImage(fm, 0, 0);
  // zentriert auf Weiß setzen
  const [x0, y0, x1, y1] = seg.bbox, m = 4;
  const bx = Math.max(0, x0 - m), by = Math.max(0, y0 - m), bw = Math.min(W, x1 + m + 1) - bx, bh = Math.min(H, y1 + m + 1) - by;
  const OW = 1200, OH = opts.format === "11" ? 1200 : 1500;
  const sc = Math.min(OW * .84 / bw, OH * .84 / bh, 2);
  const dw = bw * sc, dh = bh * sc, dx = (OW - dw) / 2, dy = (OH - dh) / 2;
  const out = document.createElement("canvas"); out.width = OW; out.height = OH;
  const o = out.getContext("2d"); o.fillStyle = "#fff"; o.fillRect(0, 0, OW, OH);
  o.imageSmoothingEnabled = true; o.imageSmoothingQuality = "high";
  if (opts.shadow){
    const sh = document.createElement("canvas"); sh.width = W; sh.height = H;
    const shc = sh.getContext("2d"); shc.drawImage(fm, 0, 0); shc.globalCompositeOperation = "source-in"; shc.fillStyle = "#000"; shc.fillRect(0, 0, W, H);
    o.save(); o.globalAlpha = .14; o.filter = `blur(${Math.round(OW * .014)}px)`;
    o.drawImage(sh, bx, by, bw, bh, dx + OW * .006, dy + OH * .012, dw, dh); o.restore();
  }
  o.drawImage(cut, bx, by, bw, bh, dx, dy, dw, dh);
  return out;
}
