// Orbit Axis :: Dev Update 1.7 — Current Positions.
//
// The load-bearing test here is the station one. It runs a full year of real
// engine output and checks that the threshold identifies actual stations rather
// than merely producing plausible-looking labels.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  composePositions, composeSkySummary, movementState, normalizedSpeed,
  formatDegree, degreesLeftInSign, calculationDetails,
  MEAN_DAILY_MOTION, STATION_THRESHOLD, PLANET_ORDER,
  INGRESS_SUPPORTED, INGRESS_UNAVAILABLE_REASON, BOUNDARY_DEGREES,
} from "../lib/positions/positions.js";
import { currentSky } from "../lib/astro/current-sky.js";

// Shaped from a real GET /api/sky/current response.
const p = (name, sign, degrees, minutes, speed, retrograde) =>
  ({ name, sign, degrees, minutes, seconds: 0, speed, retrograde, longitude: 0 });

const SKY = Object.freeze({
  local_date: "2026-07-31", timezone_name: "America/Chicago",
  planets: {
    Sun: p("Sun", "Leo", 8, 27, 0.956225, false),
    Moon: p("Moon", "Pisces", 3, 13, 12.573833, false),
    Mercury: p("Mercury", "Cancer", 19, 20, 0.778825, false),
    Venus: p("Venus", "Virgo", 1, 5, 1.039077, false),
    Mars: p("Mars", "Gemini", 28, 40, 0.675940, false),
    Jupiter: p("Jupiter", "Leo", 12, 2, 0.221392, false),
    Saturn: p("Saturn", "Aries", 4, 9, -0.008436, true),
    Uranus: p("Uranus", "Gemini", 2, 30, 0.032711, false),
    Neptune: p("Neptune", "Aries", 3, 1, -0.012596, true),
    Pluto: p("Pluto", "Aquarius", 2, 44, -0.023366, true),
  },
});

// ── The threshold, checked against real ephemeris ───────────────────────────

test("the station threshold identifies real stations, not plausible-looking ones", () => {
  // A station is speed crossing zero. Mercury alone stations six times a year,
  // so a year of samples contains plenty of ground truth to check against.
  const bodies = ["Mercury", "Venus", "Saturn"];
  const series = Object.fromEntries(bodies.map((b) => [b, []]));
  for (let d = 0; d < 365; d += 1) {
    const t = new Date(Date.UTC(2026, 0, 1));
    t.setUTCDate(t.getUTCDate() + d);
    let sky;
    try { sky = currentSky(t); } catch { continue; }
    for (const b of bodies) {
      const body = sky.planets[b];
      if (body && Number.isFinite(body.speed)) series[b].push({ d, speed: body.speed });
    }
  }
  let totalFlagged = 0, totalTrue = 0, falsePositives = 0, stationsFound = 0;
  for (const b of bodies) {
    const arr = series[b];
    assert.ok(arr.length > 300, `${b} produced too few samples to judge`);
    const stationIdx = [];
    for (let i = 1; i < arr.length; i += 1) {
      if (Math.sign(arr[i].speed) !== Math.sign(arr[i - 1].speed)) stationIdx.push(i);
    }
    stationsFound += stationIdx.length;
    arr.forEach((x, i) => {
      if (normalizedSpeed(b, x.speed) >= STATION_THRESHOLD) return;
      totalFlagged += 1;
      if (stationIdx.some((j) => Math.abs(j - i) <= 7)) totalTrue += 1;
      else falsePositives += 1;
    });
  }
  assert.ok(stationsFound >= 6, `expected several real stations in a year, found ${stationsFound}`);
  assert.ok(totalFlagged > 0, "the threshold must actually fire");
  assert.equal(falsePositives, 0,
    `every flagged day must be within 7 days of a real station; ${falsePositives} of ${totalFlagged} were not`);
  assert.equal(totalTrue, totalFlagged);
});

test("speed is judged against each body's own motion, never one global number", () => {
  // The Moon covers ~13°/day and Pluto ~0.018°. A shared threshold would call
  // Pluto slow every day of its existence and the Moon slow on none of them.
  assert.ok(MEAN_DAILY_MOTION.Moon / MEAN_DAILY_MOTION.Pluto > 500,
    "the spread between bodies is why normalisation exists");

  // The same absolute number means opposite things for two bodies. 0.018°/day
  // is Pluto travelling normally and the Moon very nearly stopped.
  const SAME = 0.0178;
  assert.equal(movementState("Pluto", p("Pluto", "Aquarius", 2, 44, -SAME, true)).label,
    "Moving at its usual pace");
  assert.equal(movementState("Moon", p("Moon", "Pisces", 3, 13, SAME, false)).nearStation, true);

  const src = readFileSync(new URL("../lib/positions/positions.js", import.meta.url), "utf8");
  assert.ok(src.includes("normalizedSpeed"), "normalisation is the mechanism");
});

test("the motion reference is apparent, not orbital — outer planets proved it", () => {
  // Written first from orbital period, which is the wrong reference: an outer
  // planet's apparent speed is dominated by Earth's motion, so Neptune and
  // Pluto read "Moving quickly" on every retrograde day. Orbital means were low
  // by 3-4.5x for exactly those bodies.
  const ORBITAL = { Jupiter: 0.0831, Saturn: 0.0334, Uranus: 0.0117, Neptune: 0.0060, Pluto: 0.0040 };
  for (const [body, orbital] of Object.entries(ORBITAL)) {
    const ratio = MEAN_DAILY_MOTION[body] / orbital;
    assert.ok(ratio > 1.5,
      `${body}'s apparent motion must exceed its orbital motion (got ${ratio.toFixed(1)}x)`);
  }
  // Inner bodies are barely affected, which is why the bug hid for so long.
  assert.ok(Math.abs(MEAN_DAILY_MOTION.Sun - 0.9856) < 0.01);
  assert.ok(Math.abs(MEAN_DAILY_MOTION.Moon - 13.18) < 0.05);

  // The regression itself: a retrograde outer planet at its typical retrograde
  // speed must not be called quick.
  const neptune = movementState("Neptune", p("Neptune", "Aries", 3, 1, -0.0126, true));
  assert.equal(neptune.label, "Moving slowly");
  assert.notEqual(neptune.label, "Moving quickly");
});

test("movement labels are marked as derived, never presented as reported facts", () => {
  for (const name of PLANET_ORDER) {
    const m = movementState(name, SKY.planets[name]);
    if (m) assert.equal(m.derived, true, `${name} movement must be flagged derived`);
  }
});

test("movement direction always agrees with the retrograde flag", () => {
  for (const pos of composePositions(SKY)) {
    if (!pos.movement) continue;
    assert.equal(pos.movement.direction, pos.retrograde ? "Retrograde" : "Direct");
    assert.equal(pos.direction, pos.movement.direction);
  }
});

test("a missing or malformed speed degrades to no movement rather than a guess", () => {
  assert.equal(movementState("Mercury", { sign: "Leo" }), null);
  assert.equal(movementState("Mercury", { sign: "Leo", speed: null }), null);
  assert.equal(movementState("Nibiru", { sign: "Leo", speed: 1 }), null, "unknown body has no mean motion");
  const noSpeed = { ...SKY, planets: { ...SKY.planets, Mars: { ...SKY.planets.Mars, speed: undefined } } };
  const mars = composePositions(noSpeed).find((x) => x.name === "Mars");
  assert.equal(mars.movement, null);
  assert.equal(mars.direction, "Direct", "direction still comes from the retrograde flag");
});

// ── Positions ───────────────────────────────────────────────────────────────

test("all ten supported bodies render in astronomical order, and nothing else", () => {
  const out = composePositions(SKY);
  assert.deepEqual(out.map((x) => x.name), [
    "Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto",
  ]);
  // Bodies outside product scope are not silently adopted.
  const extra = { ...SKY, planets: { ...SKY.planets, Chiron: p("Chiron", "Aries", 1, 0, 0.05, false) } };
  assert.equal(composePositions(extra).length, 10, "Chiron is out of scope and must be omitted");
});

test("degrees are formatted for reading, never as raw longitude", () => {
  assert.equal(formatDegree(SKY.planets.Mercury), "19° 20′ Cancer");
  assert.equal(formatDegree({ sign: "Leo", degrees: 8, minutes: 5 }), "8° 05′ Leo");
  assert.equal(formatDegree(null), "");
  const src = readFileSync(new URL("../lib/positions/positions.js", import.meta.url), "utf8");
  assert.ok(!/position:\s*body\.longitude/.test(src), "longitude is never the displayed position");
});

test("planet roles reuse the interpretation corpus rather than starting a second one", () => {
  const out = composePositions(SKY);
  for (const pos of out) assert.ok(pos.role, `${pos.name} has no role`);
  const src = readFileSync(new URL("../lib/positions/positions.js", import.meta.url), "utf8");
  assert.match(src, /from "\.\.\/interpretation\/planets\.js"/,
    "roles must come from the existing corpus");
  // The exact same wording My Chart uses.
  const planets = readFileSync(new URL("../lib/interpretation/planets.js", import.meta.url), "utf8");
  assert.ok(planets.includes(out.find((x) => x.name === "Mercury").role));
});

test("sign-boundary flagging is factual, thresholded, and skips retrograde bodies", () => {
  assert.equal(BOUNDARY_DEGREES, 2);
  assert.ok(Math.abs(degreesLeftInSign({ degrees: 28, minutes: 40 }) - 1.333) < 0.01);
  const out = composePositions(SKY);
  const mars = out.find((x) => x.name === "Mars");           // 28°40′, direct
  assert.equal(mars.approachingBoundary, true);
  const sun = out.find((x) => x.name === "Sun");             // 8°27′
  assert.equal(sun.approachingBoundary, false);
  // A retrograde body at 29° is moving AWAY from the boundary, not toward it.
  const retroEdge = { ...SKY, planets: { ...SKY.planets, Saturn: p("Saturn", "Aries", 29, 0, -0.008, true) } };
  assert.equal(composePositions(retroEdge).find((x) => x.name === "Saturn").approachingBoundary, false);
});

// ── Summary ─────────────────────────────────────────────────────────────────

test("the summary counts what is there and says so plainly when nothing is", () => {
  const s = composeSkySummary(SKY);
  assert.equal(s.count, 10);
  assert.deepEqual(s.retrograde, ["Saturn", "Neptune", "Pluto"]);
  assert.match(s.retrogradeLabel, /3 planets are retrograde/);
  const none = { ...SKY, planets: Object.fromEntries(
    Object.entries(SKY.planets).map(([k, v]) => [k, { ...v, retrograde: false, speed: Math.abs(v.speed) }])) };
  assert.equal(composeSkySummary(none).retrogradeLabel, "No planets are currently retrograde.");
  assert.match(composeSkySummary(none).nearStationLabel, /No planets are close to changing direction/);
  assert.equal(composeSkySummary({}), null);
  assert.equal(composeSkySummary(null), null);
});

// ── What is deliberately absent ─────────────────────────────────────────────

test("upcoming sign changes are not offered, and the reason is stated", () => {
  // The payload carries no ingress timing. Extrapolating from current speed is
  // wrong precisely for the bodies people care about: one slowing to a station
  // never reaches the boundary a straight line promises.
  assert.equal(INGRESS_SUPPORTED, false);
  assert.match(INGRESS_UNAVAILABLE_REASON, /doesn’t guess/);
  const src = readFileSync(new URL("../lib/positions/positions.js", import.meta.url), "utf8");
  for (const banned of ["nextIngress", "ingressDate", "enters", "daysUntilSign"]) {
    assert.ok(!src.includes(banned), `${banned} would be an extrapolated guess`);
  }
});

test("no unsupported calculation claim is made", () => {
  const rows = calculationDetails(SKY);
  const text = JSON.stringify(rows);
  // The payload states none of these, so Positions states none of them.
  for (const claim of ["Tropical", "Sidereal", "Geocentric", "Placidus", "house"]) {
    assert.ok(!text.includes(claim), `"${claim}" is not stated by the canonical sky`);
  }
  assert.ok(rows.some((r) => r.label === "Speed units" && r.value === "Degrees per day"));
  assert.ok(rows.some((r) => /Derived/.test(r.value)), "derived labels are disclosed");
});

test("internal plumbing never reaches the reader", () => {
  const noisy = { ...SKY, snapshot_hash: "d8f096c8", context_version: "v1",
                  source: { engine_version: "0.1.0", ephemeris: "swisseph-2.10.03" } };
  const text = JSON.stringify([composePositions(noisy), composeSkySummary(noisy), calculationDetails(noisy)]);
  for (const leak of ["d8f096c8", "engine_version", "swisseph", "context_version", "snapshot"]) {
    assert.ok(!text.includes(leak), `${leak} must not surface`);
  }
});

test("positions are deterministic and free of clock, randomness, and network", () => {
  const once = JSON.stringify(composePositions(SKY));
  for (let i = 0; i < 20; i += 1) assert.equal(JSON.stringify(composePositions(SKY)), once);
  const src = readFileSync(new URL("../lib/positions/positions.js", import.meta.url), "utf8");
  for (const banned of ["Math.random", "Date.now(", "new Date(", "fetch(", "import("]) {
    assert.ok(!src.includes(banned), `${banned} would break determinism`);
  }
  for (const ai of ["openai", "anthropic", "ollama", "gpt-", "claude-"]) {
    assert.ok(!src.toLowerCase().includes(ai), `${ai} must never appear here`);
  }
});

test("Positions agrees with the sky it was given", () => {
  const out = composePositions(SKY);
  assert.equal(out.find((x) => x.name === "Sun").sign, SKY.planets.Sun.sign);
  assert.equal(out.find((x) => x.name === "Moon").sign, SKY.planets.Moon.sign);
  assert.equal(composeSkySummary(SKY).retrograde.length,
    Object.values(SKY.planets).filter((b) => b.retrograde).length,
    "the retrograde count must match the payload Home also reads");
});

// ── Route and workspace ─────────────────────────────────────────────────────

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = readFileSync(join(ROOT, "public", "index.html"), "utf8");
const APP = readFileSync(join(ROOT, "public", "app.js"), "utf8");

test("#positions is registered as a secondary route, not a sixth tab", () => {
  const registry = APP.slice(APP.indexOf("const WORKSPACES"), APP.indexOf("const RETIRED_ROUTES"));
  assert.match(registry, /id: "positions"[^}]*primary: false/,
    "Positions is a real workspace but does not earn a bottom-bar slot");
  // The five primary destinations are untouched.
  const primary = [...registry.matchAll(/id: "([a-z-]+)"[^}]*primary: true/g)].map((m) => m[1]);
  assert.deepEqual(primary, ["home", "me", "transits", "symbol-atlas", "more"]);
  // Positions now lights the Sky tab it lives under, rather than lighting
  // nothing — arriving somewhere and being told you are nowhere is worse than
  // not having a tab at all.
  assert.match(registry, /id: "positions"[^}]*tab: "transits"/);
  assert.ok(HTML.includes('id="panel-positions"'), "the panel markup ships");
  assert.match(APP, /if \(id === "positions"\)/, "and the route loads it");
});

test("the workspace follows its stated hierarchy", () => {
  // `positions-general` was a whole card whose content was one sentence
  // ("This is the sky everyone shares") and one button to Transits. Both now sit
  // where they are seen without scrolling: the sentence is the page subtitle,
  // and the way to Transits is the segmented control at the top. The next test
  // checks that neither meaning was lost in the move.
  const order = ["positions-title", "positions-time",
                 "positions-summary", "positions-list", "positions-calc"];
  const at = order.map((id) => {
    const i = HTML.indexOf(`id="${id}"`);
    assert.ok(i > -1, `${id} is missing`);
    return i;
  });
  for (let i = 1; i < at.length; i += 1) {
    assert.ok(at[i] > at[i - 1], `${order[i]} must follow ${order[i - 1]}`);
  }
  assert.equal((HTML.match(/id="positions-title"/g) || []).length, 1);
});

test("Positions states that it is the shared sky, and points to Transits for the personal one", () => {
  const panel = HTML.slice(HTML.indexOf('id="panel-positions"'), HTML.indexOf('id="panel-symbol-atlas"'));
  // The distinction between "the sky" and "the sky as it meets YOUR chart" is
  // the entire reason this page is separate from Transits, so it has to be
  // stated above the fold rather than in a card someone scrolls past.
  assert.match(panel, /These positions are the same for everyone/,
    "the page must say whose sky this is");
  assert.match(panel, /Everyone's sky<\/h1>/, "and its heading must say it too");
  // And the way to the personal reading is the segmented control, which is
  // visible without scrolling and works as a link.
  assert.match(panel, /<a href="#transits">Your sky<\/a>/,
    "the segmented control is the route to the personal reading");
  assert.match(panel, /href="#transits"[\s\S]{0,160}How this sky meets your chart/,
    "and the relationship is spelled out in words at the end of the page");
});

test("the browser formats positions but never recalculates them", () => {
  const start = APP.indexOf("function renderPositions(");
  const src = APP.slice(start, APP.indexOf("\nfunction wirePositions"));
  for (const b of ["longitude", "Math.atan", "julian", "ephemeris", "MEAN_DAILY_MOTION"]) {
    assert.ok(!src.includes(b), `${b} would mean the client is doing astronomy`);
  }
  assert.match(APP, /payload\?\.positions \|\| \[\]/, "positions arrive composed");
});

test("direction is always a word, never the absence of a symbol", () => {
  assert.match(APP, /positions-row__direction/);
  assert.match(APP, /esc\(p\.direction\)/, "the direction string is rendered as text");
  const css = readFileSync(join(ROOT, "public", "styles", "features.css"), "utf8");
  assert.match(css, /Retrograde is carried by the word/, "colour is not the state");
  assert.match(css, /forced-colors: active[\s\S]{0,200}positions-row__direction/);
});

test("refresh cannot double-fire and never blanks good data on failure", () => {
  const fn = APP.slice(APP.indexOf("async function loadPositions"), APP.indexOf("function positionsRenderSkeleton"));
  assert.match(fn, /if \(POSITIONS\.loading\) return;/, "a second click is ignored while in flight");
  assert.match(fn, /btn\.disabled = true/);
  assert.match(fn, /stage: "render"/, "a render defect is not reported as a network problem");
  const err = APP.slice(APP.indexOf("function positionsRenderError"), APP.indexOf("function renderPositions"));
  assert.match(err, /POSITIONS\.data \? /, "existing positions survive a failed refresh");
  // Code only: the fix for the Dev Update 1.5 defect is explained in a comment
  // that quotes the very pattern it removed.
  const codeOnly = APP.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
  assert.ok(!codeOnly.includes("catch {}"), "no silent catch");
});

test("Positions makes no birth-time claim of any kind", () => {
  const panel = HTML.slice(HTML.indexOf('id="panel-positions"'), HTML.indexOf('id="panel-symbol-atlas"'));
  for (const claim of ["Rising", "Ascendant", "Midheaven", "house", "birth time", "unknown time"]) {
    assert.ok(!panel.includes(claim), `"${claim}" has nothing to do with the shared sky`);
  }
  const start = APP.indexOf("function renderPositions(");
  const src = APP.slice(start, APP.indexOf("\nfunction wirePositions"));
  for (const claim of ["Rising", "Ascendant", "Midheaven", "time_accuracy", "time_known"]) {
    assert.ok(!src.includes(claim), `${claim} must not gate current-sky rendering`);
  }
});

test("Positions links only to destinations that exist and are named truthfully", () => {
  const panel = HTML.slice(HTML.indexOf('id="panel-positions"'), HTML.indexOf('id="panel-symbol-atlas"'));
  const registry = APP.slice(APP.indexOf("const WORKSPACES"), APP.indexOf("const RETIRED_ROUTES"));
  const registered = [...registry.matchAll(/id: "([a-z-]+)"/g)].map((m) => m[1]);
  const links = [...panel.matchAll(/href="#([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(links.length >= 3, `expected the exits, saw ${links.join(", ")}`);
  for (const l of links) assert.ok(registered.includes(l), `#${l} is not a workspace`);
  // The page DOES link to itself now, once: the segmented control has to show
  // both views, and the current one is marked aria-current rather than removed.
  // Anything beyond that self-link would be a link to where you already are.
  const self = [...panel.matchAll(/href="#positions"/g)];
  assert.equal(self.length, 1, "only the segmented control may point at this page");
  assert.match(panel, /href="#positions" aria-current="page"/,
    "and it must be marked as the current view rather than looking like an exit");
  assert.match(panel, /href="#symbol-atlas"[\s\S]{0,160}What every symbol means/,
    "the Atlas exit says what it is for");
});

test("Positions loads on arrival, like every other secondary destination", () => {
  // refreshSecondaryRoute only runs on data refreshes; arriving at a route is
  // handled by renderRoute. Registering in the wrong one gives a workspace that
  // renders its heading and nothing else until something else happens to
  // refresh — which is exactly what happened the first time.
  const rr = APP.slice(APP.indexOf("function renderRoute()"), APP.indexOf("const ws = WORKSPACES.find"));
  const block = rr.slice(rr.indexOf('if (id === "positions")'));
  assert.match(block, /loadPositions\(\)/, "Positions must load from renderRoute, on arrival");
  assert.match(block, /wirePositions\(\)/);
  assert.match(rr, /if \(id === "symbol-atlas"\)/, "alongside the other secondary destinations");
});

test("every Positions control meets the 44px guidance", () => {
  const css = readFileSync(join(ROOT, "public", "styles", "orbit-axis.css"), "utf8");
  assert.match(css, /#panel-positions button[\s\S]{0,140}min-height: 44px/,
    "the sizing rule must name the Positions panel, not just Home");
  assert.match(css, /#panel-positions \.o-btn/, "including the link-styled buttons");
});

// ── Signed-out gating (Dev Update 1.7 correction) ───────────────────────────

test("Positions never renders behind the sign-in gate", () => {
  // It first did. The route loaded on arrival regardless of auth, so a
  // signed-out visitor got a heading, a ten-row planetary list, a live region
  // and a refresh control sitting under the modal. `aria-modal` on the gate is
  // not a licence to build that.
  const fn = APP.slice(APP.indexOf("async function loadPositions"), APP.indexOf("function clearPositions"));
  assert.match(fn, /state\.auth\.restoring \|\| !authSignedIn\(\)/,
    "the load must wait for session resolution and require a signed-in user");
  assert.match(fn, /\{ clearPositions\(\); return; \}/,
    "and clear rather than leave whatever was there");
  // The guard precedes the request.
  const guardAt = fn.indexOf("authSignedIn()");
  const fetchAt = fn.indexOf("/api/sky/current");
  assert.ok(guardAt > -1 && guardAt < fetchAt,
    "no private-shell request may be made before authentication resolves");
});

test("clearing empties every rendered Positions region", () => {
  const fn = APP.slice(APP.indexOf("function clearPositions"), APP.indexOf("function positionsRenderSkeleton"));
  for (const region of ["#positions-summary-body", "#positions-list-body",
                        "#positions-calc-body", "#positions-time", "#positions-status"]) {
    assert.ok(fn.includes(region), `${region} must be cleared`);
  }
  assert.match(fn, /POSITIONS\.data = null/, "cached data is dropped too");
});

test("signing out clears the workspace with the rest of the private state", () => {
  const fn = APP.slice(APP.indexOf("function clearPrivateState"), APP.indexOf("function clearPrivateState") + 700);
  assert.match(fn, /clearPositions\(\)/,
    "Positions must not survive a sign-out in the DOM or the accessibility tree");
});

test("arriving at Positions moves focus to its heading", () => {
  const rr = APP.slice(APP.indexOf("function renderRoute()"), APP.indexOf("const ws = WORKSPACES.find"));
  assert.match(rr, /#positions-title"\)\?\.focus/, "focus moves to the workspace heading");
  assert.match(HTML, /id="positions-title" tabindex="-1"/, "which is focusable for that purpose");
});

test("Positions stays authenticated — this update does not move the public boundary", () => {
  // Making #positions public would change authentication, navigation, indexing,
  // rate limiting and free-tier design. None of that belongs to Dev Update 1.7.
  const registry = APP.slice(APP.indexOf("const WORKSPACES"), APP.indexOf("const RETIRED_ROUTES"));
  assert.match(registry, /id: "positions"/);
  // Checked against code, not the comment that explains the decision.
  const fn = APP.slice(APP.indexOf("async function loadPositions"), APP.indexOf("function clearPositions"));
  const codeOnly = fn.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const bypass of ["allowAnonymous", "skipAuth", "publicRoute", "requireAuth = false"]) {
    assert.ok(!codeOnly.includes(bypass), `${bypass} would move the public boundary`);
  }
  assert.match(codeOnly, /!authSignedIn\(\)/, "the workspace remains authenticated");
});

test("the signed-out workspace renders nothing and cannot take focus", () => {
  // Two mechanisms, both verified in a browser.
  //
  // 1. loadPositions refuses to run before the session resolves, so no rows,
  //    no summary and no timestamp are ever built.
  const fn = APP.slice(APP.indexOf("async function loadPositions"), APP.indexOf("function clearPositions"));
  assert.match(fn, /state\.auth\.restoring \|\| !authSignedIn\(\)/);

  // 2. The gate is a focus-trapping aria-modal dialog AND openModal already
  //    marks `.app-shell` inert and aria-hidden — which contains every
  //    workspace, Positions included. A per-panel `inert` was tried and
  //    removed once this was found: it was redundant, and shipping it would
  //    have meant a test passing on code that did nothing.
  assert.match(HTML, /id="auth-gate"[\s\S]{0,120}aria-modal="true"/);
  const inertFn = APP.slice(APP.indexOf("function setBackgroundInert"), APP.indexOf("function setBackgroundInert") + 400);
  assert.match(inertFn, /setAttribute\("inert", ""\)/);
  assert.match(inertFn, /setAttribute\("aria-hidden", "true"\)/);
  assert.match(APP.slice(APP.indexOf("function backgroundRegions"), APP.indexOf("function setBackgroundInert")),
    /\$\$\("\.app-shell"\)/, "the shell containing every workspace is what goes inert");

  // No per-panel duplicate of that mechanism ships.
  const posCode = APP.slice(APP.indexOf("const POSITIONS = {"));
  assert.ok(!posCode.includes('setAttribute("inert"'), "Positions does not re-implement it");
});

// ── Session lifecycle (three states, not two) ───────────────────────────────

test("session state has three meanings and the guard respects all of them", () => {
  // Unresolved is NOT signed out. Treating it as such would clear a session
  // that is about to arrive, and the app would settle on an empty workspace
  // for a signed-in user.
  assert.match(APP, /auth: \{ restoring: true, user: null \}/,
    "the app starts in the unresolved state, not the signed-out one");
  const fn = APP.slice(APP.indexOf("async function loadPositions"), APP.indexOf("function clearPositions"));
  assert.match(fn, /state\.auth\.restoring \|\| !authSignedIn\(\)/,
    "unresolved and signed-out both defer, and are reached before any request");
  const guardAt = fn.indexOf("state.auth.restoring");
  const fetchAt = fn.indexOf("/api/sky/current");
  assert.ok(guardAt > -1 && guardAt < fetchAt, "no request precedes session resolution");
});

test("deferring while unresolved cannot strand a session that arrives later", () => {
  // The boot sequence is: renderRoute (defers) -> restoreSession ->
  // refreshSecondaryRoute (loads). If that second load were skipped, a
  // signed-in user landing on #positions would see nothing for ever.
  const boot = APP.slice(APP.indexOf("  renderRoute();\n\n  try {"), APP.indexOf("  await axisInit();"));
  assert.match(boot, /await restoreSession\(\);\s*\n\s*refreshSecondaryRoute\(\);/,
    "the route is refreshed once the session resolves");
  const refresh = APP.slice(APP.indexOf("function refreshSecondaryRoute"), APP.indexOf("function renderTransits"));
  assert.match(refresh, /if \(id === "positions"\)[\s\S]{0,80}loadPositions\(\)/,
    "and that refresh reloads Positions");
  // restoreSession must not be able to throw past its own handling, or the
  // reload above would be skipped and the deferral would become permanent.
  const rs = APP.slice(APP.indexOf("async function restoreSession"), APP.indexOf("async function applySignedIn"));
  assert.match(rs, /\} catch \{/, "restoreSession handles its own failure");
  assert.match(rs, /\} finally \{/, "and always settles the restoring flag");
  assert.match(rs, /state\.auth\.restoring = false/);
});

test("signing out clears Positions and the shell isolation returns", () => {
  const clear = APP.slice(APP.indexOf("function clearPrivateState"), APP.indexOf("function clearPrivateState") + 700);
  assert.match(clear, /clearPositions\(\)/);
  // The isolation itself is the pre-existing modal mechanism, not ours.
  const bg = APP.slice(APP.indexOf("function setBackgroundInert"), APP.indexOf("function setBackgroundInert") + 400);
  assert.match(bg, /setAttribute\("inert", ""\)/);
  assert.match(bg, /setAttribute\("aria-hidden", "true"\)/);
});

test("refresh is unreachable while signed out and operable once authenticated", () => {
  // Not asserted on a disabled attribute: the control is unreachable because
  // the whole shell is inert behind the gate, which is stronger.
  const fn = APP.slice(APP.indexOf("async function loadPositions"), APP.indexOf("function clearPositions"));
  assert.match(fn, /if \(btn\) \{ btn\.disabled = true/, "and disabled while a load is in flight");
  assert.match(fn, /btn\.disabled = false/, "then re-enabled");
  assert.match(fn, /if \(POSITIONS\.loading\) return;/, "a second activation is refused");
});
