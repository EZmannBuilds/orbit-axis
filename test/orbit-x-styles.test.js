// Orbit Axis :: Orbit X styled template families (Dev Update 6.2).
//
// Living Atlas, After Dark Observatory and Cosmic Press, held as tests: the
// palettes are the founder's, colour means a kind of post, every diagram is
// geometry of engine facts, every post type renders to a PNG at the real size
// with nothing running off the slide, contrast clears WCAG, the things that
// read as AI-made are absent, and the families sit in the picker switched off.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

import {
  STYLE_FAMILIES, STYLE_FAMILY_IDS, COVER_LAYOUTS, KINDS, kindFor, accentFor, contrastRatio, softOf, mix,
  measure, fit, wheelBodies, longitudeOf, aspectsAmong, numeralFor, coordinateLine, renderStyledSlide,
  requiredContrast,
} from "../lib/orbit-x/styles.js";
import { FONT_METRICS } from "../lib/orbit-x/font-metrics.js";
import { FONT_FILES, rasterizeSvg, pngDimensions } from "../lib/orbit-x/raster.js";
import { TEMPLATES, normalizeDesign, renderPost } from "../lib/orbit-x/templates.js";
import { exampleCandidates, renderExample, examplePost } from "../lib/orbit-x/samples.js";
import { gridPage, coverFit } from "../lib/orbit-x/grid-preview.js";
import {
  BUILTIN_POST_TYPES, DEFAULT_INACTIVE_KEYS, templateStates, rotationTypes, planRegistrySync, renderFingerprint, CHANNEL_FORMATS,
} from "../lib/orbit-x/post-types.js";
import { runPostChecks } from "../lib/orbit-x/policy.js";
import { buildScaffold, buildReadingScaffold } from "../lib/orbit-x/language.js";
import { calculateReadingPeriod } from "../lib/orbit-x/readings.js";
import { FORMATS } from "../lib/orbit-x/formats.js";

const example = exampleCandidates();
const styledKeys = BUILTIN_POST_TYPES.filter((b) => STYLE_FAMILY_IDS.includes(b.spec.family)).map((b) => b.key);

/* ── The brief: palettes, fonts, licences ─────────────────────────────────── */

test("the three palettes are exactly the founder's", () => {
  const a = STYLE_FAMILIES.living_atlas;
  assert.deepEqual([a.paper, a.ink, ...Object.values(a.palette)], ["#F6F1E7", "#182C39", "#C65B43", "#2859A6", "#6C8669", "#F1C75B", "#E8B5C0"]);
  const d = STYLE_FAMILIES.after_dark;
  assert.deepEqual([d.page, d.ink, ...Object.values(d.palette)], ["#101B29", "#F7F0DE", "#F28C69", "#9CC9DB", "#D9B9E8", "#EBC95D", "#8FB89F"]);
  const p = STYLE_FAMILIES.cosmic_press;
  assert.deepEqual([p.page, p.ink, ...Object.values(p.palette)], ["#FFF8E9", "#242020", "#C43D3B", "#285D83", "#D9A72E", "#53765A", "#D9B5E8"]);
  assert.deepEqual([a.display, a.text, a.mono], ["Fraunces", "DM Sans", "Orbit Coord Mono"]);
  assert.deepEqual([d.display, d.text], ["Newsreader", "Manrope"]);
  assert.deepEqual([p.display, p.text], ["Newsreader", "Space Grotesk"]);
});

test("fonts are bundled with their licences, and metrics exist for every face used", () => {
  for (const file of FONT_FILES) {
    assert.ok(existsSync(new URL(`../lib/orbit-x/fonts/${file}`, import.meta.url)), `${file} is bundled`);
  }
  for (const stem of ["Fraunces", "DMSans", "OrbitCoordMono", "Manrope", "Newsreader", "SpaceGrotesk"]) {
    const licence = readFileSync(new URL(`../lib/orbit-x/fonts/OFL-${stem}.txt`, import.meta.url), "utf8");
    assert.match(licence, /SIL OPEN FONT LICENSE Version 1\.1/i, `${stem} carries the OFL text`);
  }
  for (const f of Object.values(STYLE_FAMILIES)) {
    for (const family of [f.display, f.text, f.mono]) {
      for (const weight of [400, 700]) assert.ok(FONT_METRICS[`${family}|${weight}`], `${family} ${weight} has metrics`);
    }
  }
  // IBM Plex Mono's Reserved Font Name must not appear in the modified, bundled subset.
  const bytes = readFileSync(new URL("../lib/orbit-x/fonts/OrbitCoordMono-Regular.ttf", import.meta.url));
  assert.ok(!bytes.includes(Buffer.from("IBM Plex")) && !bytes.includes(Buffer.from("P\0l\0e\0x")),
    "the renamed subset does not use the reserved name Plex");
  const notices = readFileSync(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8");
  for (const name of ["Fraunces", "DM Sans", "Manrope", "Newsreader", "Space Grotesk", "Orbit Coord Mono", "Reserved Font Name"]) {
    assert.ok(notices.includes(name), `${name} is in THIRD_PARTY_NOTICES.md`);
  }
});

test("type is measured from the real faces: wider copy measures wider", () => {
  assert.ok(measure("WWWWWWWW", "Fraunces", 700, 40) > measure("iiiiiiii", "Fraunces", 700, 40));
  assert.ok(measure("Scorpio", "Orbit Coord Mono", 400, 30) > 0);
  const fitted = fit("A fairly long headline that has to wrap onto several lines to fit", { family: "Fraunces", weight: 700, tiers: [80, 60], width: 500, maxLines: 6 });
  assert.equal(fitted.overflow, false);
  assert.ok(fitted.lines.every((l) => measure(l, "Fraunces", 700, fitted.size) <= 500));
  assert.equal(fit("word ".repeat(200), { family: "DM Sans", tiers: [30], width: 400, maxLines: 3 }).overflow, true, "overflow is flagged, never hidden");
});

/* ── Colour means something ───────────────────────────────────────────────── */

test("colour means a kind of post, so a 3x3 alternates: five kinds, five different colours per family", () => {
  assert.equal(kindFor({ eventType: "full_moon" }), "moon");
  assert.equal(kindFor({ eventType: "sun_ingress" }), "transit");
  assert.equal(kindFor({ eventType: "mercury_rx" }), "retrograde");
  assert.equal(kindFor({ eventType: "educational" }), "fact");
  assert.equal(kindFor({ eventType: "collective_reading", reading: { type: "monthly" } }), "monthly");
  assert.equal(kindFor({ eventType: "collective_reading", reading: { type: "weekly" } }), "transit");
  assert.equal(kindFor({ eventType: "collective_reading", reading: { type: "daily" } }), "moon");
  for (const id of STYLE_FAMILY_IDS) {
    const colours = KINDS.map((k) => accentFor(id, k));
    assert.equal(new Set(colours).size, KINDS.length, `${id}: every kind has its own colour`);
  }
  // The same post is a different colour per family, but always the family's own.
  assert.notEqual(accentFor("living_atlas", "moon"), accentFor("after_dark", "moon"));
});

test("accessibility: ink on page, muted text, and text on every accent fill clear WCAG", () => {
  for (const f of Object.values(STYLE_FAMILIES)) {
    assert.ok(contrastRatio(f.ink, f.page) >= 7, `${f.id}: ink on page`);
    assert.ok(contrastRatio(softOf(f.ink, f.page), f.page) >= 4.5, `${f.id}: muted text on page`);
    for (const [name, hex] of Object.entries(f.palette)) {
      const best = Math.max(contrastRatio(f.ink, hex), contrastRatio(f.paper, hex));
      assert.ok(best >= requiredContrast(30, 700), `${f.id}/${name}: large text on the fill reaches 3:1 (${best.toFixed(1)})`);
    }
  }
  assert.equal(requiredContrast(30, 400), 3);
  assert.equal(requiredContrast(20, 400), 4.5);
  assert.ok(contrastRatio("#000000", "#ffffff") > 20);
  assert.match(mix("#000000", "#ffffff", 0.5), /^#[0-9a-f]{6}$/);
});

/* ── Geometry of engine facts ─────────────────────────────────────────────── */

test("positions come from the engine's longitude, with sign plus degree as the fallback, and unknowns are dropped", () => {
  assert.equal(longitudeOf({ longitude: 227.0976 }), 227.0976);
  assert.equal(longitudeOf({ longitude: -10 }), 350, "wrapped, not invented");
  assert.equal(Math.floor(longitudeOf({ sign: "Scorpio", degrees: 17 })), 227);
  assert.equal(longitudeOf({ sign: "Nowhere", degrees: 3 }), null);
  const bodies = wheelBodies([{ name: "Sun", sign: "Scorpio", degrees: 17, longitude: 227.1 }, { name: "Chiron", sign: "Aries", degrees: 3 },
    { name: "Moon", sign: "Mystery", degrees: 1 }]);
  assert.deepEqual(bodies.map((b) => b.name), ["Sun"], "only known bodies with real positions are placed");
});

test("aspects are real: separations within a fixed orb, tightest first", () => {
  const found = aspectsAmong([{ name: "A", lon: 10 }, { name: "B", lon: 190.5 }, { name: "C", lon: 130 }, { name: "D", lon: 55 }]);
  assert.ok(found.some((x) => x.aspect === "opposition" && x.a.name === "A" && x.b.name === "B"));
  assert.ok(found.some((x) => x.aspect === "trine" && x.a.name === "A" && x.b.name === "C"));
  assert.ok(!found.some((x) => x.a.name === "A" && x.b.name === "D" && x.aspect), "45 degrees is not an aspect here");
  assert.deepEqual(aspectsAmong([{ name: "A", lon: 0 }]), []);
});

test("every diagram uses facts: no positions means no wheel, and a numeral needs a real date", () => {
  const T = TEMPLATES.living_atlas;
  const ctx = (facts, variant, eventType = "educational") => ({ design: normalizeDesign({ template: "living_atlas", variant, aspect: "portrait" }, eventType, "your_sky"),
    eventType, title: "T", facts, headline: "A headline", slide: { role: "hero", heading: "x", body: "" }, slideIndex: 0, total: 3 });
  assert.equal(renderStyledSlide(ctx({ ground: "g" }, 1), T).layout, "type", "a diagram cover with no positions falls back to type");
  assert.equal(renderStyledSlide(ctx({ ground: "g" }, 0), T).layout, "type", "a numeral cover with no date falls back to type");
  assert.equal(renderStyledSlide(ctx({ date: "2026-11-09" }, 0, "full_moon"), T).layout, "numeral");
  assert.equal(renderStyledSlide(ctx({ planets: [{ name: "Sun", sign: "Leo", degrees: 3 }] }, 1), T).layout, "diagram");
  assert.deepEqual(numeralFor({ facts: { date: "2026-11-09" }, eventType: "full_moon" }), { big: "9", note: "November" });
  assert.deepEqual(numeralFor({ facts: { period: { type: "weekly", start_date: "2026-11-09", end_date: "2026-11-15" } } }), { big: "9–15", note: "November" });
  assert.equal(numeralFor({ facts: { period: { type: "monthly", start_date: "2026-11-01" } } }).big, "NOV");
  assert.equal(numeralFor({ facts: {}, eventType: "educational" }), null);
  assert.equal(coordinateLine({ facts: {} }, []), "");
  assert.match(coordinateLine({ facts: { sky_at_event: { sun_sign: "Scorpio", sun_longitude: 227.1, moon_sign: "Scorpio", moon_longitude: 229.45 } } }, []), /SUN SCORPIO 17°/i);
});

test("the wheel draws a body where the engine put it", () => {
  const T = TEMPLATES.after_dark;
  const lon = 227.0976;
  const ctx = { design: normalizeDesign({ template: "after_dark", variant: 1, aspect: "portrait" }, "collective_reading", "daily_reading"), eventType: "collective_reading",
    title: "T", facts: { planets: [{ name: "Sun", sign: "Scorpio", degrees: 17, longitude: lon }], period: { type: "daily", start_date: "2026-11-09" } },
    headline: "H", reading: { type: "daily" }, slide: { role: "cover", heading: "x", body: "" }, slideIndex: 0, total: 3 };
  const { svg } = renderStyledSlide(ctx, T);
  const r = 360; // the portrait cover wheel
  const cx = 540;
  const cy = 218 + r;
  const inner = r * 0.52;
  const x = cx - inner * Math.cos((lon * Math.PI) / 180);
  const y = cy + inner * Math.sin((lon * Math.PI) / 180);
  assert.ok(svg.includes(`x1="${Math.round(x * 100) / 100}" y1="${Math.round(y * 100) / 100}"`), "the Sun's tick sits at its ecliptic longitude on the inner ring");
});

/* ── Rendering: every post type, both sizes, no overflow ─────────────────── */

function textRuns(svg) {
  const runs = [];
  for (const m of svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" font-family="([^"]*)" font-size="(\d+)" font-weight="(\d+)"([^>]*)>([^<]*)<\/text>/g)) {
    const family = m[3].split(",")[0].replace(/&#39;|['"]/g, "").trim();
    runs.push({ x: Number(m[1]), y: Number(m[2]), family, size: Number(m[4]), weight: Number(m[5]), attrs: m[6], text: m[7].replace(/&amp;/g, "&").replace(/&#39;/g, "'") });
  }
  return runs;
}

function assertInside(svg, w, h, label) {
  for (const t of textRuns(svg)) {
    const ls = Number(/letter-spacing="([\d.]+)"/.exec(t.attrs)?.[1] || 0);
    const width = measure(t.text.toUpperCase() === t.text ? t.text : t.text, t.family, t.weight, t.size, ls);
    const anchor = /text-anchor="(\w+)"/.exec(t.attrs)?.[1] || "start";
    const x0 = anchor === "end" ? t.x - width : anchor === "middle" ? t.x - width / 2 : t.x;
    assert.ok(x0 >= 30 && x0 + width <= w - 30, `${label}: "${t.text.slice(0, 40)}" runs off the slide (${Math.round(x0)}..${Math.round(x0 + width)} of ${w})`);
    assert.ok(t.y >= 20 && t.y <= h - 20, `${label}: "${t.text.slice(0, 40)}" is outside the slide vertically (${t.y})`);
  }
}

test("all three families render every channel format to PNG at 1080x1350, with nothing off the slide", async () => {
  const entryFor = { daily_reading: "daily", weekly_reading: "weekly", monthly_reading: "monthly", something_changed: "moon",
    calculated_not_invented: "method", without_the_fog: "method", your_sky: "fact" };
  let rasterized = 0;
  for (const family of STYLE_FAMILY_IDS) {
    for (const format of CHANNEL_FORMATS) {
      const entry = { ...example[entryFor[format]], formatId: format };
      for (const variant of [0, 1, 2]) {
        const { rendered } = renderExample(entry, { template: family, variant });
        assert.deepEqual(rendered.warnings, [], `${family}/${format}/v${variant}: no fitting or contrast warnings`);
        rendered.slides.forEach((s, i) => assertInside(s.svg, 1080, 1350, `${family}/${format}/v${variant}/slide ${i + 1}`));
      }
      // Rasterize every slide of one layout per format, through the real renderer.
      const { rendered } = renderExample(entry, { template: family, variant: FORMATS[format].readingType ? 1 : 0 });
      for (const slide of rendered.slides) {
        const png = await rasterizeSvg(slide.svg, { aspect: "portrait" });
        assert.deepEqual(pngDimensions(png), { width: 1080, height: 1350 });
        rasterized += 1;
      }
    }
  }
  assert.ok(rasterized >= 120, `rasterized ${rasterized} slides`);
});

test("square 1080x1080 renders too, for every family and format", async () => {
  for (const family of STYLE_FAMILY_IDS) {
    for (const [format, key] of [["something_changed", "moon"], ["weekly_reading", "weekly"], ["your_sky", "fact"], ["calculated_not_invented", "method"]]) {
      const { rendered } = renderExample({ ...example[key], formatId: format }, { template: family, variant: 2, aspect: "square" });
      assert.deepEqual(rendered.warnings, [], `${family}/${format}: no warnings in square`);
      rendered.slides.forEach((s, i) => assertInside(s.svg, 1080, 1080, `${family}/${format}/square slide ${i + 1}`));
      const png = await rasterizeSvg(rendered.slides[0].svg, { aspect: "square" });
      assert.deepEqual(pngDimensions(png), { width: 1080, height: 1080 });
    }
  }
});

test("long text fits or is flagged: format-maximum copy on every role, both aspects", () => {
  const entry = example.weekly;
  for (const family of STYLE_FAMILY_IDS) {
    for (const aspect of ["portrait", "square"]) {
      const design = normalizeDesign({ template: family, variant: 2, aspect }, entry.candidate.eventType, "weekly_reading");
      const base = examplePost(entry, design);
      const long = "Astrologers read this slow turn as a change of pace, and the symbolism is about attention rather than outcome, which is why the language stays careful. ".repeat(3).slice(0, 320);
      const post = { ...base, headline: "A very long reading headline that tests wrapping across lines", reading: { ...base.reading, theme: "A very long reading headline that tests wrapping across lines" },
        slides: base.slides.map((s) => (["cover", "one_sentence", "evidence"].includes(s.role) ? s : { ...s, body: long })) };
      const rendered = renderPost({ ...post, design }, { eventType: entry.candidate.eventType, title: entry.candidate.title, facts: entry.candidate.facts, sky: entry.candidate.facts.planets, design });
      const warnings = rendered.warnings;
      // Overflow is allowed only when it is NAMED; a silent run-off is not.
      rendered.slides.forEach((s, i) => assertInside(s.svg, 1080, aspect === "square" ? 1080 : 1350, `${family}/${aspect}/slide ${i + 1}`));
      assert.ok(warnings.every((w) => /too long|exceeds|too small|Low contrast/.test(w)), `${family}/${aspect}: ${warnings.join(" | ")}`);
      assert.deepEqual(warnings, [], `${family}/${aspect}: 320 characters per slide fits`);
    }
  }
});

test("rendering is deterministic: the same post draws the same bytes", () => {
  const a = renderExample(example.daily, { template: "cosmic_press", variant: 1 }).rendered.slides.map((s) => s.svg).join("");
  const b = renderExample(example.daily, { template: "cosmic_press", variant: 1 }).rendered.slides.map((s) => s.svg).join("");
  assert.equal(a, b);
});

test("what reads as AI-made is absent: no gradients, glass, sparkles, glossy planets, or one-face-everywhere", () => {
  for (const family of STYLE_FAMILY_IDS) {
    for (const key of ["moon", "daily", "fact", "monthly"]) {
      for (const variant of [0, 1, 2]) {
        const { rendered } = renderExample(example[key], { template: family, variant });
        for (const s of rendered.slides) {
          // Depth lives only inside marked assets (shaded forms, cast shadows):
          // no gradient fills the page or a panel, and nothing is glass or glow.
          const outsideAssets = s.svg.replace(/<g data-orbit-asset="[^"]*"[\s\S]*?<\/g><\/g>|<g data-orbit-asset="[^"]*"[\s\S]*?<\/g>/g, "");
          assert.doesNotMatch(outsideAssets.replace(/<defs>[\s\S]*?<\/defs>/g, ""), /Gradient|backdrop|mask=|glow/i, `${family}: no gradient outside an asset`);
          assert.doesNotMatch(s.svg, /backdrop|glow|glass/i, `${family}: no glass or glow`);
          for (const f of s.svg.match(/<filter id="[^"]*"/g) || []) assert.match(f, /orbit-shadow-|orbit-form-/, "filters are cast shadows or a body's own surface texture");
          assert.doesNotMatch(s.svg, /Inter[,'"]/, `${family}: not Inter`);
          assert.ok(!s.svg.includes("✨"), "no sparkle characters");
        }
      }
    }
  }
  const faces = new Set(Object.values(STYLE_FAMILIES).flatMap((f) => [f.display, f.text]));
  assert.ok(faces.size >= 5, "the families do not share one typeface");
  const rendered = renderExample(example.fact, { template: "living_atlas", variant: 2 }).rendered.slides.map((s) => s.svg).join("");
  assert.ok((rendered.match(/aria-label="Moon, /g) || []).length === 0, "no moon graphic on a post that is not about the Moon");
});

test("covers differ: three layouts per family, and the Moon is not on every post", () => {
  for (const family of STYLE_FAMILY_IDS) {
    const covers = [0, 1, 2].map((variant) => renderExample(example.monthly, { template: family, variant }));
    const layouts = covers.map((r) => {
      const svg = r.rendered.slides[0].svg;
      return /aria-label="Zodiac wheel/.test(svg) ? "diagram" : /font-size="(?:[2-4]\d\d)"/.test(svg) ? "numeral" : "type";
    });
    assert.deepEqual(layouts, ["numeral", "diagram", "type"], `${family}: numeral, diagram, type`);
    assert.equal(new Set(covers.map((r) => r.rendered.slides[0].svg)).size, 3);
  }
});

/* ── Copy, registry, picker, grid ─────────────────────────────────────────── */

test("post copy carries no em dash: the check blocks one, and the derived scaffolds contain none", () => {
  const entry = example.weekly;
  const design = normalizeDesign({ template: "living_atlas", aspect: "portrait" }, entry.candidate.eventType, "weekly_reading");
  const post = examplePost(entry, design);
  assert.equal(runPostChecks(post, { candidate: entry.candidate, autonomy: "yellow" }).checks.find((c) => c.id === "no_em_dash").passed, true);
  const bad = runPostChecks({ ...post, caption: "A calm week — and a clear one." }, { candidate: entry.candidate, autonomy: "yellow" });
  const check = bad.checks.find((c) => c.id === "no_em_dash");
  assert.equal(check.passed, false);
  assert.equal(bad.passed, false, "it blocks");
  const all = [];
  for (const key of ["moon", "transit", "retrograde", "fact", "method"]) {
    const e = example[key];
    all.push(JSON.stringify(buildScaffold(e.candidate, e.formatId).post));
  }
  for (const type of ["daily", "weekly", "monthly"]) {
    all.push(JSON.stringify(buildReadingScaffold(example[type].candidate, `${type}_reading`).post));
  }
  assert.ok(all.every((s) => !s.includes("—")), "no em dash in any derived scaffold copy");
  void calculateReadingPeriod;
});

test("the nine layouts are registered, carry every channel format, and start INACTIVE even when approved", () => {
  assert.equal(styledKeys.length, 9);
  assert.deepEqual([...DEFAULT_INACTIVE_KEYS].sort(), [...styledKeys].sort());
  for (const key of styledKeys) {
    const b = BUILTIN_POST_TYPES.find((x) => x.key === key);
    assert.deepEqual([...b.spec.formats].sort(), [...CHANNEL_FORMATS].sort());
    assert.equal(b.spec.aspect, "portrait");
    const { warnings, layout } = renderFingerprint(b.spec);
    assert.deepEqual([warnings, layout], [[], []], `${key} renders every format cleanly`);
  }
  assert.deepEqual(COVER_LAYOUTS, ["numeral", "diagram", "type"]);
  const approved = planRegistrySync([]).inserts.map((r, i) => ({ ...r, id: `id-${i}`, status: "approved" }));
  const states = templateStates(approved);
  for (const t of states.filter((x) => styledKeys.includes(x.typeKey))) {
    assert.equal(t.activatable, true, `${t.typeKey} can be activated`);
    assert.equal(t.active, false, `${t.typeKey} is not in the rotation until a person switches it on`);
  }
  assert.ok(!rotationTypes(states).some((t) => styledKeys.includes(t.typeKey)));
  assert.equal(states.find((t) => t.typeKey === "celestial_editorial").active, false, "Celestial Editorial stays inactive");
  const on = templateStates(approved, [{ type_key: "after_dark.diagram", active: true }]);
  assert.ok(rotationTypes(on).some((t) => t.typeKey === "after_dark.diagram"), "switching one on puts it in the rotation");
  assert.ok(on.filter((t) => t.active && styledKeys.includes(t.typeKey)).length === 1);
});

test("the profile grid preview: nine tiles, newest first, empty slots say so, crops like the profile", () => {
  const svg = renderExample(example.moon, { template: "after_dark", variant: 0 }).rendered.slides[0].svg;
  const page = gridPage([{ svg, label: "After Dark Observatory" }, { svg }], { title: "Grid", subtitle: "Example data" });
  assert.equal((page.match(/class="tile"/g) || []).length + (page.match(/class="tile empty"/g) || []).length, 9);
  assert.equal((page.match(/nothing queued/g) || []).length, 7);
  assert.match(page, /aspect-ratio:3\/4/);
  assert.match(coverFit(svg), /preserveAspectRatio="xMidYMid slice"/);
  assert.doesNotMatch(coverFit(svg).match(/^<svg[^>]*>/)[0], / width="1080" height="1350"/, "the root tag no longer pins a size");
  assert.match(page, /After Dark Observatory/);
});

test("the sample sheet is committed with the PR: every family, the overview, and the grid", () => {
  for (const family of STYLE_FAMILY_IDS) {
    for (const file of [`${family}-covers.png`, `${family}-carousel-daily.png`, `${family}-square.png`, `${family}-daily-diagram-cover.png`]) {
      assert.ok(existsSync(new URL(`../docs/orbit-x-samples/${file}`, import.meta.url)), `${file} is in docs/orbit-x-samples`);
    }
  }
  for (const file of ["overview.png", "grid-preview.png", "grid-preview.html"]) {
    assert.ok(existsSync(new URL(`../docs/orbit-x-samples/${file}`, import.meta.url)), `${file} is in docs/orbit-x-samples`);
  }
});

/* ── Depth: shadows, stars and shaded assets ─────────────────────────────── */

import { shadowFor, starField, moonSphere, assetFor, seeded } from "../lib/orbit-x/assets.js";

test("each family has its own shadow voice: soft paper, deep contact, hard print", () => {
  const kinds = Object.fromEntries(STYLE_FAMILY_IDS.map((id) => [id, shadowFor(id, STYLE_FAMILIES[id])]));
  assert.equal(kinds.living_atlas.kind, "soft");
  assert.equal(kinds.after_dark.kind, "contact");
  assert.equal(kinds.cosmic_press.kind, "hard");
  assert.equal(kinds.cosmic_press.blur, 0, "a print shadow has no blur");
  const press = renderExample(example.moon, { template: "cosmic_press", variant: 0 }).rendered.slides[0].svg;
  assert.doesNotMatch(press, /<filter/, "the press draws its shadow as a flat offset shape");
  const atlas = renderExample(example.moon, { template: "living_atlas", variant: 0 }).rendered.slides[0].svg;
  assert.match(atlas, /<filter id="orbit-shadow-\d+"/);
});

test("stars are a deterministic scatter that keeps clear of the wheel and the type", () => {
  const area = { x: 0, y: 0, w: 1080, h: 1350 };
  const avoid = [{ x: 200, y: 300, w: 680, h: 680 }];
  const a = starField(area, { seed: "post-1", count: 24, colour: "#fff", avoid });
  assert.equal(a, starField(area, { seed: "post-1", count: 24, colour: "#fff", avoid }), "the same post draws the same sky");
  assert.notEqual(a, starField(area, { seed: "post-2", count: 24, colour: "#fff", avoid }));
  const points = [...a.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])])
    .concat([...a.matchAll(/<path d="M([\d.]+) ([\d.]+)L/g)].map((m) => [Number(m[1]), Number(m[2])]));
  assert.ok(points.length >= 10);
  assert.ok(points.every(([x, y]) => !(x > 200 && x < 880 && y > 300 && y < 980)), "no star inside the avoided rectangle");
  assert.match(a, /aria-hidden="true"/, "decoration is hidden from assistive tech");
  const rnd = seeded("x");
  assert.ok(rnd() >= 0 && rnd() < 1);
});

test("the Moon sphere shows the engine's illumination, and every asset is vector", () => {
  const f = STYLE_FAMILIES.after_dark;
  const full = moonSphere({ id: "m1", cx: 100, cy: 100, r: 80, state: { illumination_percent: 100, waxing: true }, f });
  const none = moonSphere({ id: "m2", cx: 100, cy: 100, r: 80, state: { illumination_percent: 0, waxing: true }, f });
  const quarter = moonSphere({ id: "m3", cx: 100, cy: 100, r: 80, state: { illumination_percent: 50, waxing: false }, f });
  assert.match(full, /aria-label="Moon, 100% illuminated"/);
  assert.match(none, /Moon, 0% illuminated/);
  assert.match(none, /data-lit="0"/, "a new Moon has no lit area");
  assert.ok(/data-lit="100"/.test(full) && /data-lit="50"/.test(quarter));
  assert.equal(moonSphere({ id: "m4", cx: 0, cy: 0, r: 10, state: null, f }), "", "no illumination fact, no Moon");
  for (const svg of [full, none, quarter]) assert.doesNotMatch(svg, /<image|data:image|href=/, "no raster asset");
  assert.deepEqual(assetFor({ kind: "moon", eventType: "full_moon", facts: {} }), { type: "moon", state: { illumination_percent: 100, waxing: true } });
  assert.equal(assetFor({ kind: "transit", eventType: "sun_ingress", facts: {} }).body, "Sun");
  assert.equal(assetFor({ kind: "retrograde", eventType: "mercury_rx", facts: {} }).body, "Mercury");
  assert.equal(assetFor({ kind: "monthly", eventType: "collective_reading", facts: {} }).type, "ringed");
  assert.equal(assetFor({ kind: "fact", eventType: "educational", facts: {} }).type, "armillary");
  // Stored packets keep the Moon's own illumination.
  assert.deepEqual(assetFor({ kind: "moon", eventType: "collective_reading", facts: { illumination_percent: 31, is_waxing: true } }).state,
    { illumination_percent: 31, waxing: true });
});
