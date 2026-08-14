// Orbit Axis :: Symbol Atlas served-surface contract (Dev Update 1.12).
//
// The Atlas's real behaviour is verified in a real browser; this file pins the
// structural facts that pass depended on, so a refactor that quietly undoes
// one fails in CI rather than in a manual pass nobody re-ran. Same convention
// as compatibility-surface.test.js, and every assertion is here because the
// browser pass (or a prior release) proved the failure mode is real.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const HTML = readFileSync(join(ROOT, "public", "index.html"), "utf8");
const APP = readFileSync(join(ROOT, "public", "app.js"), "utf8");
const CSS = readFileSync(join(ROOT, "public", "styles", "symbol-atlas.css"), "utf8");

// ── Routing ─────────────────────────────────────────────────────────────────

test("nested atlas routes resolve to the atlas workspace, and only the atlas", () => {
  // The hash router is flat; without this clause a shared link like
  // #symbol-atlas/planets/moon redirects to Home with a "not part of Orbit"
  // toast — the exact opposite of a deep link.
  assert.match(APP, /hash\.startsWith\("symbol-atlas\/"\) && workspaceAvailable\("symbol-atlas"\)/,
    "currentWorkspace must claim symbol-atlas/* sub-routes");
  // And resolveLegacyRoute must not eat them: an unknown entry gets the
  // Atlas's own not-found state with the URL intact.
  const lr = APP.slice(APP.indexOf("function resolveLegacyRoute"), APP.indexOf("function showRouteNotice"));
  assert.match(lr, /symbol-atlas\//, "resolveLegacyRoute must leave atlas sub-routes alone");
  // No other workspace gains prefix matching by accident.
  assert.ok(!/hash\.startsWith\("me\/|hash\.startsWith\("home\//.test(APP));
});

test("rapid navigation lets only the final route render", () => {
  // A slow first content load must not paint an older entry over a newer one.
  assert.match(APP, /const seq = \+\+atlasView\.seq/);
  assert.match(APP, /seq !== atlasView\.seq\) return/);
});

test("the content module is lazy-loaded, so app boot pays nothing", () => {
  assert.match(APP, /import\("\/symbol-atlas\/index\.js"\)/);
  assert.ok(!/^import .*symbol-atlas/m.test(APP),
    "the atlas content must not be a static import in app.js");
  // A failed load must be retryable, not cached forever.
  assert.match(APP, /atlasModulePromise = null/);
});

// ── The served skeleton ─────────────────────────────────────────────────────

test("the panel ships the states the interface depends on", () => {
  assert.match(HTML, /id="panel-symbol-atlas"[^>]*aria-labelledby="symbol-atlas-title"[^>]*hidden/);
  assert.match(HTML, /id="symbol-atlas-title" tabindex="-1"/,
    "the heading takes focus on entry navigation, so it needs tabindex=-1");
  assert.match(HTML, /id="atlas-status" role="status" aria-live="polite"/,
    "one live region announces loading, counts, and route problems");
  assert.match(HTML, /id="atlas-crumbs" aria-label="Atlas location"/);
  assert.match(HTML, /styles\/symbol-atlas\.css/);
});

test("the search field keeps a real label wherever it renders", () => {
  assert.match(APP, /<label class="atlas-search__label" for="atlas-search-input">/);
});

test("focus follows the Positions convention, not the compat-era guess", () => {
  // Found in the browser: signed out, the auth gate's focus trap owns focus,
  // and fighting it loses. Positions already encoded the rule; the Atlas
  // must use the same guard.
  assert.match(APP, /if \(focusHeading && authSignedIn\(\)\) h1\?\.focus/);
});

// ── Rendering safety ────────────────────────────────────────────────────────

test("every content value rendered into atlas markup is escaped", () => {
  const start = APP.indexOf("/* ── Symbol Atlas (Dev Update 1.12)");
  assert.ok(start > -1);
  const block = APP.slice(start, APP.indexOf("/* ── Feature flags", start));
  const TEXT_FIELDS = /\.(title|summary|description|name|chartRole|glyph|label)\b|entry\.(themes|strengths|challenges|advanced)/;
  const offenders = [];
  const re = /\$\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(block))) {
    const expr = m[1];
    if (!TEXT_FIELDS.test(expr)) continue;
    if (/\besc\(/.test(expr)) continue;
    if (/\.map\(|\.length|\.join/.test(expr)) continue;   // list plumbing, leaves re-scanned
    if (/^list\(/.test(expr.trim())) continue;              // escapes per item — asserted below
    if (/^paras\(/.test(expr.trim())) continue;             // ditto (Dev Update 3.1)
    offenders.push(expr.trim().slice(0, 60));
  }
  assert.deepEqual(offenders, [], `unescaped interpolation: ${offenders.join(" | ")}`);
  assert.ok((block.match(/esc\(/g) || []).length > 30, "esc() is barely used — the scan is vacuous");
  // The two helpers the scan trusts must actually escape per item. A trusted
  // helper that stopped escaping would make the whole scan a decoration, so
  // both are pinned to their exact bodies rather than to their names.
  assert.match(block, /const list = \(items\) => \(items \|\| \[\]\)\.map\(\(t\) => `<li>\$\{esc\(t\)\}<\/li>`\)/);
  assert.match(block, /const paras = \(items\) => \(items \|\| \[\]\)\.map\(\(p\) => `<p>\$\{esc\(p\)\}<\/p>`\)/);
});

test("no raw HTML flows from content files to the page", () => {
  // Belt to the content test's braces: the renderer never uses innerHTML on a
  // raw content string without esc(), and never uses insertAdjacentHTML.
  const start = APP.indexOf("/* ── Symbol Atlas (Dev Update 1.12)");
  const block = APP.slice(start, APP.indexOf("/* ── Feature flags", start));
  assert.ok(!block.includes("insertAdjacentHTML"));
  assert.ok(!block.includes("outerHTML"));
});

// ── Privacy and boundaries ──────────────────────────────────────────────────

test("the atlas touches no network, storage, or AI at runtime", () => {
  const start = APP.indexOf("/* ── Symbol Atlas (Dev Update 1.12)");
  const block = APP.slice(start, APP.indexOf("/* ── Feature flags", start));
  for (const banned of ["fetch(", "localStorage", "sessionStorage", "XMLHttpRequest",
    "openai", "anthropic", "ollama", "/api/"]) {
    assert.ok(!block.toLowerCase().includes(banned.toLowerCase()),
      `atlas client contains "${banned}" — reference content is local and static`);
  }
  // And the content modules themselves.
  for (const file of ["index.js", "search.js", "categories.js"]) {
    const src = readFileSync(join(ROOT, "public", "symbol-atlas", file), "utf8");
    for (const banned of ["fetch(", "localStorage", "XMLHttpRequest", "process.env"]) {
      assert.ok(!src.includes(banned), `${file} contains "${banned}"`);
    }
  }
});

test("atlas routes carry no identifiers, coordinates, or birth data", () => {
  // Every href the atlas mints is #symbol-atlas[/category[/slug]] — slugs come
  // from the validated content set, never from user data.
  const start = APP.indexOf("/* ── Symbol Atlas (Dev Update 1.12)");
  const block = APP.slice(start, APP.indexOf("/* ── Feature flags", start));
  // Strip comments first: prose about hrefs is not a minted href.
  const code = block.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const hrefs = code.match(/href="#[^"]*"/g) || [];
  for (const href of hrefs) {
    assert.match(href, /^href="#symbol-atlas/, `atlas mints a non-atlas href: ${href}`);
    assert.ok(!/[?&=]/.test(href.slice(6)), `atlas href carries a query string: ${href}`);
  }
});

// ── Width discipline, thrice burned ─────────────────────────────────────────

test("the layout cannot be widened by its own content", () => {
  assert.match(CSS, /\.atlas-crumbs\s*\{[^}]*overflow-wrap:\s*anywhere/s,
    "a long entry title in the crumb trail must wrap, not widen the page");
  const tracks = CSS.match(/grid-template-columns:[^;]+;/g) || [];
  assert.ok(tracks.length > 0);
  for (const t of tracks) {
    // Inner min() strips first, or minmax(min(15rem,100%),1fr)'s nested
    // paren defeats the outer strip and flags a track that is actually safe.
    const stripped = t.replace(/min\([^()]*\)/g, "x").replace(/minmax\([^)]*\)/g, "");
    assert.ok(!/(^|[\s(])1fr/.test(stripped), `bare 1fr track reintroduces the width bug: ${t.trim()}`);
  }
});

test("glyphs are decoration, never the only identifier", () => {
  const start = APP.indexOf("/* ── Symbol Atlas (Dev Update 1.12)");
  const block = APP.slice(start, APP.indexOf("/* ── Feature flags", start));
  // Every glyph span the atlas renders is aria-hidden, and always sits beside
  // a text title — no glyph-only controls.
  const glyphSpans = block.match(/class="[^"]*__glyph"[^>]*/g) || [];
  assert.ok(glyphSpans.length >= 3);
  for (const span of glyphSpans) {
    assert.match(span, /aria-hidden="true"/, `glyph not hidden from screen readers: ${span}`);
  }
});

// ── The old glossary is gone, not duplicated ────────────────────────────────

test("the flat glossary client was replaced, not left as a second opinion", () => {
  assert.ok(!APP.includes("SYMBOL_SEEN_IN"), "the old glossary card renderer survives");
  assert.ok(!APP.includes('data-kind="zodiac_sign"'), "the old filter tabs survive in markup");
  assert.ok(!HTML.includes("sa-results"), "the old results container survives");
  // /api/symbols itself remains — refreshData and the public API still use it.
  assert.match(APP, /get\("\/api\/symbols"\)/);
});
