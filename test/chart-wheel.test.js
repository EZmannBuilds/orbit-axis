// Orbit Axis :: the chart wheel is a drawing of calculated positions.
//
// The wheel cannot be imported — app.js is a browser module with side effects —
// so the pure geometry is EXTRACTED FROM THE SHIPPED SOURCE and evaluated here.
// That is deliberately not a copy: if the file changes, this runs the change.
//
// The one thing worth testing hardest is the angle convention. An astrological
// wheel runs anticlockwise from the left-hand horizon, which is the opposite of
// how SVG measures angles — get it backwards and every placement mirrors while
// the picture still looks like a chart.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "public", "app.js"), "utf8");

/** Pull a top-level function's source out of app.js and make it callable. */
function extract(...names) {
  const parts = names.map((name) => {
    const start = APP.indexOf(`function ${name}(`);
    assert.ok(start > -1, `${name} should exist in app.js`);
    let depth = 0;
    const open = APP.indexOf("{", start);
    for (let i = open; i < APP.length; i += 1) {
      if (APP[i] === "{") depth += 1;
      else if (APP[i] === "}") { depth -= 1; if (depth === 0) return APP.slice(start, i + 1); }
    }
    throw new Error(`could not close ${name}`);
  });
  const zodiac = APP.slice(APP.indexOf("const ZODIAC_ORDER"), APP.indexOf("];", APP.indexOf("const ZODIAC_ORDER")) + 2);
  return new Function(`${zodiac}\n${parts.join("\n")}\nreturn {${names.join(",")}};`)();
}

const { placementLongitude, wheelPoint, wheelSpread } = extract("placementLongitude", "wheelPoint", "wheelSpread");

test("longitude is derived exactly from sign, degree and minute", () => {
  assert.equal(placementLongitude({ sign: "Aries", degrees: 0, minutes: 0 }), 0);
  // Pisces is the twelfth sign: 11 × 30 = 330, plus 2°31′.
  assert.equal(
    placementLongitude({ sign: "Pisces", degrees: 2, minutes: 31 }).toFixed(4),
    (330 + 2 + 31 / 60).toFixed(4),
  );
  assert.equal(placementLongitude({ sign: "Virgo", degrees: 4, minutes: 43 }).toFixed(4), (150 + 4 + 43 / 60).toFixed(4));
});

test("a body with no sign or degree is dropped, never placed at zero", () => {
  // Drawing an unknown at 0° Aries would look identical to a real Aries body.
  assert.equal(placementLongitude(null), null);
  assert.equal(placementLongitude({ sign: "Virgo" }), null);
  assert.equal(placementLongitude({ sign: "Nonsense", degrees: 4 }), null);
  assert.equal(placementLongitude({ unavailable: true, sign: "Virgo", degrees: 4 }), null);
});

test("0° with no rotation sits on the LEFT horizon, and the wheel runs anticlockwise", () => {
  const left = wheelPoint(0, 100, 0);
  assert.equal(Math.round(left.x), 100, "0° is at the left edge (200 - radius)");
  assert.equal(Math.round(left.y), 200, "and level with the centre");

  // 90° further along the zodiac must go DOWN the screen, not up: anticlockwise
  // in chart terms is clockwise in SVG's inverted-Y space.
  const quarter = wheelPoint(90, 100, 0);
  assert.equal(Math.round(quarter.x), 200);
  assert.ok(quarter.y > 200, `90° should fall below centre, got y=${quarter.y}`);

  const opposite = wheelPoint(180, 100, 0);
  assert.equal(Math.round(opposite.x), 300, "180° is opposite 0°");
});

test("rotation puts the Ascendant on the left horizon", () => {
  // Whatever the Ascendant's longitude, rotating by it must land at the left.
  for (const asc of [0, 47.5, 213.9, 359.2]) {
    const p = wheelPoint(asc, 100, asc);
    assert.equal(Math.round(p.x), 100, `ASC ${asc}° should sit at the left horizon`);
    assert.equal(Math.round(p.y), 200);
  }
});

test("crowded bodies are tiered outward rather than drawn on top of each other", () => {
  // A stellium is exactly when the wheel matters most; overlapping glyphs there
  // would hide the thing the reader came to see.
  const tiers = wheelSpread([
    { key: "Sun", longitude: 100 },
    { key: "Mercury", longitude: 101.5 },
    { key: "Venus", longitude: 103 },
    { key: "Mars", longitude: 250 },
  ]);
  const byKey = Object.fromEntries(tiers.map((b) => [b.key, b.tier]));
  assert.equal(byKey.Sun, 0);
  assert.notEqual(byKey.Mercury, byKey.Sun, "a body 1.5° away must not share a tier");
  assert.notEqual(byKey.Venus, byKey.Mercury);
  assert.equal(byKey.Mars, 0, "a body far from the others returns to the base tier");
});

test("the wheel is wired into the chart lifecycle, not left orphaned", () => {
  assert.match(APP, /renderChartWheel\(chart, readingPayload\)/, "it renders with the chart");
  assert.match(APP, /"#section-wheel"/, "its section shows and hides with the reading");
  assert.match(APP, /"#chart-wheel", "#chart-wheel-selected"/, "and clears with the rest, so no stale chart survives");
});

test("an unknown birth time draws no Ascendant, horizon or houses", () => {
  // Birth-time certainty is a product rule, not a rendering preference: with no
  // time the Ascendant is unfounded rather than merely uncertain.
  const fn = APP.slice(APP.indexOf("function renderChartWheel"), APP.indexOf("/** Selecting a glyph"));
  assert.match(fn, /const timeKnown = accuracy !== "unknown"/);
  assert.match(fn, /timeKnown \? placementLongitude\(chart\?\.angles\?\.ascendant\) : null/,
    "the Ascendant is not even computed without a time");
  assert.match(fn, /ascLongitude == null \? "" :/, "and the horizon is omitted with it");
  assert.match(fn, /Houses and the Ascendant are not shown/, "the drawing says so in words");
});

test("the drawing carries the same placements as text", () => {
  const fn = APP.slice(APP.indexOf("function renderChartWheel"), APP.indexOf("/** Selecting a glyph"));
  assert.match(fn, /<desc id="cw-desc">/, "an SVG description, not just a title");
  assert.match(fn, /const description = placed/, "built from the same placed bodies that are drawn");
  assert.match(fn, /role="img" aria-labelledby="cw-title cw-desc"/);
  assert.match(fn, /tabindex="0" role="button"/, "and every glyph is reachable by keyboard");
});
