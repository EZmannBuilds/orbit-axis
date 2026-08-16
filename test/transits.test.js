// Orbit Axis :: Dev Update 1.8 — transit-to-natal calculation.
//
// The load-bearing test is the orb one. A flat orb across bodies is the single
// decision that would quietly ruin this page, and it is not visible from the
// output on any one day — only from how long a contact stays on screen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  findTransits, rankTransits, transitRank, groupTransits, summarise,
  suppressDuplicates, motionState, orbLimitFor, formatOrb, birthTimeNotice, planetRole,
  ORB_LIMITS, SPEED_CLASS, TRANSITING_BODIES, NATAL_BODIES, ASPECTS,
  EXACT_TIMING_SUPPORTED, IMMEDIATE_LIMIT, DURATION,
} from "../lib/transits/transits.js";

const body = (sign, deg, min, lon, speed = 1, retro = false) =>
  ({ sign, degrees: deg, minutes: min, longitude: lon, speed, retrograde: retro });

// Sky shaped like GET /api/sky/current; chart like a stored natal chart.
const SKY = Object.freeze({ planets: {
  Sun: body("Leo", 8, 0, 128.0, 0.956), Moon: body("Pisces", 4, 0, 334.0, 12.57),
  Mercury: body("Cancer", 19, 0, 109.0, 0.78), Venus: body("Virgo", 24, 0, 174.0, 1.04),
  Mars: body("Gemini", 23, 0, 83.0, 0.68), Jupiter: body("Leo", 7, 0, 127.0, 0.22),
  Saturn: body("Aries", 14, 0, 14.0, -0.008, true), Uranus: body("Gemini", 5, 0, 65.0, 0.03),
  Neptune: body("Aries", 4, 0, 4.0, -0.013, true), Pluto: body("Aquarius", 4, 0, 304.0, -0.023, true),
}});
const CHART = Object.freeze({ time_known: true, time_accuracy: "exact", planets: {
  Sun: body("Cancer", 23, 0, 113.0), Moon: body("Aries", 27, 0, 27.0),
  Mercury: body("Leo", 7, 0, 127.2), Venus: body("Gemini", 24, 0, 84.0),
  Mars: body("Taurus", 2, 0, 32.0), Jupiter: body("Cancer", 22, 0, 112.0),
  Saturn: body("Capricorn", 21, 0, 291.0), Uranus: body("Capricorn", 6, 0, 276.0),
  Neptune: body("Capricorn", 12, 0, 282.0), Pluto: body("Scorpio", 14, 0, 224.0),
}});

// ── The orb rule ────────────────────────────────────────────────────────────

test("orb narrows as the transiting body slows, or outer planets never leave", () => {
  // A flat 3° orb is right for the fast bodies and meaningless for the slow
  // ones. Pluto covers ~0.018°/day, so 3° of orb is roughly a YEAR on screen;
  // the Moon crosses the same 3° in about five hours. Same number, two totally
  // different features.
  const daysInOrb = (b, orb) => {
    const speed = { Moon: 13.18, Sun: 0.9856, Mars: 0.524, Saturn: 0.0717, Pluto: 0.0178 }[b];
    return (2 * orb) / speed;           // in and out again
  };
  assert.ok(daysInOrb("Pluto", 3) > 300, "a flat 3° orb would park Pluto on the page for most of a year");
  assert.ok(daysInOrb("Moon", 3) < 1, "while the Moon would come and go inside a day");

  // With the real limits the spread is far narrower.
  const withRealLimits = TRANSITING_BODIES.map((b) => orbLimitFor(b));
  assert.ok(Math.max(...withRealLimits) / Math.min(...withRealLimits) <= 3);
  assert.equal(orbLimitFor("Moon"), 3);
  assert.equal(orbLimitFor("Pluto"), 1);
  assert.ok(daysInOrb("Pluto", orbLimitFor("Pluto")) < daysInOrb("Pluto", 3) / 2);
  // Every body has an explicit limit; nothing falls through to a default.
  for (const b of TRANSITING_BODIES) assert.ok(ORB_LIMITS[b], `${b} has no documented orb`);
});

test("orb limits and speed classes agree with each other", () => {
  for (const b of TRANSITING_BODIES) {
    assert.ok(SPEED_CLASS[b], `${b} has no speed class`);
    assert.ok(DURATION[SPEED_CLASS[b]], `${SPEED_CLASS[b]} has no duration phrasing`);
  }
  // Slower class never gets a wider orb than a faster one.
  const order = { fast: 0, social: 1, background: 2 };
  for (const a of TRANSITING_BODIES) for (const b of TRANSITING_BODIES) {
    if (order[SPEED_CLASS[a]] < order[SPEED_CLASS[b]]) {
      assert.ok(orbLimitFor(a) >= orbLimitFor(b), `${a} should not have a tighter orb than ${b}`);
    }
  }
});

// ── Applying and separating ─────────────────────────────────────────────────

test("motion is a real comparison, because only one body moves", () => {
  // Natal is fixed, so projecting the transiting body forward by its own daily
  // speed and re-measuring is a genuine test — not an inference from orb or
  // from a retrograde flag.
  assert.equal(motionState(126.0, 1.0, 128.0, 0), "Applying");    // closing on a conjunction
  assert.equal(motionState(130.0, 1.0, 128.0, 0), "Separating");  // moving away
  // A retrograde body closing the gap is still applying.
  assert.equal(motionState(130.0, -1.0, 128.0, 0), "Applying");
  const src = readFileSync(new URL("../lib/transits/transits.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export function motionState"), src.indexOf("export function orbLimitFor"));
  assert.ok(!/retrograde/.test(fn), "motion must not be inferred from the retrograde flag");
});

test("motion is omitted rather than guessed when speed is missing", () => {
  assert.equal(motionState(126.0, null, 128.0, 0), null);
  assert.equal(motionState(126.0, undefined, 128.0, 0), null);
  const noSpeed = { planets: { ...SKY.planets, Mars: { ...SKY.planets.Mars, speed: null } } };
  const mars = findTransits(noSpeed, CHART).find((t) => t.transiting === "Mars");
  if (mars) assert.equal(mars.motion, null, "no placeholder is substituted");
});

// ── Calculation ─────────────────────────────────────────────────────────────

test("only the five engine-supported aspects are used, and none is invented", () => {
  assert.deepEqual(ASPECTS.map((a) => a.name).sort(),
    ["Conjunction", "Opposition", "Sextile", "Square", "Trine"]);
  const found = new Set(findTransits(SKY, CHART).map((t) => t.aspect));
  for (const a of found) assert.ok(ASPECTS.some((x) => x.name === a));
  const src = readFileSync(new URL("../lib/transits/transits.js", import.meta.url), "utf8");
  for (const minor of ["Quincunx", "Semisquare", "Sesquiquadrate", "Semisextile", "Quintile"]) {
    assert.ok(!src.includes(minor), `${minor} would be a silent expansion of the aspect system`);
  }
});

test("every transit carries the evidence its interpretation rests on", () => {
  const list = findTransits(SKY, CHART);
  assert.ok(list.length > 0, "the fixture must produce transits");
  for (const t of list) {
    assert.ok(TRANSITING_BODIES.includes(t.transiting));
    assert.ok(NATAL_BODIES.includes(t.natal));
    assert.ok(Number.isFinite(t.orb) && t.orb <= orbLimitFor(t.transiting));
    assert.match(t.orbLabel, /^\d+°\d{2}′$/);
    assert.ok(t.transitingPosition && t.natalPosition, "both positions are shown");
    assert.ok(t.duration, "a duration category, never a date");
    assert.equal(typeof t.background, "boolean");
  }
});

test("one aspect per transiting-natal pair, not several readings of the same thing", () => {
  const list = findTransits(SKY, CHART);
  const pairs = list.map((t) => `${t.transiting}|${t.natal}`);
  assert.equal(new Set(pairs).size, pairs.length);
  // And suppression keeps that true after ranking.
  const dupes = [
    { id: "a", transiting: "Mars", natal: "Moon", aspect: "Square", orb: 0.5, aspectWeight: 4, background: false },
    { id: "b", transiting: "Mars", natal: "Moon", aspect: "Trine", orb: 2.0, aspectWeight: 2, background: false },
  ];
  const kept = suppressDuplicates(rankTransits(dupes));
  assert.equal(kept.length, 1);
  assert.equal(kept[0].aspect, "Square", "the stronger contact survives");
});

// ── Ranking and grouping ────────────────────────────────────────────────────

test("relevance outranks orb, so a permanent outer contact cannot lead", () => {
  const list = [
    { id: "p", transiting: "Pluto", natal: "Neptune", aspect: "Trine", orb: 0.05, aspectWeight: 2, background: true },
    { id: "m", transiting: "Moon", natal: "Sun", aspect: "Conjunction", orb: 2.8, aspectWeight: 5, background: false },
  ];
  assert.equal(rankTransits(list)[0].id, "m",
    "a Moon-Sun conjunction at 2.8° leads a Pluto-Neptune trine at 0.05°");
  const k = transitRank(list[0]);
  assert.deepEqual(Object.keys(k), ["relevance", "weight", "orb", "pair"]);
});

test("ranking is deterministic and finally tie-broken", () => {
  const list = findTransits(SKY, CHART);
  const first = JSON.stringify(rankTransits(list).map((t) => t.id));
  for (let i = 0; i < 20; i += 1) {
    assert.equal(JSON.stringify(rankTransits(list).map((t) => t.id)), first);
  }
  // Identical scores still order stably by pair.
  const a = { id: "aaa", transiting: "Venus", natal: "Mars", aspect: "Trine", orb: 1, aspectWeight: 2, background: false };
  const b = { id: "bbb", transiting: "Venus", natal: "Mars", aspect: "Trine", orb: 1, aspectWeight: 2, background: false };
  assert.equal(rankTransits([b, a])[0].id, "aaa");
});

test("background influences are separated but never discarded", () => {
  const g = groupTransits(findTransits(SKY, CHART));
  for (const t of g.immediate) assert.equal(t.background, false);
  for (const t of g.background) assert.equal(t.background, true);
  assert.ok(g.immediate.length <= IMMEDIATE_LIMIT);
  // The complete set stays available even when the groups are capped.
  assert.ok(g.all.length >= g.immediate.length + g.background.length);
  // Slow transits must not be able to push immediate ones off the page.
  const flooded = [
    ...Array.from({ length: 12 }, (_, i) => ({ id: `bg${i}`, transiting: "Pluto", natal: NATAL_BODIES[i % 10],
      aspect: "Square", orb: 0.1, aspectWeight: 4, background: true })),
    { id: "now", transiting: "Moon", natal: "Sun", aspect: "Conjunction", orb: 2.9, aspectWeight: 5, background: false },
  ];
  assert.equal(groupTransits(flooded).immediate[0].id, "now",
    "twelve tight outer contacts must not bury the one immediate transit");
});

// ── Summary ─────────────────────────────────────────────────────────────────

test("the summary is reproducible from the ranked set, not invented beside it", () => {
  const g = groupTransits(findTransits(SKY, CHART));
  const s = summarise(g);
  assert.ok(s.text.length > 20);
  assert.equal(s.immediateCount, g.immediateTotal);
  assert.equal(s.backgroundCount, g.backgroundTotal);
  if (g.immediate.length) {
    assert.ok(s.text.includes(g.immediate[0].transiting), "it names the closest contact it counted");
  }
  // No forecast, no grading, no promise.
  assert.doesNotMatch(s.text, /\b(will|guarantee|destined|lucky|unlucky|dangerous|avoid)\b/i);
  assert.equal(summarise({ immediate: [], background: [] }), null);
});

test("the summary counts what is in orb, not what fits on the page", () => {
  // More immediate contacts than IMMEDIATE_LIMIT. Reporting the sliced length
  // would contradict the technical table rendered on the same screen.
  const many = Array.from({ length: IMMEDIATE_LIMIT + 3 }, (_, i) => ({
    id: `im${i}`, transiting: "Mercury", natal: NATAL_BODIES[i % 10],
    aspect: "Trine", orb: 0.4 + i * 0.1, aspectWeight: 2, background: false,
    orbLabel: "0°24′",
  }));
  const g = groupTransits(many);
  const s = summarise(g);
  assert.equal(g.immediate.length, IMMEDIATE_LIMIT, "the page is still capped");
  assert.equal(g.immediateTotal, IMMEDIATE_LIMIT + 3, "the count is not capped");
  assert.equal(s.immediateCount, IMMEDIATE_LIMIT + 3);
  assert.ok(s.text.includes(`${IMMEDIATE_LIMIT + 3} things in the sky are lining up`),
    "the summary states the real total, in words a beginner can read");
  assert.ok(s.text.includes(`The ${IMMEDIATE_LIMIT} closest are shown below`),
    "and says plainly that the list below is a subset");
});

// ── What is deliberately absent ─────────────────────────────────────────────

test("no exact-hit time and no end date are ever produced", () => {
  assert.equal(EXACT_TIMING_SUPPORTED, false);
  const src = readFileSync(new URL("../lib/transits/transits.js", import.meta.url), "utf8");
  for (const banned of ["exactAt", "becomesExact", "endsOn", "daysRemaining", "peaksOn"]) {
    assert.ok(!src.includes(banned), `${banned} would be an unsupported timing claim`);
  }
  const text = JSON.stringify(findTransits(SKY, CHART));
  assert.doesNotMatch(text, /\b\d{1,2}:\d{2}\s?(AM|PM)\b/i, "no clock time reaches a transit");
});

test("time-sensitive natal targets are never contacted", () => {
  // Angles and houses are not in the natal set at all, so an unknown-time
  // chart cannot receive one by accident.
  for (const forbidden of ["Ascendant", "Midheaven", "MC", "house"]) {
    assert.ok(!NATAL_BODIES.includes(forbidden));
  }
  const unknown = { ...CHART, time_known: false, time_accuracy: "unknown" };
  const list = findTransits(SKY, unknown);
  assert.ok(list.length > 0, "planet-to-planet transits still work without a birth time");
  for (const t of list) assert.ok(NATAL_BODIES.includes(t.natal));
});

test("the birth-time notice appears once, and only when it applies", () => {
  assert.equal(birthTimeNotice(CHART), null, "an exact-time chart needs no notice");
  const unknown = birthTimeNotice({ time_known: false });
  assert.match(unknown.body, /do not depend on the time of day/);
  const approx = birthTimeNotice({ time_accuracy: "approximate" });
  assert.match(approx.title, /approximate/i);
  assert.notEqual(unknown.title, approx.title, "the two states say different things");
});

test("planet roles are reused from the interpretation corpus", () => {
  assert.ok(planetRole("Mars"));
  const planets = readFileSync(new URL("../lib/interpretation/planets.js", import.meta.url), "utf8");
  for (const b of ["Mercury", "Saturn", "Neptune", "Pluto"]) {
    assert.ok(planets.includes(planetRole(b)), `${b}'s role must match My Chart's wording exactly`);
  }
  const src = readFileSync(new URL("../lib/transits/transits.js", import.meta.url), "utf8");
  assert.match(src, /from "\.\.\/interpretation\/planets\.js"/);
});

test("nothing here is random, clock-dependent, networked, or generated", () => {
  const src = readFileSync(new URL("../lib/transits/transits.js", import.meta.url), "utf8");
  for (const banned of ["Math.random", "Date.now(", "new Date(", "fetch(", "import("]) {
    assert.ok(!src.includes(banned), `${banned} would break determinism`);
  }
  for (const ai of ["openai", "anthropic", "ollama", "gpt-", "claude-"]) {
    assert.ok(!src.toLowerCase().includes(ai), `${ai} must never appear in the transit path`);
  }
  const once = JSON.stringify(findTransits(SKY, CHART));
  for (let i = 0; i < 10; i += 1) assert.equal(JSON.stringify(findTransits(SKY, CHART)), once);
});

test("a missing chart or sky yields nothing rather than throwing", () => {
  assert.deepEqual(findTransits(null, CHART), []);
  assert.deepEqual(findTransits(SKY, null), []);
  assert.deepEqual(findTransits({}, {}), []);
  assert.deepEqual(findTransits(SKY, { planets: { Sun: { sign: "Leo" } } }), [],
    "a placement without a longitude is skipped, not half-rendered");
});

test("formatting is stable and human", () => {
  assert.equal(formatOrb(1.0333), "1°02′");
  assert.equal(formatOrb(0), "0°00′");
  assert.equal(formatOrb(2.9999), "3°00′", "rounding to 60 minutes carries the degree");
});

// ── Interpretation ──────────────────────────────────────────────────────────

import { composeTransit, composeAll, ASPECT_DYNAMIC, TRANSIT_ACTION, TRANSIT_STIR,
         intensity, NEVER_RETROGRADE, RETROGRADE_MODIFIER } from "../lib/transits/interpretation.js";
import { PLANETS } from "../lib/interpretation/planets.js";

test("every aspect carries both a constructive and a tension reading", () => {
  // The same structural guard the natal corpus uses: no aspect can be graded
  // good or bad because both readings are always present.
  assert.deepEqual(Object.keys(ASPECT_DYNAMIC).sort(),
    ["Conjunction", "Opposition", "Sextile", "Square", "Trine"]);
  for (const [name, d] of Object.entries(ASPECT_DYNAMIC)) {
    assert.ok(d.constructive, `${name} needs a constructive reading`);
    assert.ok(d.tension, `${name} needs a tension reading`);
    assert.ok(d.verb && d.detail, `${name} incomplete`);
    assert.ok(d.plain, `${name} needs a plain-language reading`);
  }
  for (const b of TRANSITING_BODIES) {
    assert.ok(TRANSIT_ACTION[b], `${b} has no transit action`);
    assert.ok(TRANSIT_STIR[b], `${b} has no plain-language reading`);
  }
});

// ── The plain register ──────────────────────────────────────────────────────
//
// The sentence a beginner reads first must not require the vocabulary. This is
// the same rule the fortune engine has enforced from the start, applied to the
// surface that was still failing it — the old lead was "Transiting Mercury is
// putting words, plans, and second thoughts around your natal Venus — values,
// attraction, and taste", which is four terms deep before it says anything
// about the reader.
//
// Every combination is checked rather than a sample, because a term hiding in
// one of five hundred readings is exactly the kind of thing nobody sees until
// it is the one a reader gets.

/** Terminology, plus ordinary English words used technically in astrology. */
const JARGON = [
  ...Object.keys(PLANETS), "Chiron", "Lilith", "Ascendant", "Midheaven",
  "natal", "transit", "transiting", "aspect", "orb", "conjunction",
  "opposition", "trine", "sextile", "square", "retrograde", "ephemeris",
  "cusp", "degree", "zodiac", "houses",
];

test("the reading a beginner sees first contains no terminology at all", () => {
  const offences = [];
  for (const a of Object.keys(ASPECT_DYNAMIC)) {
    for (const transiting of TRANSITING_BODIES) {
      for (const natal of NATAL_BODIES) {
        const r = composeTransit({ id: "x", transiting, natal, aspect: a, orb: 1 });
        assert.ok(r, `${transiting}/${natal}/${a} must compose`);
        // The lead AND the first line of detail — both are read before anyone
        // opens the disclosure that holds the technical version.
        for (const line of [r.lead, r.detail[0]]) {
          for (const word of JARGON) {
            if (new RegExp(`\\b${word}\\b`, "i").test(line)) {
              offences.push(`${transiting}/${natal}/${a}: "${word}" in "${line}"`);
            }
          }
        }
      }
    }
  }
  assert.deepEqual(offences.slice(0, 5), [], `${offences.length} readings still lead with terminology`);
});

test("the technical reading is kept, not deleted", () => {
  // Plain-first is not the same as hiding the subject. Someone learning it must
  // still be able to find out that this is Mercury square Venus.
  const r = composeTransit({ id: "x", transiting: "Mercury", natal: "Venus", aspect: "Square", orb: 1 });
  assert.match(r.technical, /Transiting Mercury/);
  assert.match(r.technical, /your natal Venus/);
  assert.match(r.title, /^Mercury presses on your Venus$/,
    "the card is still titled with the contact it describes");

  // And the plain sentence is the one that leads.
  assert.equal(r.lead, "Your thoughts and conversations keep returning to "
    + "what you want, who you are drawn to, and what feels worth it.");
});

test("both registers describe the same body, from one source", () => {
  // The failure this guards against is Venus meaning one thing in My Chart and
  // another in Transits — which is what happens the moment somebody writes the
  // plain phrase a second time in a second file instead of importing it.
  // Comments are stripped first. The module's own documentation quotes Venus's
  // phrase as the worked example, and a scan that counts an explanation as a
  // duplicate fails on the very file that is doing the right thing.
  const code = readFileSync(new URL("../lib/transits/interpretation.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const [name, body] of Object.entries(PLANETS)) {
    assert.ok(body.plain, `${name} needs a plain phrase in the shared corpus`);
    assert.ok(!code.includes(body.plain), `${name}'s plain phrase must be imported, not restated`);
  }
});

test("natal roles are imported, never restated", () => {
  const src = readFileSync(new URL("../lib/transits/interpretation.js", import.meta.url), "utf8");
  assert.match(src, /from "\.\.\/interpretation\/planets\.js"/);
  const planets = readFileSync(new URL("../lib/interpretation/planets.js", import.meta.url), "utf8");
  for (const b of ["Mercury", "Saturn", "Neptune", "Pluto"]) {
    const r = composeTransit({ id: "x", transiting: "Sun", natal: b, aspect: "Trine", orb: 1 });
    assert.ok(planets.includes(r.targetRole), `${b}'s role must match My Chart exactly`);
  }
});

test("the retrograde modifier applies to the transiting body only", () => {
  const retro = composeTransit({ id: "x", transiting: "Saturn", natal: "Moon", aspect: "Square", orb: 1, retrograde: true });
  assert.ok(retro.detail.some((d) => d === RETROGRADE_MODIFIER));
  const direct = composeTransit({ id: "y", transiting: "Saturn", natal: "Moon", aspect: "Square", orb: 1, retrograde: false });
  assert.ok(!direct.detail.some((d) => d === RETROGRADE_MODIFIER));
  // The Sun and Moon never retrograde, so the modifier can never attach.
  const sun = composeTransit({ id: "z", transiting: "Sun", natal: "Mars", aspect: "Trine", orb: 1, retrograde: true });
  assert.ok(!sun.detail.some((d) => d === RETROGRADE_MODIFIER));
  assert.deepEqual([...NEVER_RETROGRADE], ["Sun", "Moon"]);
  // And it never claims anything about NATAL retrograde.
  assert.ok(!RETROGRADE_MODIFIER.toLowerCase().includes("born"));
  assert.ok(!RETROGRADE_MODIFIER.toLowerCase().includes("natal"));
});

test("intensity bands are deterministic and stated as fact", () => {
  assert.equal(intensity(0.2).label, "Exact");
  assert.equal(intensity(1.0).label, "Close");
  assert.equal(intensity(2.5).label, "Wide");
  assert.equal(intensity(null), null);
});

test("a malformed transit becomes a missing card, not a sentence about nothing", () => {
  assert.equal(composeTransit(null), null);
  assert.equal(composeTransit({ transiting: "Nibiru", natal: "Sun", aspect: "Trine" }), null);
  assert.equal(composeTransit({ transiting: "Sun", natal: "Nibiru", aspect: "Trine" }), null);
  assert.equal(composeTransit({ transiting: "Sun", natal: "Moon", aspect: "Quincunx" }), null);
  // One bad entry does not destroy the valid ones beside it.
  const mixed = composeAll([
    { id: "ok", transiting: "Mars", natal: "Moon", aspect: "Square", orb: 1 },
    { id: "bad", transiting: "Nibiru", natal: "Moon", aspect: "Square", orb: 1 },
  ]);
  assert.equal(mixed.length, 1);
  assert.equal(mixed[0].id, "ok");
});

test("transit interpretation is deterministic and free of AI or randomness", () => {
  const t = { id: "x", transiting: "Mars", natal: "Moon", aspect: "Square", orb: 1.02, retrograde: false, duration: "A fast-moving influence" };
  const once = JSON.stringify(composeTransit(t));
  for (let i = 0; i < 20; i += 1) assert.equal(JSON.stringify(composeTransit(t)), once);
  const src = readFileSync(new URL("../lib/transits/interpretation.js", import.meta.url), "utf8");
  for (const banned of ["Math.random", "Date.now(", "fetch(", "openai", "anthropic", "ollama"]) {
    assert.ok(!src.toLowerCase().includes(banned.toLowerCase()), `${banned} must not appear`);
  }
});

test("no transit reading predicts, grades, or diagnoses", () => {
  const readings = [];
  for (const a of Object.keys(ASPECT_DYNAMIC)) {
    for (const b of TRANSITING_BODIES) {
      const r = composeTransit({ id: "x", transiting: b, natal: "Moon", aspect: a, orb: 1, retrograde: true });
      if (r) readings.push([r.title, r.lead, ...r.detail, r.constructive, r.tension].join(" "));
    }
  }
  assert.ok(readings.length > 40);
  for (const text of readings) {
    assert.doesNotMatch(text, /\b(will definitely|guaranteed|destined|you must|doomed|dangerous)\b/i);
    assert.doesNotMatch(text, /\b(diagnos|depression|anxiety disorder|medication|lawsuit|invest)\b/i);
  }
});

// ── The workspace ───────────────────────────────────────────────────────────

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = readFileSync(join(ROOT, "public", "index.html"), "utf8");
const APP = readFileSync(join(ROOT, "public", "app.js"), "utf8");
const API = readFileSync(join(ROOT, "lib", "charts", "api.js"), "utf8");

test("the workspace consumes the dedicated endpoint, never fortune factors", () => {
  assert.match(API, /action === "transits" && method === "GET"/, "the endpoint exists");
  assert.match(API, /findTransits\(sky, chart\)/, "and calculates server-side");
  assert.match(APP, /\/api\/charts\/\$\{chart\.id\}\/transits/);
  assert.ok(!APP.includes("transitsFromFortune"), "no fortune-derived reader survives");
  // Bounded to the workspace block: AXIS.lastFortune is Home's, declared later
  // in the file, and an unbounded slice runs to EOF and catches it.
  const ws = APP.slice(APP.indexOf("const TRANSITS = {"), APP.indexOf("/* ── Symbol Atlas"));
  assert.ok(!ws.includes("lastFortune"), "and no hidden fallback to it");
});

test("the workspace renders the hierarchy in order", () => {
  const ws = APP.slice(APP.indexOf("function renderTransitsWorkspace"));
  const order = ["tr-summary-title", "tr-immediate-title", "tr-background-title", "tr-technical-title"];
  const at = order.map((id) => { const i = ws.indexOf(id); assert.ok(i > -1, `${id} missing`); return i; });
  for (let i = 1; i < at.length; i += 1) assert.ok(at[i] > at[i - 1], `${order[i]} must follow ${order[i - 1]}`);
  assert.ok(HTML.indexOf('id="transits-explore"') > HTML.indexOf('id="transits-body"'));
});

test("aspect, orb, and motion are visible text, not glyphs or colour", () => {
  const card = APP.slice(APP.indexOf("function transitCardHtml"), APP.indexOf("function renderTransitsWorkspace"));
  assert.match(card, /esc\(t\.motion\)/, "Applying/Separating is rendered as text");
  assert.match(card, /esc\(t\.orbLabel\)/, "the orb is text");
  // Since Dev Update 1.12 the aspect name is an Atlas reference link — still
  // visible text (the link's label IS the name, escaped inside atlasLinkHtml),
  // now also a way to learn what the word means.
  assert.match(card, /atlasLinkHtml\("aspects", t\.aspect\)/, "the aspect is named");
  assert.match(card, /Retrograde/, "retrograde state is a word");
});

test("rapid chart switching cannot let a slow response paint over a newer one", () => {
  const fn = APP.slice(APP.indexOf("async function loadTransits"), APP.indexOf("function transitsRenderSignedOut"));
  assert.match(fn, /const token = \+\+TRANSITS\.token/);
  assert.match(fn, /if \(token !== TRANSITS\.token\) return;/);
  // Clearing happens before the request, not after it returns.
  const clearAt = fn.indexOf("transitsClear()");
  const fetchAt = fn.indexOf("/transits?tz=");
  assert.ok(clearAt > -1 && clearAt < fetchAt, "the old reading clears before the new request");
  // The subtitle names the incoming chart while loading. Left alone it keeps
  // the previous chart's name above an empty body and a status line naming a
  // different chart.
  const nameAt = fn.indexOf("transitsChartName(chart.nickname)");
  assert.ok(nameAt > -1 && nameAt < fetchAt, "the subtitle renames before the request resolves");
});

test("the explore links are the last thing on the page", () => {
  const explore = HTML.indexOf('id="transits-explore"');
  const panelEnd = HTML.indexOf('id="panel-positions"');
  assert.ok(explore > -1 && explore < panelEnd);
  // Upcoming Sky Events is shared-sky content, so it belongs above the exits
  // rather than trailing after them.
  const events = HTML.indexOf('id="events-timeline"');
  assert.ok(events > -1 && events < explore,
    "Upcoming Sky Events precedes Continue exploring");
  assert.ok(events < panelEnd, "and still lives inside the transits panel");
});

test("signed out and chartless states render nothing personal", () => {
  const fn = APP.slice(APP.indexOf("async function loadTransits"), APP.indexOf("function transitsRenderSignedOut"));
  assert.match(fn, /state\.auth\.restoring \|\| !authSignedIn\(\)/,
    "unresolved is not treated as signed out");
  const noChart = APP.slice(APP.indexOf("function transitsRenderNoChart"), APP.indexOf("function transitCardHtml"));
  assert.match(noChart, /needs a saved chart/i);
  assert.match(noChart, /data-action="add-chart"/, "one Create Chart action");
  assert.match(noChart, /href="#positions"/, "and the shared sky is still offered");
  assert.ok(!noChart.includes("tr-summary"), "no fabricated personal summary");
});

test("failures are announced, retryable, and never silent", () => {
  assert.match(APP, /data-action="retry-transits"/);
  assert.match(APP, /stage: "render"/, "a render defect is not reported as a network problem");
  const codeOnly = APP.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
  assert.ok(!codeOnly.includes("catch {}"), "no silent catch");

  // The message reaches the live region that already exists in the document.
  // A role="alert" created in the same breath as its own text announces
  // inconsistently, so the error must not rely on one.
  const fn = APP.slice(APP.indexOf("function transitsRenderError"),
                       APP.indexOf("function transitsRenderNoChart"));
  assert.match(fn, /transitsStatus\(message\)/, "the failure is announced, not just drawn");
  // Comments in this function discuss the role by name, so match rendered
  // markup only — the same trap the banned-string checks above avoid.
  const fnCode = fn.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(!fnCode.includes('role="alert"'), "and is not double-announced by an injected alert");
  assert.match(HTML, /id="transits-status"[^>]*role="status"[^>]*aria-live="polite"/,
    "the live region is present in the served markup, not created on demand");
});

test("the workspace links only to routes that exist", () => {
  // Bounded to THIS panel: Symbol Atlas is many panels further down, so slicing
  // to it sweeps up every workspace in between.
  const from = HTML.indexOf('id="panel-transits"');
  const panel = HTML.slice(from, HTML.indexOf('class="workspace-panel"', from + 50));
  const registry = APP.slice(APP.indexOf("const WORKSPACES"), APP.indexOf("const RETIRED_ROUTES"));
  const registered = [...registry.matchAll(/id: "([a-z-]+)"/g)].map((m) => m[1]);
  const links = [...panel.matchAll(/href="#([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(links.length >= 3, `expected the exits, saw ${links.join(", ")}`);
  for (const l of links) assert.ok(registered.includes(l), `#${l} is not a workspace`);
  // The page DOES link to itself now, exactly once: the segmented control that
  // switches between this view and Everyone's sky has to show both, and the
  // current one is marked aria-current rather than removed. Anything beyond
  // that self-link would be a link to where you already are.
  const self = [...panel.matchAll(/href="#transits"/g)];
  assert.equal(self.length, 1, "only the segmented control may point at this page");
  assert.match(panel, /href="#transits" aria-current="page"/,
    "and it must be marked as the current view rather than looking like an exit");
});

test("no exact-hit time or end date reaches the rendered workspace", () => {
  const ws = APP.slice(APP.indexOf("const TRANSITS = {"), APP.indexOf("/* ── Symbol Atlas"));
  for (const banned of ["becomes exact", "ends on", "exact at", "days remaining"]) {
    assert.ok(!ws.toLowerCase().includes(banned), `"${banned}" is an unsupported timing claim`);
  }
  assert.match(ws, /does not publish exact-hit times or end dates/,
    "and the page says so where a reader would look for them");
});
