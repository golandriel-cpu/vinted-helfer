// KI-Anbindung: Google Gemini (kostenloser API-Schlüssel aus Google AI Studio).
// Der Schlüssel liegt nur im Browser (localStorage) und geht direkt an Google.

export const MODELS = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (empfohlen)" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (schnell, mehr Freikontingent)" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (älter)" },
];
export const DEFAULT_MODEL = MODELS[0].id;

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

function blobToBase64(blob){
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

/** Prüft Schlüssel + Modell, ohne Kontingent zu verbrauchen (fragt nur die Modellinfo ab). */
export async function checkKey(apiKey, model){
  let res;
  try{ res = await fetch(`${ENDPOINT}/${encodeURIComponent(model || DEFAULT_MODEL)}`, { headers: { "x-goog-api-key": apiKey } }); }
  catch(e){ throw { code: "network", message: "Keine Verbindung" }; }
  if (res.ok) return true;
  const data = await res.json().catch(() => ({}));
  const msg = (data.error && data.error.message) || `HTTP ${res.status}`;
  if (res.status === 429) throw { code: "rate_limited", message: msg };
  if (res.status === 404) throw { code: "model", message: msg };
  if (res.status === 400 || res.status === 401 || res.status === 403) throw { code: "bad_key", message: msg };
  throw { code: "http", message: msg };
}

/**
 * Schickt Prompt + Bilder an Gemini und gibt den Antworttext (JSON-String) zurück.
 * Wirft {code, message} mit code ∈ bad_key | model | rate_limited | network | empty | http.
 */
export async function askGemini({ apiKey, model, prompt, images = [] }){
  const parts = [{ text: prompt }];
  for (const b of images) parts.push({ inline_data: { mime_type: b.type || "image/jpeg", data: await blobToBase64(b) } });

  let res;
  try{
    res = await fetch(`${ENDPOINT}/${encodeURIComponent(model || DEFAULT_MODEL)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.6 },
      }),
    });
  }catch(e){
    throw { code: "network", message: "Keine Verbindung zu Gemini" };
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok){
    const msg = (data.error && data.error.message) || `HTTP ${res.status}`;
    if (res.status === 429) throw { code: "rate_limited", message: msg };
    if (res.status === 404) throw { code: "model", message: msg };
    if (res.status === 401 || res.status === 403 || /API key/i.test(msg)) throw { code: "bad_key", message: msg };
    throw { code: "http", message: msg };
  }
  const cand = data.candidates && data.candidates[0];
  const text = cand && cand.content && (cand.content.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
  if (!text) throw { code: "empty", message: (cand && cand.finishReason) || "Leere Antwort" };
  return text;
}
