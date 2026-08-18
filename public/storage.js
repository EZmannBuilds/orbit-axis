// Orbit Axis :: the one on-device store. Dev Update 4.2.
//
// Decision record: [[Architecture Notes — On-Device Storage]], approved
// 2026-08-18. IndexedDB is the cache, behind exactly this module — no other
// file touches IndexedDB, so the namespace, eviction, and refusal rules below
// exist in one place instead of wherever each feature happened to put them.
//
// WHAT THIS IS AND IS NOT.
//
// A cache. Losing it costs a network refresh and nothing else. It therefore
// refuses, structurally, to hold anything whose loss would matter or whose
// theft would matter: no session material, nothing from the auth endpoints.
// The server stays the source of truth for every value in here.
//
// NAMESPACES ARE ACCOUNTS.
//
// One IndexedDB database per namespace — "anon" for the signed-out preview, an
// account id once signed in. Switching namespaces DELETES the database being
// left. That is the privacy rule from the roadmap ("two accounts on one device
// never see each other's cache", "sign-out clears it") enforced in the only
// place it cannot be forgotten: you cannot switch without the old data going.
// Deleting on every switch — even anon→account — costs one refetch of public
// sky data and buys never having to argue about which switches are sensitive.
//
// PRIVATE BROWSING AND OLD WEBVIEWS.
//
// Where IndexedDB is unavailable or broken, everything falls back to an
// in-memory Map with the same interface: the app behaves identically, the
// cache simply lasts one session. The fallback is also what makes this module
// unit-testable in Node without shimming a browser database.

const NAMESPACE_KEY = "orbit.cache.ns";
const DB_PREFIX = "orbit-cache::";
const STORE = "kv";

/** Entries beyond this are evicted oldest-first on the next write. */
export const CACHE_MAX_ENTRIES = 300;
/** How many to shed per eviction pass — one pass, not a loop per write. */
const EVICT_BATCH = 50;

/**
 * Keys that must never be cached. Substring match on purpose: a key is built
 * from a request path, and any auth- or session-shaped path is refused no
 * matter how it is spelled into a key later.
 */
const REFUSED = ["auth", "session", "signin", "signout", "password", "token"];

export function cacheKeyAllowed(key) {
  const k = String(key).toLowerCase();
  return !REFUSED.some((word) => k.includes(word));
}

/* ── The backing store ──────────────────────────────────────────────────── */

const hasIDB = typeof indexedDB !== "undefined" && indexedDB !== null;

/** Session-lifetime fallback when IndexedDB is unavailable. */
const memory = new Map();
let memoryOnly = !hasIDB;

let namespace = null;
let dbPromise = null;

function readNamespace() {
  try { return localStorage.getItem(NAMESPACE_KEY) || "anon"; }
  catch { return "anon"; }
}

function writeNamespace(ns) {
  try { localStorage.setItem(NAMESPACE_KEY, ns); } catch { /* session-only */ }
}

function openDb(ns) {
  return new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(DB_PREFIX + ns, 1);
    } catch {
      memoryOnly = true;
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("savedAt", "savedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    // A refused or broken database is not an error the reader should meet —
    // the cache degrades to memory and the network path still works.
    request.onerror = () => { memoryOnly = true; resolve(null); };
    request.onblocked = () => { memoryOnly = true; resolve(null); };
  });
}

function db() {
  if (memoryOnly) return Promise.resolve(null);
  if (!dbPromise) {
    namespace = namespace ?? readNamespace();
    dbPromise = openDb(namespace);
  }
  return dbPromise;
}

function tx(database, mode, run) {
  return new Promise((resolve, reject) => {
    const t = database.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out = run(store);
    t.oncomplete = () => resolve(out?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/* ── The interface the application uses ─────────────────────────────────── */

/** @returns {Promise<{value: any, savedAt: number} | null>} */
export async function cacheGet(key) {
  if (!cacheKeyAllowed(key)) return null;
  const database = await db();
  if (!database) {
    const hit = memory.get(key);
    return hit ? { value: hit.value, savedAt: hit.savedAt } : null;
  }
  try {
    const row = await new Promise((resolve, reject) => {
      const t = database.transaction(STORE, "readonly");
      const req = t.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    return row ? { value: row.value, savedAt: row.savedAt } : null;
  } catch {
    return null;
  }
}

export async function cachePut(key, value) {
  // Refusal is silent by design: the caller wrote through the cache as a
  // courtesy, and the request itself already succeeded.
  if (!cacheKeyAllowed(key)) return false;
  const savedAt = Date.now();
  const database = await db();
  if (!database) {
    memory.set(key, { value, savedAt });
    evictMemory();
    return true;
  }
  try {
    await tx(database, "readwrite", (store) => store.put({ key, value, savedAt }));
    await evictIdb(database);
    return true;
  } catch (error) {
    // A full disk is the one failure worth one recovery attempt: shed the
    // oldest entries and retry once. Still failing → degrade quietly.
    if (error && error.name === "QuotaExceededError") {
      try {
        await evictIdb(database, { force: true });
        await tx(database, "readwrite", (store) => store.put({ key, value, savedAt }));
        return true;
      } catch { /* fall through */ }
    }
    memory.set(key, { value, savedAt });
    return false;
  }
}

export async function cacheClear() {
  memory.clear();
  const database = await db();
  if (!database) return;
  try { await tx(database, "readwrite", (store) => store.clear()); } catch { /* gone anyway */ }
}

/** Entry count, for the settings row and for tests. */
export async function cacheStats() {
  const database = await db();
  if (!database) return { entries: memory.size, persistent: false };
  try {
    const entries = await new Promise((resolve, reject) => {
      const t = database.transaction(STORE, "readonly");
      const req = t.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return { entries, persistent: true };
  } catch {
    return { entries: memory.size, persistent: false };
  }
}

/**
 * Switch accounts. The database being left is DELETED, not kept — see the
 * namespace rule in the header. Safe to call with the current namespace, in
 * which case nothing happens.
 */
export async function setCacheNamespace(ns) {
  const next = String(ns || "anon");
  const current = namespace ?? readNamespace();
  if (next === current && dbPromise !== null) return;
  if (next === current) { namespace = current; return; }

  // Close and delete the old database before the new one opens.
  const old = await db();
  try { old?.close(); } catch { /* already closed */ }
  dbPromise = null;
  memory.clear();
  if (hasIDB && !memoryOnly) {
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(DB_PREFIX + current);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  }
  namespace = next;
  writeNamespace(next);
}

/* ── Eviction ───────────────────────────────────────────────────────────── */

function evictMemory() {
  if (memory.size <= CACHE_MAX_ENTRIES) return;
  const oldest = [...memory.entries()]
    .sort((a, b) => a[1].savedAt - b[1].savedAt)
    .slice(0, EVICT_BATCH);
  for (const [key] of oldest) memory.delete(key);
}

async function evictIdb(database, { force = false } = {}) {
  try {
    const count = await new Promise((resolve, reject) => {
      const t = database.transaction(STORE, "readonly");
      const req = t.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!force && count <= CACHE_MAX_ENTRIES) return;
    await new Promise((resolve, reject) => {
      const t = database.transaction(STORE, "readwrite");
      const index = t.objectStore(STORE).index("savedAt");
      let shed = 0;
      const cursor = index.openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c || shed >= EVICT_BATCH) return resolve();
        c.delete(); shed += 1; c.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
  } catch { /* eviction is best-effort */ }
}

/* ── Test seams ─────────────────────────────────────────────────────────── */

/** Node has no IndexedDB, so tests exercise the memory path — the same code
 * a private-browsing session runs. Not for application use. */
export const __test = { memory, evictMemory, readNamespace };
