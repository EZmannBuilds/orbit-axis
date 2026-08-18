// Orbit Axis :: Transits and Symbol Atlas (Update 5.2b).
//
// Two secondary destinations reached from Home's Technical Sky. The properties
// worth pinning are the ones that would degrade quietly: deterministic ordering
// (a list that reshuffles between renders is a list nobody trusts), honest
// handling of an unknown birth time, and glyphs that never appear without a
// readable name.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ORBIT_SYMBOLS } from "../lib/symbols.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(ROOT, "public", "app.js"), "utf8");
const html = readFileSync(join(ROOT, "public", "index.html"), "utf8");

// ── Home actions ────────────────────────────────────────────────────────────

test("Home offers both destinations from Technical Sky", () => {
  // Today's Transits is primary navigation as of Dev Update 1.3, but Technical
  // Sky still links to it: the section explains what the page expands on, and
  // the link uses the same canonical name the tab does.
  // Dev Update 1.6 moved these out of Technical Sky into a dedicated
  // "Continue exploring" section, so they are markup rather than template
  // strings now. Both destinations are still reachable from Home, which is
  // what this test has always been about.
  // The redesign removed the "Continue exploring" card these three links lived
  // in: all three destinations are now tabs, permanently on screen, and a
  // duplicate list of them at the foot of Today was a second navigation to keep
  // in step with the first. The guarantee this test is actually about — every
  // destination stays reachable — is checked against the registry below, which
  // is stronger than matching three link labels.
  const primary = [...appJs.matchAll(/id: "([a-z-]+)"[^}]*primary: true/g)].map((m) => m[1]);
  for (const id of ["transits", "symbol-atlas", "me"]) {
    assert.ok(primary.includes(id), `#${id} must be reachable — it is a primary tab`);
  }
  // Dev Update 1.7 built Positions, so the rule this asserted — never link a
  // route that does not exist — now permits it. Checked against the registry
  // rather than a hardcoded exclusion, so it stays true as routes are added.
  const registry = appJs.slice(appJs.indexOf("const WORKSPACES"), appJs.indexOf("const RETIRED_ROUTES"));
  const registered = [...registry.matchAll(/id: "([a-z-]+)"/g)].map((m) => m[1]);
  // In-page anchors (the skip link targets #workspace-title) are not routes,
  // so they are excluded by checking whether the fragment names an element id.
  const elementIds = new Set([...html.matchAll(/id="([a-zA-Z0-9_-]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/href="#([a-z-]+)"/g)) {
    if (elementIds.has(m[1])) continue;
    assert.ok(registered.includes(m[1]),
      `markup links to #${m[1]}, which is neither a workspace nor an in-page anchor`);
  }
  assert.ok(registered.includes("positions"), "Positions is a real workspace as of Dev Update 1.7");
});

test("the actions are inside Technical Sky, not above the fortune", () => {
  // Placement is what makes them secondary. Emitted within the sky renderer,
  // which Home renders after the fortune.
  // axisWireSkyControls happens to be declared BEFORE axisRenderSky, so the
  // slice runs from the renderer to the end of its template rather than to a
  // function that precedes it.
  // Matched with the opening paren: `axisRenderSkyError` is a real function in
  // this file and a bare "function axisRenderSky" prefix-matches it, slicing
  // the wrong body and failing for a reason that has nothing to do with layout.
  // The destinations now live in their own section BELOW the fortune, which
  // is the same guarantee stated structurally: the reading comes first.
  // What this has always been about: the READING comes first, and the technical
  // detail that explains it comes after. Still true, and now with nothing
  // between them but the Moon and the highlights.
  const fortuneMount = html.indexOf('id="today-fortune"');
  const skyMount = html.indexOf('id="today-sky"');
  assert.ok(fortuneMount > 0 && fortuneMount < skyMount, "the fortune renders before Technical Sky");
  const daysAt = html.indexOf('id="today-days"');
  assert.ok(daysAt > 0 && daysAt < fortuneMount,
    "the week strip is the one thing above the reading — it says which day you are reading");
});

test("Dev Update 1.3 placed each destination on the correct level", () => {
  // Today's Transits earned a tab: it is a daily destination. The Symbol Atlas
  // did not — it is a reference someone consults occasionally, and it is
  // reached from Tools and from the transit details that use its symbols.
  const level = (id) => {
    const entry = new RegExp(`id: "${id}"[^}]*primary: (true|false)`).exec(appJs);
    assert.ok(entry, `${id} should be registered as a workspace`);
    return entry[1];
  };
  assert.equal(level("transits"), "true", "Sky is one of the five");
  // The Atlas was secondary when it was three screens of stubs. It is now the
  // deepest finished feature in the app — seven categories, ~50 authored
  // entries — and it is what every other surface links into when a reader
  // meets a symbol they do not know. That earns the tab Tools gave up.
  assert.equal(level("symbol-atlas"), "true", "the Atlas is one of the five");
});

test("Learn and News stay gone", () => {
  for (const id of ["learn", "news"]) {
    assert.ok(!html.includes(`id="panel-${id}"`), `panel-${id} must not be in the shipped markup`);
  }
});

// ── Transit ordering ────────────────────────────────────────────────────────
//
// Rebuilt here from the documented rules so the test fails if the rules and the
// implementation drift apart.

const PERSONAL = ["Moon", "Mercury", "Venus", "Sun", "Mars"];
function rank(t) {
  const p = PERSONAL.indexOf(t.transiting);
  return {
    applying: t.applying ? 0 : 1,
    orb: Number.isFinite(t.orb) ? t.orb : 99,
    speed: p === -1 ? PERSONAL.length : p,
    name: `${t.transiting}|${t.natal}|${t.aspect}`,
  };
}
const sortTransits = (list) => [...list].sort((a, b) => {
  const x = rank(a), y = rank(b);
  return x.applying - y.applying || x.orb - y.orb || x.speed - y.speed || x.name.localeCompare(y.name);
});

const SAMPLE = [
  { transiting: "Pluto", natal: "Sun", aspect: "square", orb: 0.2, applying: true },
  { transiting: "Moon", natal: "Venus", aspect: "trine", orb: 0.2, applying: true },
  { transiting: "Venus", natal: "Mars", aspect: "sextile", orb: 3.0, applying: true },
  { transiting: "Mars", natal: "Moon", aspect: "square", orb: 0.5, applying: false },
];

test("applying transits come before separating ones", () => {
  const sorted = sortTransits(SAMPLE);
  const firstSeparating = sorted.findIndex((t) => !t.applying);
  const lastApplying = sorted.map((t) => t.applying).lastIndexOf(true);
  assert.ok(lastApplying < firstSeparating, "something building outranks something fading");
});

test("a tighter orb outranks a looser one", () => {
  const sorted = sortTransits(SAMPLE);
  const applying = sorted.filter((t) => t.applying);
  for (let i = 1; i < applying.length; i += 1) {
    assert.ok(applying[i - 1].orb <= applying[i].orb, "orbs ascend within the applying group");
  }
});

test("a personal body outranks a slow one at equal orb", () => {
  const sorted = sortTransits(SAMPLE);
  const moon = sorted.findIndex((t) => t.transiting === "Moon");
  const pluto = sorted.findIndex((t) => t.transiting === "Pluto");
  assert.ok(moon < pluto, "the Moon lands within a day; Pluto does not");
});

test("ordering is deterministic across repeated sorts", () => {
  // Without the name tie-break, two equal transits could swap between renders.
  const tie = [
    { transiting: "Venus", natal: "Sun", aspect: "trine", orb: 1, applying: true },
    { transiting: "Venus", natal: "Moon", aspect: "trine", orb: 1, applying: true },
  ];
  const a = sortTransits(tie).map((t) => t.natal);
  for (let i = 0; i < 25; i += 1) {
    assert.deepEqual(sortTransits(tie).map((t) => t.natal), a);
  }
});

test("transit ranking lives on the server, and only there", () => {
  // Dev Update 1.8 moved ranking into lib/transits, where it is tested against
  // fixtures. The browser-side ranker was removed rather than left in place:
  // two rankers are one more than the number that can be right.
  assert.ok(!appJs.includes("const PERSONAL_BODIES"), "the client ranker is gone");
  assert.ok(!appJs.includes("function transitRank"), "and not merely unused");
  const mod = readFileSync(join(ROOT, "lib", "transits", "transits.js"), "utf8");
  assert.match(mod, /export function rankTransits/);
  assert.match(mod, /relevance/, "relevance leads the sort");
  assert.match(mod, /pair: t\.id/, "with a deterministic final tie-break");
});

test("the fortune three-factor path is gone, with no hidden fallback", () => {
  // The old page read AXIS.lastFortune.factors and filtered type === "transit".
  // The fortune engine emits transits.slice(0, 3), so it could never show more
  // than three contacts. A fallback would hide a broken endpoint behind three
  // plausible cards.
  assert.ok(!appJs.includes("transitsFromFortune"), "the fortune-derived reader is removed");
  assert.ok(!/lastFortune\?\.factors/.test(appJs.slice(appJs.indexOf("const TRANSITS ="))),
    "the transits workspace must not reach for fortune factors");
  assert.match(appJs, /\/api\/charts\/\$\{chart\.id\}\/transits/,
    "it consumes the dedicated endpoint");
});

test("client-side transit filters are gone, replaced by ranked groups", () => {
  // Five filter buttons asked the reader to do the sorting. Ranked immediate
  // and background groups do it for them.
  assert.ok(!appJs.includes("TRANSIT_FILTERS"), "the filter set is removed");
  assert.ok(!appJs.includes("filterTransits"), "and its filter function");
  assert.match(appJs, /Most active today/);
  assert.match(appJs, /Background influences/);
});

test("an unknown birth time cannot receive a house or angle contact at all", () => {
  // Stronger than the old filter: angles and houses are absent from the natal
  // target set entirely, so there is no filter left to forget.
  const mod = readFileSync(join(ROOT, "lib", "transits", "transits.js"), "utf8");
  const set = mod.slice(mod.indexOf("export const TRANSITING_BODIES"), mod.indexOf("export const ASPECTS"));
  for (const forbidden of ["Ascendant", "Midheaven", "MC", "house"]) {
    assert.ok(!set.includes(forbidden), `${forbidden} must not be a natal target`);
  }
  assert.match(mod, /export function birthTimeNotice/, "and a concise notice explains the omission");
});

test("the browser never computes aspect geometry", () => {
  const start = appJs.indexOf("const TRANSITS = {");
  const end = appJs.indexOf("/* ── Symbol Atlas");
  const source = appJs.slice(start, end > start ? end : undefined);
  for (const forbidden of ["Math.abs", "longitude", "Math.cos", "Math.sin", "% 360"]) {
    assert.ok(!source.includes(forbidden),
      `the transits view must not calculate geometry (${forbidden})`);
  }
  assert.match(source, /await get\(`\/api\/charts\//, "it consumes the server response instead");
});

test("opening transits performs no write", () => {
  // Scoped to the LOAD path. Switching charts legitimately POSTs to /activate —
  // that is a deliberate user action, not the act of opening the page. The old
  // slice anchors were removed in Dev Update 1.8, and an unanchored indexOf
  // returns -1, which silently scans the whole file.
  const start = appJs.indexOf("async function loadTransits()");
  assert.ok(start > -1, "the load path must exist to be scoped");
  const end = appJs.indexOf("function transitsRenderSignedOut");
  assert.ok(end > start, "and its end must be found, not defaulted");
  const source = appJs.slice(start, end);
  for (const write of ["post(", "put(", "patch(", "del(", 'method: "POST"']) {
    assert.ok(!source.includes(write),
      `opening Transits must not ${write} — it would create history records`);
  }
  assert.match(source, /await get\(/, "it reads and nothing more");
});

// ── Symbol Atlas data ───────────────────────────────────────────────────────

test("every symbol has a glyph, a readable name, and a meaning", () => {
  assert.ok(ORBIT_SYMBOLS.length >= 30, "the atlas should cover the app's symbols");
  for (const s of ORBIT_SYMBOLS) {
    assert.ok(s.glyph && String(s.glyph).trim(), `${s.slug} has no glyph`);
    assert.ok(s.name && String(s.name).trim(), `${s.slug} has no readable name`);
    assert.ok(s.interpretation && s.interpretation.length > 30, `${s.slug} has no real meaning`);
    assert.ok(s.slug && s.kind, `${s.name} is missing slug or kind`);
  }
});

test("slugs are unique, so cross-links cannot collide", () => {
  const slugs = ORBIT_SYMBOLS.map((s) => s.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

test("the atlas covers the categories Orbit actually displays", () => {
  const kinds = new Set(ORBIT_SYMBOLS.map((s) => s.kind));
  for (const kind of ["zodiac_sign", "planet", "angle", "aspect", "house", "moon", "other"]) {
    assert.ok(kinds.has(kind), `no ${kind} entries — Orbit displays these`);
  }
});

test("every filter button maps to entries that exist", () => {
  // A category with nothing behind it is a dead end.
  // matchAll requires a global regex; without /g it throws rather than failing
  // the assertion, which looks like a product bug and is not one.
  // Dev Update 1.12 replaced the filter tabs with category pages; the seven
  // categories and their entry counts are validated in
  // test/symbol-atlas-content.test.js. What must remain true HERE is that the
  // atlas panel still exists for transit links to land on.
  assert.ok(html.includes('id="panel-symbol-atlas"'));
});

// ── Symbol Atlas behaviour ──────────────────────────────────────────────────

test("search is trimmed, case-insensitive, and covers meaning as well as name", async () => {
  // Dev Update 1.12: search moved into the validated content module, with a
  // documented ranking. Behaviour is proven functionally rather than by
  // grepping the source of a function that no longer exists.
  const { searchAtlas } = await import("../lib/symbol-atlas/index.js");
  assert.equal(searchAtlas("  MOON  ")[0]?.entry.slug, "moon");
  assert.equal(searchAtlas("EMOTION")[0]?.entry.slug, "moon", "keywords remain searchable");
  assert.ok(searchAtlas("friction").some((r) => r.entry.slug === "square"),
    "meaning (summaries) remains searchable");
});

test("search never leaves the browser", () => {
  const start = appJs.indexOf("/* ── Symbol Atlas (Dev Update 1.12)");
  const end = appJs.indexOf("/* ── Feature flags");
  const source = appJs.slice(start, end);
  assert.ok(!source.includes("fetch("), "search runs over the static content module");
});

test("an unknown category matches nothing rather than throwing", async () => {
  const { atlasEntry, categoryEntries, searchAtlas } = await import("../lib/symbol-atlas/index.js");
  assert.equal(atlasEntry("nonsense", "moon"), null);
  assert.deepEqual(categoryEntries("nonsense"), []);
  assert.deepEqual(searchAtlas("qqqq"), []);
});

test("glyphs are decorative in the accessibility tree, names are not", () => {
  // The glyph is hidden and the title carries the meaning, so a failed font or
  // a screen reader still conveys the symbol. (1.12 class names.)
  assert.match(appJs, /class="atlas-card__glyph" aria-hidden="true"/);
  assert.match(appJs, /class="atlas-card__title">\$\{esc\(entry\.title\)\}/);
});

test("the atlas states how each symbol functions in a chart", () => {
  // 1.12 upgraded "Seen in Orbit Axis" to a full chart-role section on every
  // entry, validated as required content in symbol-atlas-content.test.js.
  assert.match(appJs, /atlas-role-title">In a chart<\/h2>/);
});

// ── Cross-linking ───────────────────────────────────────────────────────────

test("Sky points at the Atlas for the symbols it uses", () => {
  const sky = html.slice(html.indexOf('id="panel-transits"'), html.indexOf('id="panel-positions"'));
  assert.match(sky, /href="#symbol-atlas"[\s\S]{0,160}What these symbols mean/,
    "a reader who meets a glyph they do not know needs one tap to the answer");
});

test("the Atlas needs no way back, because it is a destination now", () => {
  // It used to carry an explicit "Back to Tools" button: it was reached from a
  // directory page, and a back action that skips the page you came from is a
  // dead end wearing an arrow.
  //
  // The Atlas is a primary tab now. Every other destination is one tap away in
  // the bar that is always on screen, so a bespoke back button would be a
  // second navigation that can disagree with the first — and it would point at
  // a page that no longer exists.
  const atlas = html.slice(html.indexOf('id="panel-symbol-atlas"'), html.indexOf('id="panel-me"'));
  assert.ok(!atlas.includes('data-goto="tools"'), "it must not point at the retired Tools page");
  assert.ok(!/Back to/i.test(atlas), "and it needs no bespoke back action at all");
  // What it does need is its own breadcrumb, because the Atlas has depth.
  assert.match(atlas, /id="atlas-crumbs"/, "nested atlas routes state where they are");
});

// ── Update 5.2a must survive ────────────────────────────────────────────────

test("the 5.2a redesign is untouched", () => {
  assert.ok(appJs.includes("axisFortuneCards"), "fortune cards remain");
  assert.ok(!appJs.includes("fortune-carousel"), "the carousel stays gone");
  assert.ok(!html.includes('data-level="Simple"'), "the mode switch stays gone");
  assert.match(appJs, /return "advanced"/, "one complete experience remains");
});

// ── Boot-critical DOM contract ──────────────────────────────────────────────
//
// Update 5.2b replaced the old transits panel body, which orphaned
// renderTransitTiles(): it still wrote to #transit-tiles unconditionally, threw
// at boot, and aborted refreshData() before wireTools() ran. Every [data-goto]
// button in the app silently stopped navigating.
//
// Nothing in the suite caught it, because every test read source text rather
// than booting the app. This asserts the contract that actually broke: a
// renderer refreshData() calls unconditionally may only touch elements that
// really exist in the shipped markup.

function bodyOf(source, fnName) {
  const start = source.indexOf(`function ${fnName}(`);
  if (start === -1) return null;
  let i = source.indexOf("{", start), depth = 0;
  for (let j = i; j < source.length; j += 1) {
    if (source[j] === "{") depth += 1;
    else if (source[j] === "}") { depth -= 1; if (depth === 0) return source.slice(i, j + 1); }
  }
  return null;
}

test("every renderer refreshData() calls writes only to elements that exist", () => {
  const refresh = bodyOf(appJs, "refreshData");
  assert.ok(refresh, "refreshData should be findable");

  // Renderers invoked unconditionally — not inside an if, not optional-chained.
  const called = [...refresh.matchAll(/^\s+(render[A-Za-z]+)\(/gm)].map((m) => m[1]);
  assert.ok(called.length >= 1, `expected at least one unconditional renderer, saw ${called.join(", ")}`);

  const declaredIds = new Set([
    ...[...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]),
    ...[...appJs.matchAll(/id="([^"]+)"/g)].map((m) => m[1]),   // ids app.js injects itself
  ]);

  for (const fn of called) {
    const body = bodyOf(appJs, fn);
    if (!body) continue;
    // Unguarded access only: $("#x"). — an optional-chained $("#x")?. is safe.
    for (const [, id] of body.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)\./g)) {
      assert.ok(declaredIds.has(id),
        `${fn}() writes to #${id}, which is not in the shipped markup — this throws at boot ` +
        `and aborts refreshData() before wireTools(), breaking every [data-goto] button`);
    }
  }
});

test("the back actions on both new pages have a handler, not just an attribute", () => {
  // Asserting the attribute exists was not enough: the buttons carried
  // data-goto="home" while the delegating listener never ran.
  assert.match(appJs, /\$\$\("\[data-goto\]"\)\.forEach/,
    "a [data-goto] listener must be installed");
  for (const panel of ["panel-transits", "panel-symbol-atlas"]) {
    assert.ok(html.includes(`id="${panel}"`), `${panel} should exist`);
  }
  assert.ok(!appJs.includes("renderTransitTiles"),
    "the orphaned renderer must stay removed");
});

test("a refresh on a secondary route re-renders once its data arrives", () => {
  // renderRoute() runs during boot, before restoreSession() resolves and before
  // the fortune loads. Without a second pass, refreshing on #transits showed
  // "Sign in to see transits" to an already-signed-in user, permanently.
  assert.match(appJs, /function refreshSecondaryRoute\(\)/,
    "a re-render hook must exist for the secondary destinations");

  const body = (() => {
    const start = appJs.indexOf("function refreshSecondaryRoute()");
    return appJs.slice(start, appJs.indexOf("\n}", start));
  })();
  assert.match(body, /id === "transits"/, "transits must be re-rendered");
  assert.match(body, /id === "symbol-atlas"/, "the atlas must be re-rendered");

  // It has to actually be called after the async data lands, not merely defined.
  const calls = appJs.split("refreshSecondaryRoute()").length - 1;
  assert.ok(calls >= 4,
    `refreshSecondaryRoute must be invoked after session restore and after each ` +
    `fortune assignment (definition + >=3 calls); found ${calls} occurrences`);

  const afterRestore = appJs.slice(appJs.indexOf("await restoreSession(early.session);"));
  assert.match(afterRestore.slice(0, 120), /refreshSecondaryRoute\(\)/,
    "the session path must re-render, since auth decides the empty state");
});

test("the back actions meet the 44px touch target", () => {
  // Missed in 5.2b: the filters and sky actions got 44px, the back buttons did
  // not, and they rendered at 38px on the public site.
  const css = readFileSync(join(ROOT, "public", "styles", "features.css"), "utf8");
  assert.match(css, /#panel-transits \[data-goto\], #panel-symbol-atlas \[data-goto\] \{[^}]*min-height:\s*44px/,
    "both back actions need an explicit 44px minimum");
});
