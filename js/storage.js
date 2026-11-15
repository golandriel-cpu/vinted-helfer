// Archiv der Inserate in IndexedDB (bleibt auf dem Gerät, auch offline).

const DB_NAME = "vinted-helfer";
const STORE = "listings";
let dbp = null;

function open(){
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

async function tx(mode, fn){
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode), st = t.objectStore(STORE);
    const req = fn(st);
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export const archiveStore = {
  async all(){
    const items = await tx("readonly", st => st.getAll());
    // einmalige Übernahme aus älteren Versionen (localStorage)
    try{
      const old = JSON.parse(localStorage.getItem("vh-archive") || "[]");
      if (old.length){
        for (const it of old) if (!items.find(x => x.id === it.id)){ await this.put(it); items.push(it); }
        localStorage.removeItem("vh-archive");
      }
    }catch(e){}
    return items.sort((a, b) => b.created - a.created);
  },
  put(item){ return tx("readwrite", st => st.put(item)); },
  delete(id){ return tx("readwrite", st => st.delete(id)); },
};
