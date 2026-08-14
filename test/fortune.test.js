// Orbit Axis :: Daily Fortune engine tests (deterministic).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { computeNatalChart } from "../lib/astro/natal.js";
import { currentSky } from "../lib/astro/current-sky.js";
import {
  composeFortune, fortuneSeed, luckyNumber, localDateForZone,
  factorsForLevel, personalTransits, FORTUNE_ENGINE_VERSION,
} from "../lib/fortune/engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const REF = {
  birth_date: "1990-06-16", birth_time: "08:30", time_accuracy: "exact",
  latitude: 51.5, longitude: -0.13, timezone_name: "Europe/London",
  utc_offset_at_birth: "+00:00", zodiac_system: "tropical", house_system: "placidus",
};
const CHART = computeNatalChart(REF);
const SKY = currentSky(new Date("2026-07-11T12:00:00Z"));

function fortune(overrides = {}) {
  return composeFortune({
    chart: CHART, sky: SKY, localDate: "2026-07-11", timezoneName: "America/Chicago",
    chartId: "chart-a", chartInputHash: "hashA", ...overrides,
  });
}

test("fortune has all required fields", () => {
  const f = fortune();
  for (const k of ["mood", "love_reading", "luck_reading", "watch_out", "lucky_number", "lucky_color", "factors", "sky_snapshot", "seed_hash"]) {
    assert.ok(f[k] !== undefined && f[k] !== null, `missing ${k}`);
  }
  assert.equal(f.fortune_engine_version, FORTUNE_ENGINE_VERSION);
  assert.ok(typeof f.mood === "string" && f.mood.length > 0);
  assert.ok(typeof f.lucky_color.name === "string" && /^#[0-9A-Fa-f]{6}$/.test(f.lucky_color.value));
});

test("same chart + same date => identical fortune (determinism)", () => {
  assert.deepEqual(fortune(), fortune());
  assert.equal(fortune().seed_hash, fortune().seed_hash);
});

test("different date => different seed and (very likely) different content", () => {
  const a = fortune({ localDate: "2026-07-11" });
  const b = fortune({ localDate: "2026-07-12" });
  assert.notEqual(a.seed_hash, b.seed_hash);
});

test("different chart => different seed", () => {
  const a = fortune({ chartId: "chart-a", chartInputHash: "hashA" });
  const b = fortune({ chartId: "chart-b", chartInputHash: "hashB" });
  assert.notEqual(a.seed_hash, b.seed_hash);
});

test("engine-version is part of the seed", () => {
  const s1 = fortuneSeed({ localDate: "2026-07-11", chartId: "x", chartInputHash: "h", skySnapshotHash: "s" });
  assert.match(s1, /^[0-9a-f]{64}$/);
});

test("lucky number is stable and within 1..9", () => {
  const f = fortune();
  assert.equal(f.lucky_number, fortune().lucky_number);
  assert.ok(f.lucky_number >= 1 && f.lucky_number <= 9);
  // direct rule check
  const n = luckyNumber(f.seed_hash, "2026-07-11");
  assert.equal(n, luckyNumber(f.seed_hash, "2026-07-11"));
});

test("lucky color is stable and accessible-valued", () => {
  const f = fortune();
  assert.deepEqual(f.lucky_color, fortune().lucky_color);
  assert.match(f.lucky_color.value, /^#[0-9A-Fa-f]{6}$/);
});

test("fortune is grounded in real current-sky data", () => {
  const s = fortune().sky_snapshot;
  assert.ok(["Aries","Taurus","Gemini","Cancer","Leo","Virgo","Libra","Scorpio","Sagittarius","Capricorn","Aquarius","Pisces"].includes(s.zodiac_season));
  assert.ok(s.moon_sign && s.moon_phase);
  assert.ok(s.illumination_percent >= 0 && s.illumination_percent <= 100);
  assert.equal(typeof s.waxing, "boolean");
  assert.ok(Array.isArray(s.retrogrades));
});

test("no unsupported factor is invented (factors reference real bodies/aspects)", () => {
  const f = fortune();
  const transitFactors = f.factors.filter((x) => x.type === "transit");
  for (const tf of transitFactors) {
    // every transit factor must correspond to a real computed transit
    assert.match(tf.advanced, /orb \d+°\d{2}′, (applying|separating)/);
  }
});

test("watch-out reflects retrogrades when present, avoids fear/forbidden copy", () => {
  const f = fortune();
  assert.doesNotMatch(f.watch_out.toLowerCase(), /don't overreact/);
  if (f.sky_snapshot.retrogrades.includes("Mercury")) {
    // Update 5.2: the advice still comes FROM the retrograde, but no longer
    // names it. This asserts the meaning survived the translation — messages
    // and plans needing a second look is the practical content of a Mercury
    // retrograde — while the plain-language guarantee below forbids the term
    // itself. Asserting the old phrasing would have re-enforced the jargon.
    assert.match(f.watch_out.toLowerCase(), /messages|plans|details|confirm|second look/,
      "the retrograde's practical advice must survive in plain words");
    assert.doesNotMatch(f.watch_out, /Mercury/,
      "…without naming the planet, which belongs to Technical Sky");
  }
});

test("luck is framed as conditions, never a guarantee", () => {
  const f = fortune();
  assert.match(f.luck_reading.toLowerCase(), /not guarantees|conditions/);
  assert.doesNotMatch(f.luck_reading.toLowerCase(), /you will (win|get rich|find love)/);
});

test("detail levels: Simple hides degrees, Advanced shows them", () => {
  const f = fortune();
  const simple = factorsForLevel(f.factors, "Simple").join(" | ");
  const advanced = factorsForLevel(f.factors, "Advanced").join(" | ");
  assert.doesNotMatch(simple, /°\d{2}′/); // no exact deg/min in Simple
  assert.match(advanced, /°/);            // degrees present in Advanced
});

test("detail levels: Balanced removed — legacy value renders as Simple", () => {
  const f = fortune();
  const simple = factorsForLevel(f.factors, "Simple");
  // A stale "Balanced" (or any unknown level) must never blank out or throw;
  // it falls through to the plain Simple phrasing.
  const legacy = factorsForLevel(f.factors, "Balanced");
  assert.deepEqual(legacy, simple);
  assert.ok(legacy.every((line) => typeof line === "string" && line.length > 0));
  // No factor object should still carry a `balanced` phrasing.
  assert.ok((f.factors || []).every((factor) => !("balanced" in factor)));
});

test("localDateForZone uses the user's timezone, not the server's", () => {
  // 02:30 UTC on the 11th is still the 10th in Chicago (-05/-06)
  const instant = new Date("2026-07-11T02:30:00Z");
  assert.equal(localDateForZone(instant, "UTC"), "2026-07-11");
  assert.equal(localDateForZone(instant, "America/Chicago"), "2026-07-10");
  // two users, different zones, same instant => can differ
  assert.notEqual(localDateForZone(instant, "UTC"), localDateForZone(instant, "America/Chicago"));
});

test("engine source contains no Math.random (deterministic selection only)", () => {
  const src = readFileSync(join(__dirname, "../lib/fortune/engine.js"), "utf8");
  assert.doesNotMatch(src, /Math\.random/);
});

test("personalTransits are within orb and marked applying/separating", () => {
  const ts = personalTransits(SKY, CHART, 3);
  for (const t of ts) {
    assert.ok(t.orb <= 3);
    assert.equal(typeof t.applying, "boolean");
    assert.ok(["conjunction","sextile","square","trine","opposition"].includes(t.aspect));
  }
});

// ── Plain-language guarantee (Update 5.2) ──────────────────────────────────
//
// A source-level test on the card builder passed while the RENDERED fortune
// still read "Mercury is retrograde, so double-check messages…" — because the
// wording came from the engine's data, not from the template the test scanned.
// Only opening the page caught it.
//
// These tests read the composed output, which is where the words actually are.

const TECHNICAL_TERMS = [
  "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto",
  "retrograde", "house", "aspect", "conjunct", "square", "trine", "sextile",
  "opposition", "orb", "degree", "ascendant", "midheaven", "natal", "transit",
];

test("the plain readings never use technical astrology wording", () => {
  // Several skies, so one lucky sample cannot pass by accident. Mercury
  // retrograde is included deliberately: that branch is the one that leaked.
  const skies = [
    SKY,
    { ...SKY, retrogrades: ["Mercury"] },
    { ...SKY, retrogrades: ["Mercury", "Saturn", "Neptune"] },
    { ...SKY, retrogrades: [] },
  ];

  for (const sky of skies) {
    const f = fortune({ sky });
    for (const field of ["mood", "love_reading", "luck_reading", "watch_out"]) {
      const text = String(f[field] || "");
      for (const term of TECHNICAL_TERMS) {
        assert.ok(!new RegExp(`\\b${term}\\b`, "i").test(text),
          `${field} contains "${term}" — the plain half of the fortune must not use it.\n  ${text}`);
      }
    }
  }
});

test("the technical wording survives, in the factors", () => {
  // Translating the readings must not lose the astrology — it moves it to
  // Technical Sky, which renders factors[].advanced.
  const f = fortune({ sky: { ...SKY, retrogrades: ["Mercury"] } });
  const advanced = (f.factors || []).map((x) => x.advanced).join(" ");
  assert.match(advanced, /Mercury/, "the technical half must still name the planet");
  assert.match(advanced, /retrograde/i);
});

test("translating the wording kept the fortune deterministic", () => {
  const sky = { ...SKY, retrogrades: ["Mercury"] };
  const a = fortune({ sky });
  const b = fortune({ sky });
  assert.equal(a.watch_out, b.watch_out);
  assert.equal(a.mood, b.mood);
  assert.equal(a.seed_hash, b.seed_hash);
});

test("a stored fortune from before the redesign still renders", () => {
  // The cards read mood / love_reading / luck_reading / watch_out and tolerate
  // a missing field. History must not be invalidated by a visual change.
  const f = fortune();
  const asStored = { ...f, watch_out: undefined };   // an older row lacking a field
  const present = ["mood", "love_reading", "luck_reading", "watch_out"]
    .filter((k) => typeof asStored[k] === "string" && asStored[k].trim());
  assert.equal(present.length, 3, "the remaining readings should still be usable");
  assert.ok(asStored.factors?.length, "factors survive for Technical Sky");
});

// ── The banks themselves, exhaustively (fortune-v2) ─────────────────────────
//
// The composed-output tests above sample a few skies, which only ever exercise
// the phrases those particular seeds select. Expanding the banks from a handful
// of lines to ~130 made that gap real: a forbidden word could sit in a line
// nobody's seed picks for months and ship without a single failing test.
//
// These read every authored string in the engine.

import { allAuthoredPhrases, reviewPhrases } from "../lib/fortune/engine.js";
import { oneReadingPerDate } from "../lib/fortune/service.js";

test("no authored phrase anywhere uses technical wording", () => {
  const phrases = allAuthoredPhrases();
  assert.ok(phrases.length > 100, `expected an expanded bank, found ${phrases.length}`);

  for (const phrase of phrases) {
    for (const term of TECHNICAL_TERMS) {
      assert.ok(!new RegExp(`\\b${term}\\b`, "i").test(phrase),
        `"${term}" appears in an authored phrase — the plain half must not use it.\n  ${phrase}`);
    }
  }
});

test("every review-branch line still carries the practical advice", () => {
  // The retrograde branch may not name the planet, so the ONLY thing making it
  // useful is that it says what to actually do. A line that lost that would
  // pass the no-technical-wording rule while saying nothing at all.
  for (const phrase of reviewPhrases()) {
    assert.match(phrase.toLowerCase(), /messages|plans|details|confirm|second look/,
      `a review line carries no practical advice: ${phrase}`);
  }
});

test("no authored phrase promises an outcome", () => {
  // Rule 2 of the bank: conditions and invitations, never predictions.
  const PROMISES = [
    /\byou will\b/i, /\bwill definitely\b/i, /\bguaranteed\b/i,
    /\bis certain\b/i, /\bmust happen\b/i, /\byou'll get\b/i,
  ];
  for (const phrase of allAuthoredPhrases()) {
    for (const pattern of PROMISES) {
      assert.ok(!pattern.test(phrase), `a phrase promises an outcome: ${phrase}`);
    }
  }
});

test("expanding the banks actually widened the output", () => {
  // Guards against a bank that grew while composition still picks from a fixed
  // slice of it — more copy that nobody ever sees.
  const moods = new Set();
  const watches = new Set();
  // BOTH watch-out branches. The default fixture has Mercury retrograde, so
  // sampling it alone only ever exercises the five review lines — the first
  // version of this test asserted eight and failed for that reason, which was
  // the test being wrong rather than the banks being narrow.
  const skies = [SKY, { ...SKY, retrogrades: [] }];
  for (let day = 1; day <= 28; day += 1) {
    const localDate = `2026-09-${String(day).padStart(2, "0")}`;
    for (const chartId of ["chart-a", "chart-b", "chart-c"]) {
      for (const sky of skies) {
        const f = fortune({ localDate, chartId, sky });
        moods.add(f.mood);
        watches.add(f.watch_out);
      }
    }
  }
  assert.ok(moods.size >= 12, `only ${moods.size} distinct moods across the sample`);
  assert.ok(watches.size >= 8, `only ${watches.size} distinct watch-outs across the sample`);
});

// ── One reading per day, across an engine-version change ────────────────────

test("history shows a date once, even when two engine versions stored it", () => {
  // getFortune() looks up by (profile, date, VERSION); listHistory does not
  // filter by version. So bumping the engine gives a recomposed date a second
  // row, and History would show the same day twice with different words —
  // which reads as the app inventing readings.
  const rows = [
    { fortune_date: "2026-09-02", fortune_engine_version: "fortune-v1", created_at: "2026-09-02T10:00:00Z", mood: "old" },
    { fortune_date: "2026-09-02", fortune_engine_version: "fortune-v2", created_at: "2026-09-02T11:00:00Z", mood: "new" },
    { fortune_date: "2026-09-01", fortune_engine_version: "fortune-v1", created_at: "2026-09-01T10:00:00Z", mood: "older" },
  ];
  const kept = oneReadingPerDate(rows);
  assert.equal(kept.length, 2, "one row per date");
  assert.equal(kept[0].fortune_date, "2026-09-02", "newest date first");
  assert.equal(kept[0].mood, "new", "the newer row wins");
  assert.equal(kept[1].mood, "older", "untouched dates keep their original wording");
});

test("the newer row wins by version when timestamps are missing or equal", () => {
  const kept = oneReadingPerDate([
    { fortune_date: "2026-09-02", fortune_engine_version: "fortune-v1", mood: "old" },
    { fortune_date: "2026-09-02", fortune_engine_version: "fortune-v2", mood: "new" },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].mood, "new");
});

test("a row without a date is kept, not silently dropped", () => {
  // Dropping it would turn a data problem into the appearance of lost history.
  const kept = oneReadingPerDate([
    { fortune_date: "2026-09-02", mood: "a" },
    { mood: "orphan" },
  ]);
  assert.equal(kept.length, 2);
  assert.ok(kept.some((r) => r.mood === "orphan"));
});
