// Orbit Axis :: the on-device cache (Dev Update 4.2).
//
// Two layers on purpose. The unit tests run storage.js directly — Node has no
// IndexedDB, so they exercise the memory fallback, which is the same code a
// private-browsing session runs; the namespace, refusal, and eviction rules
// are identical on both paths because they sit above the backing store. The
// static tests then hold the application to the wiring the roadmap requires:
// cache-first paints, the staleness label, the clear control, and the two
// privacy rules (sign-out clears, accounts never share).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  cacheGet, cachePut, cacheClear, cacheStats, setCacheNamespace,
  cacheKeyAllowed, CACHE_MAX_ENTRIES, __test,
} from "../public/storage.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "public", "app.js"), "utf8");
const HTML = readFileSync(join(ROOT, "public", "index.html"), "utf8");
const CSS = readFileSync(join(ROOT, "public", "styles", "components.css"), "utf8");
const STORAGE = readFileSync(join(ROOT, "public", "storage.js"), "utf8");

/* ── The store itself ───────────────────────────────────────────────────── */

test("a value round-trips with its timestamp", async () => {
  await cacheClear();
  const before = Date.now();
  assert.equal(await cachePut("sky::tz::2026-08-18", { moon: "waxing" }), true);
  const hit = await cacheGet("sky::tz::2026-08-18");
  assert.deepEqual(hit.value, { moon: "waxing" });
  assert.ok(hit.savedAt >= before, "savedAt is when it was stored — the staleness label depends on it");
  assert.equal((await cacheStats()).entries, 1);
});

test("a miss is null, never a throw", async () => {
  await cacheClear();
  assert.equal(await cacheGet("never-stored"), null);
});

test("anything auth-shaped is refused, on write AND on read", async () => {
  await cacheClear();
  for (const key of ["api/auth/session", "my-session-blob", "signin::x",
                     "SIGNOUT", "password-reset", "token::y"]) {
    assert.equal(cacheKeyAllowed(key), false, `${key} must be refused`);
    assert.equal(await cachePut(key, "secret"), false, `${key} must not be written`);
    // Belt and braces: even a value smuggled into the backing store directly
    // is unreadable through the interface.
    __test.memory.set(key, { value: "smuggled", savedAt: 1 });
    assert.equal(await cacheGet(key), null, `${key} must not be readable`);
  }
  await cacheClear();
});

test("switching accounts empties the cache being left", async () => {
  await setCacheNamespace("account-a");
  await cachePut("fortune::chart::2026-08-18::tz", { fortune: "a's reading" });
  await setCacheNamespace("account-b");
  assert.equal(await cacheGet("fortune::chart::2026-08-18::tz"), null,
    "account B must never see account A's reading");
  await setCacheNamespace("anon");
});

test("the store evicts oldest-first instead of growing forever", async () => {
  await cacheClear();
  for (let i = 0; i < CACHE_MAX_ENTRIES + 1; i += 1) {
    __test.memory.set(`k${i}`, { value: i, savedAt: i });
  }
  __test.evictMemory();
  assert.ok(__test.memory.size <= CACHE_MAX_ENTRIES, "the cap holds");
  assert.equal(__test.memory.has("k0"), false, "the oldest entry went first");
  assert.equal(__test.memory.has(`k${CACHE_MAX_ENTRIES}`), true, "the newest survives");
  await cacheClear();
});

test("no session material can reach the store from the application", () => {
  // The application-side check: no cachePut call site is in the same statement
  // as anything auth-shaped. The store's own refusal list is the real guard —
  // asserted above — this catches a future call site that would depend on it.
  for (const line of APP.split("\n").filter(l => l.includes("cachePut("))) {
    assert.doesNotMatch(line, /auth|session|token|password/i,
      `a cachePut site must never touch session material: ${line.trim()}`);
  }
  assert.match(STORAGE, /const REFUSED = \["auth", "session", "signin", "signout", "password", "token"\]/,
    "the refusal list itself is part of the contract");
});

/* ── The wiring the roadmap requires ────────────────────────────────────── */

test("boot starts the independent requests together and consumes them in order", () => {
  const boot = APP.slice(APP.indexOf("async function boot()"), APP.indexOf("\n}", APP.indexOf("async function boot()")));
  for (const kicked of ["features: fetch(", "session: get(\"/api/auth/session\")",
                        "chart: get(", "symbols: get(", "events: get(", "sky: get("]) {
    assert.ok(boot.includes(kicked), `boot must kick ${kicked} at t0`);
  }
  assert.ok(boot.includes("loadFeatureFlags(early.features)"), "features consumed where it always was");
  assert.ok(boot.includes("restoreSession(early.session)"), "session consumed where it always was");
  assert.ok(boot.includes("refreshData(false, early)"), "the data batch reuses the kicked requests");
  // The measured defect was strict serialization; a bare sequential await
  // chain must not quietly return.
  assert.match(APP, /const data = await \(pre \?\? get\("\/api\/auth\/session"\)\)/,
    "restoreSession accepts the pre-started request");
});

test("Today paints from the cache first and says so in text", () => {
  assert.match(APP, /cacheGet\(kChart\)/, "the data batch reads the cache before the network");
  assert.match(APP, /cacheNote\(paintedAt\)/, "cached data is labelled with its age");
  assert.match(APP, /cacheNote\(null\)/, "the label clears when fresh data lands");
  assert.match(APP, /cacheNote\(paintedAt, \{ failed: true \}\)/,
    "a failed refresh over cached content tells the truth instead of throwing");
  assert.match(HTML, /id="today-cache-note"/, "the label has a home on Today");
  assert.match(CSS, /\.cache-note \{/, "and a quiet style");
});

test("the daily reading is cached under chart, day, and timezone", () => {
  assert.match(APP, /fortune::\$\{state\.activeChartId \|\| "active"\}::\$\{localDayKey\(tz\)\}::\$\{tz\}/,
    "the reading's key carries everything that would make it a different reading");
  assert.match(APP, /if \(fortuneCachedAt != null\)/,
    "a cached reading survives a failed refresh");
  const guard = APP.slice(APP.indexOf("if (fortuneCachedAt != null)"), APP.indexOf("if (fortuneCachedAt != null)") + 400);
  assert.ok(guard.includes("return;"),
    "and is never replaced by the setup messages below it");
});

test("sign-out and account switching both empty the cache", () => {
  const clear = APP.slice(APP.indexOf("function clearPrivateState"), APP.indexOf("\n}", APP.indexOf("function clearPrivateState")));
  assert.ok(clear.includes("resetDeviceCache()"), "clearPrivateState covers sign-out AND deletion");
  assert.match(APP, /await setCacheNamespace\(String\(user\?\.id \|\| "anon"\)\)/,
    "signing in scopes the cache to the account, awaited so nothing races into the old one");
});

test("the reader can clear the cache themselves, from You", () => {
  assert.match(HTML, /id="cache-clear"/, "the control exists");
  assert.match(HTML, /Nothing on your account is affected/, "and says what it does not do");
  assert.match(APP, /function wireCacheClear\(\)/, "and is wired");
  assert.match(APP, /wireCacheClear\(\);/, "and the wiring actually runs");
});

test("chart pictures load through the cache, not through bare img src", () => {
  assert.match(APP, /data-avatar-chart="\$\{esc\(chart\.id\)\}"/, "the markup carries the key parts");
  assert.match(APP, /async function hydrateAvatars\(\)/, "hydration exists");
  assert.match(APP, /avatar::\$\{id\}::v\$\{version\}/, "cached under id and version, so a replaced picture is a new key");
  const direct = APP.match(/src="\$\{esc\(avatarUrl\(/g) || [];
  assert.equal(direct.length, 1,
    "exactly one direct-src use survives — the identity editor's own preview");
});
