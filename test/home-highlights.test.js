// Orbit Axis :: Dev Update 1.6 — Home sky highlights.
//
// The interesting test here is the generational one. Every other assertion
// guards a rule; that one guards against a whole class of "technically correct,
// practically useless" Home page.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  rankSkyAspects, highlightRank, isGenerational, moonState,
  composeHighlights, daysUntil, HIGHLIGHT_COUNT, ASPECT_WEIGHT, HIGHLIGHT_DESTINATIONS,
} from "../lib/home/highlights.js";

// Shaped exactly like GET /api/sky/current, values taken from a real response.
const SKY = Object.freeze({
  local_date: "2026-07-31",
  zodiac_season: "Leo",
  moon: { sign: "Pisces", phase_name: "Waning Gibbous", illumination_percent: 96,
          waxing: false, degrees: 12, minutes: 4 },
  moon_phase_name: "Waning Gibbous", illumination_percent: 96, is_waxing: false,
  next_full_moon: { kind: "full_moon", local_date: "2026-08-27" },
  next_new_moon: { kind: "new_moon", local_date: "2026-08-12" },
  retrogrades: ["Saturn", "Neptune", "Pluto"],
  aspects: [
    { a: "Neptune", b: "Pluto", aspect: "Sextile", orb: 0.08 },
    { a: "Uranus", b: "Neptune", aspect: "Sextile", orb: 0.73 },
    { a: "Uranus", b: "Pluto", aspect: "Trine", orb: 0.81 },
    { a: "Venus", b: "Mars", aspect: "Square", orb: 0.85 },
    { a: "Sun", b: "Saturn", aspect: "Trine", orb: 3.4 },
    { a: "Moon", b: "Venus", aspect: "Conjunction", orb: 5.1 },
  ],
});

test("generational pairs never become daily highlights, however tight", () => {
  // Neptune sextile Pluto at 0.08° is the tightest aspect in this sky and stays
  // within a degree for years. Leading with it means Home says the same thing
  // every morning for a decade.
  assert.equal(isGenerational({ a: "Neptune", b: "Pluto", aspect: "Sextile" }), true);
  assert.equal(isGenerational({ a: "Uranus", b: "Neptune", aspect: "Sextile" }), true);
  assert.equal(isGenerational({ a: "Sun", b: "Pluto", aspect: "Square" }), false);

  const ranked = rankSkyAspects(SKY.aspects);
  for (const a of ranked) {
    assert.ok(!isGenerational(a), `${a.a} ${a.aspect} ${a.b} is generational and must be dropped`);
  }
  assert.equal(ranked.length, 3, "three of the six aspects are outer-planet pairs");
});

test("relevance beats tightness, then aspect weight breaks the tie", () => {
  const ranked = rankSkyAspects(SKY.aspects);
  assert.deepEqual(ranked.map((a) => `${a.a} ${a.aspect} ${a.b}`), [
    // Luminary + personal planet scores 5. The WIDEST aspect in this sky
    // (5.1°) leads it, which is the whole point of ranking on relevance.
    "Moon Conjunction Venus",
    // Venus+Mars and Sun+Saturn both score 4, so weight decides: a square
    // (4) is a stronger statement than a trine (2).
    "Venus Square Mars",
    "Sun Trine Saturn",
  ]);
  // Stated as a property rather than a fixture, so the rule survives new data.
  const rank = ranked.map(highlightRank);
  assert.ok(rank[0].relevance <= rank[1].relevance && rank[1].relevance <= rank[2].relevance,
    "relevance never decreases down the list");
  assert.ok(rank[1].relevance === rank[2].relevance && rank[1].weight <= rank[2].weight,
    "equal relevance is broken by aspect weight, not by orb");
  assert.ok(rank[0].orb > rank[1].orb, "and a wider aspect can still lead");
});

test("ranking is deterministic across repeated runs", () => {
  const first = JSON.stringify(rankSkyAspects(SKY.aspects));
  for (let i = 0; i < 20; i += 1) {
    assert.equal(JSON.stringify(rankSkyAspects(SKY.aspects)), first);
  }
});

test("every rank field is defined, ordered, and finally tie-broken", () => {
  const k = highlightRank({ a: "Sun", b: "Moon", aspect: "Trine", orb: 1.2 });
  assert.deepEqual(Object.keys(k), ["relevance", "weight", "orb", "pair"]);
  // A pair tie-break exists so two identical scores cannot reorder between renders.
  const a = highlightRank({ a: "Sun", b: "Mars", aspect: "Trine", orb: 2 });
  const b = highlightRank({ a: "Sun", b: "Venus", aspect: "Trine", orb: 2 });
  assert.notEqual(a.pair, b.pair);
  assert.equal(ASPECT_WEIGHT.Conjunction > ASPECT_WEIGHT.Trine, true);
});

test("malformed aspects are dropped rather than rendered half-formed", () => {
  const ranked = rankSkyAspects([null, {}, { a: "Sun" }, { a: "Sun", b: "Moon", aspect: "Trine", orb: 1 }]);
  assert.equal(ranked.length, 1);
  // A missing orb sorts last instead of throwing.
  assert.equal(highlightRank({ a: "Sun", b: "Moon", aspect: "Trine" }).orb, 99);
});

test("the Moon is read from one accessor, not the mirrored top-level fields", () => {
  const src = readFileSync(new URL("../lib/home/highlights.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export function moonState"), src.indexOf("/** Plain sentences"));
  assert.ok(fn.includes("sky?.moon"), "moonState reads sky.moon");
  for (const mirror of ["moon_phase_name", "is_waxing", "illumination_percent:"]) {
    assert.ok(!fn.includes(mirror), `moonState must not read the mirrored ${mirror}`);
  }
});

test("moon state reports phase, direction, and the soonest lunar event", () => {
  const m = moonState(SKY);
  assert.equal(m.phase, "Waning Gibbous");
  assert.equal(m.sign, "Pisces");
  assert.equal(m.illumination, 96);
  assert.equal(m.waxing, false);
  assert.equal(m.direction, "waning");
  // New Moon (Aug 12) comes before Full Moon (Aug 27), so it is the one named.
  assert.equal(m.nextEvent.kind, "New Moon");
  assert.equal(m.nextEvent.days, 12);
  assert.equal(m.nextEvent.when, "in 12 days");
});

test("waxing and waning copy follows the canonical flag, never the phase name", () => {
  assert.match(moonState(SKY).meaning, /drawing back/);
  const waxing = { ...SKY, moon: { ...SKY.moon, waxing: true, phase_name: "Waxing Crescent" } };
  assert.match(moonState(waxing).meaning, /filling out/);
  assert.equal(moonState(waxing).direction, "waxing");
});

test("a missing Moon or lunar event degrades safely instead of guessing", () => {
  assert.equal(moonState({}), null);
  assert.equal(moonState({ moon: {} }), null);
  const noEvents = { ...SKY, next_full_moon: null, next_new_moon: null };
  assert.equal(moonState(noEvents).nextEvent, null);
  assert.equal(moonState(noEvents).phase, "Waning Gibbous", "the rest still renders");
  assert.equal(daysUntil(null, "2026-07-31"), null);
  assert.equal(daysUntil("bad", "2026-07-31"), null);
});

test("today and tomorrow are named, not counted", () => {
  const soon = { ...SKY, next_new_moon: { local_date: "2026-07-31" } };
  assert.equal(moonState(soon).nextEvent.when, "today");
  const tomorrow = { ...SKY, next_new_moon: { local_date: "2026-08-01" } };
  assert.equal(moonState(tomorrow).nextEvent.when, "tomorrow");
});

test("highlights are capped, linked, and never grade the sky", () => {
  const h = composeHighlights(SKY);
  assert.ok(h.length <= 2 + HIGHLIGHT_COUNT + 1, "season + moon + aspects + retrogrades");
  assert.equal(h.filter((x) => x.kind === "aspect").length, HIGHLIGHT_COUNT);
  for (const x of h) {
    assert.ok(x.id && x.label && x.detail, `${x.kind} highlight is incomplete`);
    assert.ok(HIGHLIGHT_DESTINATIONS.includes(x.href), `${x.href} is not an allowed destination`);
    assert.doesNotMatch(x.detail, /\b(will|guarantee|must|destined|lucky day|bad day)\b/i,
      `highlight predicts or grades: "${x.detail}"`);
  }
});

test("every highlight destination is a workspace that actually exists", () => {
  // There is no Positions workspace yet — that is Dev Update 1.7. A highlight
  // linking to #positions would be a dead control shipped on the busiest page.
  const appJs = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const registry = appJs.slice(appJs.indexOf("const WORKSPACES"), appJs.indexOf("const RETIRED_ROUTES"));
  const registered = [...registry.matchAll(/id: "([a-z-]+)"/g)].map((m) => `#${m[1]}`);
  for (const href of HIGHLIGHT_DESTINATIONS) {
    assert.ok(registered.includes(href), `${href} is not a registered workspace`);
  }
  // Highlights still route to Transits and Symbol Atlas. Positions exists as of
  // Dev Update 1.7, but a sky HIGHLIGHT is an invitation to interpretation, not
  // a request for exact degrees — the degree link belongs to Technical Sky.
  assert.ok(!HIGHLIGHT_DESTINATIONS.includes("#positions"),
    "highlights lead to meaning; Technical Sky leads to degrees");
  for (const h of composeHighlights(SKY)) {
    assert.ok(registered.includes(h.href), `highlight "${h.label}" links to a dead route`);
  }
});

test("highlights compose from an empty sky without throwing", () => {
  assert.deepEqual(composeHighlights(null), []);
  assert.deepEqual(composeHighlights({}), []);
  const noAspects = composeHighlights({ zodiac_season: "Leo", aspects: [], retrogrades: [] });
  assert.equal(noAspects.length, 1, "the season still stands on its own");
});

test("nothing here is random, clock-dependent, or networked", () => {
  const src = readFileSync(new URL("../lib/home/highlights.js", import.meta.url), "utf8");
  for (const banned of ["Math.random", "Date.now(", "new Date(", "fetch(", "import("]) {
    assert.ok(!src.includes(banned), `${banned} would break Home determinism`);
  }
  for (const ai of ["openai", "anthropic", "ollama", "gpt-", "claude-"]) {
    assert.ok(!src.toLowerCase().includes(ai), `${ai} must never appear in Home composition`);
  }
});

test("internal sky plumbing is never surfaced as a highlight", () => {
  const withNoise = { ...SKY, snapshot_hash: "d8f096c8", source: { engine_version: "x" },
                      context_version: "current-sky-context-v1" };
  const text = JSON.stringify(composeHighlights(withNoise));
  for (const leak of ["d8f096c8", "engine_version", "context_version", "snapshot"]) {
    assert.ok(!text.includes(leak), `${leak} must not reach the reader`);
  }
});

// ── Dev Update 1.6 :: the Home interface ────────────────────────────────────

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = readFileSync(join(ROOT, "public", "index.html"), "utf8");
const APP = readFileSync(join(ROOT, "public", "app.js"), "utf8");

test("Today renders its hierarchy in order", () => {
  // The reading leads because it is why someone opens the app; the sky that
  // produced it follows; the technical detail is folded away near the end.
  //
  // `today-explore` is gone from this list. It was a five-item "Continue
  // exploring" card at the foot of the page, restating destinations that are
  // one tap away in the tab bar — navigation dressed as content. The week strip
  // took its place at the TOP, because "which day am I reading" is a question
  // someone has before the reading, not after it.
  const order = ["today-days", "today-fortune", "today-moon",
                 "today-highlights", "today-sky", "today-secondary"];
  const at = order.map((id) => {
    const i = HTML.indexOf(`id="${id}"`);
    assert.ok(i > -1, `${id} is missing from Home`);
    return i;
  });
  for (let i = 1; i < at.length; i += 1) {
    assert.ok(at[i] > at[i - 1], `${order[i]} must follow ${order[i - 1]}`);
  }
});

test("the visible day is the fortune's local day, never a UTC date", () => {
  assert.match(APP, /formatLocalDateKey\(sky\.local_date/, "the header date comes from local_date");
  // Scoped to the Home renderer. `getUTCDate()` also appears in birth-date
  // validation, where it exists precisely to catch impossible days like
  // 31 February — nothing to do with presenting a day to a reader.
  const start = APP.indexOf("function axisRenderSky(");
  const homeRender = APP.slice(start, APP.indexOf("\nfunction axisRenderTechnicalSky"));
  assert.ok(!/toUTCString|getUTCDate\(\)|new Date\(\)\.getDate/.test(homeRender),
    "Home must not present a UTC date as the user's day");
  assert.match(APP, /Based on \$\{sky\.timezone_name\} local time/, "and the timezone is readable");
});

test("Home composes nothing itself — highlights and Moon come from the server", () => {
  assert.match(APP, /axisRenderHighlights\(extras\.highlights/);
  assert.match(APP, /axisRenderMoon\(extras\.moon/);
  // No second ranker, no second Moon calculation in the client.
  for (const banned of ["isGenerational", "rankSkyAspects", "moon_phase_name", "phase_fraction"]) {
    assert.ok(!APP.includes(banned), `${banned} belongs to lib/home, not the browser`);
  }
});

test("the current Moon is never confused with the natal Moon", () => {
  assert.match(APP, /This is the Moon in the sky right now — not the Moon in your birth chart/);

  // Dev Update 1.6 proved the Moon was not a bare unlabelled image by pinning a
  // role="img" wrapper with an aria-label around the single disc. Dev Update
  // 1.9 replaced that disc with a scene — sky, stars, Earth — and labelling a
  // whole scene as one image would announce decoration as content. The
  // guarantee is unchanged and the mechanism inverted: the scene is hidden
  // from assistive technology, and every fact it depicts is real text.
  const fn = APP.slice(APP.indexOf("function axisRenderMoon"),
                       APP.indexOf("function moonSceneHtml"));
  assert.match(fn, /moon-state__phase/, "the phase name is visible text");
  assert.match(fn, /illuminationLabel\(moon\.illumination\)/, "illumination is visible text");
  assert.match(fn, /moon\.direction/, "waxing or waning is visible text");
  const scene = APP.slice(APP.indexOf("function moonSceneHtml"),
                          APP.indexOf("function moonSceneUnavailableHtml"));
  assert.match(scene, /aria-hidden="true"/, "the scene itself is decorative");
});

test("Technical Sky is secondary, folded, and free of internal plumbing", () => {
  const start = APP.indexOf("function axisRenderTechnicalSky(");
  const src = APP.slice(start, APP.indexOf("\nfunction ", start + 40));
  assert.ok(src.includes("<details"), "it is a disclosure, not an open panel");
  for (const leak of ["snapshot_hash", "context_version", "sky_version", "engine_version",
                      "source.", "instant_utc", "calculated_at_utc"]) {
    assert.ok(!src.includes(leak), `${leak} must never reach the reader`);
  }
});

test("no calculation claim is hardcoded in the client", () => {
  // The Dev Update 1.5 rule, applied to Home: the sky payload states no zodiac
  // system, so Home does not assert one.
  assert.ok(!APP.includes("Tropical"), "Home must not hardcode a zodiac claim");
  assert.ok(!APP.includes("Placidus"), "nor a house system");
});

test("Home links only to routes that exist, Positions included", () => {
  const registry = APP.slice(APP.indexOf("const WORKSPACES"), APP.indexOf("const RETIRED_ROUTES"));
  const registered = [...registry.matchAll(/id: "([a-z-]+)"/g)].map((m) => m[1]);
  const homeStart = HTML.indexOf('id="panel-home"');
  const homeHtml = HTML.slice(homeStart, HTML.indexOf('id="panel-transits"'));
  for (const m of homeHtml.matchAll(/href="#([a-z-]+)"/g)) {
    assert.ok(registered.includes(m[1]), `Home links to #${m[1]}, which is not a workspace`);
  }
  // Reversed by Dev Update 1.7: the route now exists, so Home may — and does —
  // link to it. The guarantee this test protects is unchanged: every Home link
  // resolves to a registered workspace.
  assert.ok(registered.includes("positions"), "Positions is registered");
  assert.ok(!/Coming Soon/i.test(homeHtml), "no placeholder destinations");
  // Today no longer carries a list of links to other pages. The tab bar is on
  // screen at all times and names all five destinations; repeating them at the
  // foot of the page was a second navigation to keep in step with the first.
  assert.ok(!homeHtml.includes('id="today-explore"'),
    "the Continue exploring link farm must not come back");
  assert.ok(!homeHtml.includes("axis-explore"), "and neither must its markup");
  // The one exit that is NOT reachable from the tab bar stays: your own past
  // readings, which is where the week strip sends you.
  assert.match(homeHtml, /id="today-secondary"[\s\S]{0,200}href="#history"/,
    "History has no tab, so Today keeps the way in");
});

test("sky and fortune fail independently, and neither failure is swallowed", () => {
  // Checked against code, not comments: the fix is explained in a comment that
  // quotes the very pattern it removed.
  const codeOnly = APP.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
  assert.ok(!codeOnly.includes(".catch(() => {})"), "the silent sky catch must stay gone");
  assert.match(APP, /axisRenderSkyError/, "the sky has its own failure state");
  assert.match(APP, /data-action="retry-sky"/, "with its own retry");
  assert.match(APP, /stage: "render"/, "a render defect is logged as a render defect");
  // The retry must not tear down the personal reading.
  const retry = APP.slice(APP.indexOf('action === "retry-sky"'), APP.indexOf('action === "retry-sky"') + 700);
  assert.ok(!retry.includes("axisLoadToday"), "retrying the sky must not reload the fortune");
});

test("Home introduces no AI provider and no randomness", () => {
  const homeSrc = readFileSync(join(ROOT, "lib", "home", "highlights.js"), "utf8");
  for (const src of [homeSrc, APP]) {
    for (const ai of ["openai", "anthropic", "ollama", "api.openai", "generativelanguage"]) {
      assert.ok(!src.toLowerCase().includes(ai), `${ai} must not appear in the Home flow`);
    }
  }
  assert.ok(!homeSrc.includes("Math.random"), "highlight composition is deterministic");
});

test("switching charts clears the reading but never the sky", () => {
  const start = APP.indexOf('select.addEventListener("change"');
  const handler = APP.slice(start, APP.indexOf("\nfunction ", start));
  const clearAt = handler.indexOf("axisClearPersonalReading()");
  const activateAt = handler.indexOf("/activate");
  assert.ok(clearAt > -1 && clearAt < activateAt,
    "the old reading is cleared before activation is requested, not after it returns");
  // Only the personal half is cleared.
  const clearFn = APP.slice(APP.indexOf("function axisClearPersonalReading"), APP.indexOf("function axisWireChartPicker"));
  assert.ok(clearFn.includes("#today-fortune"), "the fortune is cleared");
  for (const skyOnly of ["#today-moon", "#today-highlights", "#today-sky"]) {
    assert.ok(!clearFn.includes(skyOnly), `${skyOnly} describes the sky and must not flicker on a chart switch`);
  }
  assert.match(clearFn, /aria-live="polite"/, "the loading state is announced");
});

test("the reading title is never a mangled fragment of the mood text", () => {
  // "A reflective, share-what-you've-learned kind of day" once produced the
  // headline "A reflective" by cutting at the first comma.
  const fn = APP.slice(APP.indexOf("function axisFortuneTitle"), APP.indexOf("function axisRenderSky("));
  assert.ok(!fn.includes("split(/[,;—]/)"), "the title must not be cut out of the mood text");
  assert.ok(!fn.includes("F.mood"), "and must not be derived from it at all");
  assert.match(fn, /return "Your reading for today"/);
  // The mood still appears, once, in the card written for it.
  assert.match(APP, /body: F\.mood/, "the Overall card carries the mood in full");
});
