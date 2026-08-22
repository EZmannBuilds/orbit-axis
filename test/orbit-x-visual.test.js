// Orbit Axis :: Orbit X visual system and social content upgrade (Dev Update 5.1).
//
// THE RENDERER IS AN INSTRUMENT AND INSTRUMENTS GET CALIBRATED. Every mark is
// a deterministic function of engine facts: the Moon disc renders the
// illumination it was given, glyphs come from authored paths (never platform
// fonts), and copy that does not fit a template comes back FLAGGED, not
// silently shrunk. The suite also holds the 5.1 language contract: scaffolds
// are publishable-or-empty, worksheet text is a tripwire, and the exported
// SVG can never contain an authoring instruction or an invented fact.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PLANET_GLYPHS, ZODIAC_GLYPHS, PLANET_NAMES, ZODIAC_NAMES,
  planetGlyph, zodiacGlyph, retroGlyph, moonDisc, skyStrip,
  eventBadge, oppositionDiagram, ingressDiagram, MOON_MODES,
} from "../lib/orbit-x/celestial.js";
import {
  TOKENS, ASPECTS, ASPECT_IDS, DENSITIES, TEMPLATES, TEMPLATE_IDS,
  recommendTemplate, fitText, humanDate, utcTime, normalizeDesign,
  renderSlide, renderPost, SLIDE_ROLES, REQUIRED_ROLES, SAFE_LIMITS, TITLE_BANKS,
  BODY_SPECS, bodySpecFor, bodyCapacity,
} from "../lib/orbit-x/templates.js";
import {
  FRAMING_BANK, REFLECTION_EXAMPLES, CTA_CLASSES, pick,
  headlineOptions, factSentence, altTextFor, buildScaffold, symbolicSuggestions, signFromTitle,
  hookOptions, countWord,
} from "../lib/orbit-x/language.js";
import { FORMATS, FORMAT_IDS, ROLE_SEQUENCES, EXPANDABLE_ROLE, EDITORIAL_CTAS } from "../lib/orbit-x/formats.js";
import { auditCopy, adviseCopy, adviseRetention } from "../lib/orbit-x/editorial.js";
import { validateGeneratedPost, draftCompleteness } from "../lib/orbit-x/schemas.js";
import { buildCandidates } from "../lib/orbit-x/candidates.js";

/* ── Fixture posts (§77): engine-SHAPED, deterministic, one per family ──── */

const FULL_MOON = Object.freeze({
  eventKey: "full_moon:2026-08-27", eventType: "full_moon", title: "Full Moon",
  timestamp: "2026-08-28T04:18:33.000Z", approximate: false, source: "orbit-engine",
  facts: Object.freeze({ date: "2026-08-27", instant_utc: "2026-08-28T04:18:33.000Z",
    detail: "Peak illumination.", approximate: false,
    sky_at_event: Object.freeze({ computed_at_utc: "2026-08-28T04:18:33.000Z",
      moon_sign: "Pisces", sun_sign: "Virgo", moon_illumination_percent: 100, moon_waxing: false }) }),
});
const NEW_MOON = Object.freeze({
  eventKey: "new_moon:2026-09-10", eventType: "new_moon", title: "New Moon",
  timestamp: "2026-09-11T03:27:01.000Z", approximate: false, source: "orbit-engine",
  facts: Object.freeze({ date: "2026-09-10", instant_utc: "2026-09-11T03:27:01.000Z",
    detail: "Dark sky.", approximate: false,
    sky_at_event: Object.freeze({ computed_at_utc: "2026-09-11T03:27:01.000Z",
      moon_sign: "Virgo", sun_sign: "Virgo", moon_illumination_percent: 0, moon_waxing: true }) }),
});
const INGRESS = Object.freeze({
  eventKey: "sun_ingress:2026-08-23", eventType: "sun_ingress", title: "Sun enters Virgo",
  timestamp: "2026-08-23", approximate: false, source: "orbit-sky-tables",
  facts: Object.freeze({ date: "2026-08-23", instant_utc: null, detail: "Virgo season begins.", approximate: false }),
});
const STATION = Object.freeze({
  eventKey: "mercury_rx:2026-10-24", eventType: "mercury_rx", title: "Mercury stations retrograde",
  timestamp: "2026-10-24", approximate: true, source: "orbit-sky-tables",
  facts: Object.freeze({ date: "2026-10-24", instant_utc: null, detail: "Retrograde. (approximate)", approximate: true }),
});
const SKY = Object.freeze([
  { name: "Sun", sign: "Leo", degrees: 26, retrograde: false },
  { name: "Moon", sign: "Scorpio", degrees: 19, retrograde: false },
  { name: "Mercury", sign: "Leo", degrees: 18, retrograde: false },
  { name: "Venus", sign: "Libra", degrees: 3, retrograde: false },
  { name: "Mars", sign: "Cancer", degrees: 11, retrograde: false },
  { name: "Saturn", sign: "Aries", degrees: 2, retrograde: true },
]);
const DAILY = Object.freeze({
  eventKey: "daily_sky:2026-08-19", eventType: "daily_sky", title: "Today's sky — First Quarter",
  timestamp: "2026-08-19", approximate: false, source: "orbit-engine",
  facts: Object.freeze({ local_date: "2026-08-19", moon_phase_name: "First Quarter",
    illumination_percent: 44, is_waxing: true, moon_sign: "Scorpio",
    next_full_moon: "2026-08-27", next_new_moon: "2026-09-10", planets: SKY }),
});
const EDUCATIONAL = Object.freeze({
  eventKey: "educational:why-apps-disagree", eventType: "educational",
  title: "Why do astrology apps disagree?", timestamp: null, approximate: false,
  source: "orbit-editorial",
  facts: Object.freeze({ ground: "Same ephemeris, different house systems and zodiacs — a settings difference, not an error." }),
});
const FIXTURES = Object.freeze([FULL_MOON, NEW_MOON, INGRESS, STATION, DAILY, EDUCATIONAL]);

const noNonsense = (svg) => {
  assert.ok(!/NaN|undefined|null|\[object/.test(svg), "no unbound values leak into markup");
};

/* ── Moon renderer (§8–9) ───────────────────────────────────────────────── */

test("the Moon renders every canonical phase, continuously, from supplied data only", () => {
  const states = [
    ["new moon", 0, true], ["waxing crescent", 22, true], ["first quarter", 50, true],
    ["waxing gibbous", 78, true], ["full moon", 100, true], ["waning gibbous", 78, false],
    ["last quarter", 50, false], ["waning crescent", 22, false],
    ["continuous 44%", 44, true], ["continuous 91%", 91, false],
  ];
  const seen = new Set();
  for (const [name, pct, waxing] of states) {
    const svg = moonDisc({ illumination_percent: pct, waxing }, { mode: "inline" });
    assert.ok(svg.includes(`aria-label="Moon, ${Math.round(pct)}% illuminated"`), name);
    assert.ok(svg.includes(waxing ? "waxing" : "waning"), `${name} states its direction`);
    noNonsense(svg);
    seen.add(svg);
  }
  assert.equal(seen.size, states.length, "distinct states render distinct discs");
  // Boundaries: clamped, never inverted; missing data renders NOTHING.
  noNonsense(moonDisc({ illumination_percent: 130, waxing: true }));
  noNonsense(moonDisc({ illumination_percent: -5, waxing: false }));
  assert.equal(moonDisc({}), "", "no illumination fact = no moon, never a decorative one");
  assert.equal(moonDisc(null), "");
});

test("hero, inline, and mini moons derive from the same lunar state", () => {
  for (const mode of Object.keys(MOON_MODES)) {
    const svg = moonDisc({ illumination_percent: 61, waxing: false }, { mode });
    assert.ok(svg.includes("61% illuminated"), mode);
    assert.ok(svg.includes(`r="${MOON_MODES[mode].r}"`), `${mode} uses its designed radius`);
  }
});

/* ── Glyph systems (§6–7, §12) ──────────────────────────────────────────── */

test("all ten bodies and all twelve OpenMoji signs render as paths with labels", () => {
  assert.equal(PLANET_NAMES.length, 10);
  assert.deepEqual(ZODIAC_NAMES, ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
    "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"]);
  for (const name of PLANET_NAMES) {
    const g = planetGlyph(name, { size: 40 });
    assert.ok(g.includes(`<title>${name}</title>`), `${name} carries its accessible name`);
    assert.ok(/path|circle/.test(g), `${name} is drawn, not typed`);
    noNonsense(g);
  }
  for (const name of ZODIAC_NAMES) {
    const g = zodiacGlyph(name, { size: 40 });
    assert.ok(g.includes(`<title>${name}</title>`), name);
    assert.equal(ZODIAC_GLYPHS[name].strokeWidth, 3, `${name} retains OpenMoji's line weight`);
    assert.ok(ZODIAC_GLYPHS[name].codePoint, `${name} records its OpenMoji source code point`);
    noNonsense(g);
  }
  // Unknown bodies produce absence, never an invented mark.
  assert.equal(planetGlyph("Vulcan"), "");
  assert.equal(zodiacGlyph("Ophiuchus"), "");
  assert.ok(retroGlyph({}).includes("retrograde"), "the station mark is restrained and named");
});

/* ── Sky strip (§10) ────────────────────────────────────────────────────── */

test("the sky strip maps engine positions to glyph+sign and skips what it lacks", () => {
  const strip = skyStrip(SKY, { columns: 3, showDegree: true });
  assert.equal(strip.count, 6);
  assert.ok(strip.markup.includes("Leo 26°"), "degree rides along when asked");
  assert.ok(strip.markup.includes("retrograde"), "Saturn's state is marked, quietly");
  noNonsense(strip.markup);
  const selected = skyStrip(SKY, { bodies: ["Sun", "Moon"] });
  assert.equal(selected.count, 2, "the template chooses which bodies appear");
  assert.equal(skyStrip([]), "", "no data, no strip");
  assert.equal(skyStrip([{ name: "Krypton", sign: "Leo" }]), "", "unknown bodies are skipped silently");
});

/* ── Furniture ──────────────────────────────────────────────────────────── */

test("badges, opposition, and ingress grammar are drawn and labelled", () => {
  assert.ok(eventBadge("Full Moon").includes("FULL MOON"), "badges read as smallcap metadata");
  assert.ok(oppositionDiagram({}).includes("180°"), "a Full Moon has astronomical structure");
  const ing = ingressDiagram("Sun", "Virgo", {});
  assert.ok(ing.includes("Sun enters Virgo"));
  assert.equal(ingressDiagram("Sun", "Nowhere", {}), "", "no invented destination");
});

/* ── Text fitting (§17–18) ──────────────────────────────────────────────── */

test("text fitting steps tiers deterministically and flags overflow instead of shrinking forever", () => {
  const short = fitText("Full Moon in Pisces", { tiers: [96, 82, 68], maxLines: 3, width: 860, font: "serif" });
  assert.equal(short.size, 96, "short copy earns the largest tier");
  assert.equal(short.overflow, false);
  const longer = fitText("Why astrology apps disagree about your rising sign",
    { tiers: [96, 82, 68], maxLines: 3, width: 860, font: "serif" });
  assert.ok(longer.size < 96, "longer copy steps down");
  assert.equal(longer.overflow, false);
  const absurd = fitText(Array(60).fill("calculation").join(" "),
    { tiers: [96, 82, 68], maxLines: 3, width: 860, font: "serif" });
  assert.equal(absurd.overflow, true, "impossible copy is FLAGGED, not silently shrunk");
  assert.ok(absurd.lines.length <= 3, "and never rendered past the safe line count");
  assert.deepEqual(fitText("Full Moon in Pisces", { tiers: [96], maxLines: 3, width: 860 }),
    fitText("Full Moon in Pisces", { tiers: [96], maxLines: 3, width: 860 }), "same input, same fit");
  assert.deepEqual(fitText("", {}), { lines: [], size: 48, overflow: false });
});

/* ── Dates (§51) ────────────────────────────────────────────────────────── */

test("dates render for humans; exact instants stay UTC-labelled or absent", () => {
  assert.equal(humanDate("2026-08-27"), "August 27");
  assert.equal(humanDate("2026-08-27", { style: "short" }), "AUG 27");
  assert.equal(humanDate("garbage"), "");
  assert.equal(utcTime("2026-08-28T04:18:33.000Z"), "04:18 UTC");
  assert.equal(utcTime(null), "");
});

/* ── Template registry (§47, §61) ───────────────────────────────────────── */

test("templates are data: registry integrity and deterministic recommendation", () => {
  assert.ok(TEMPLATE_IDS.length >= 6);
  for (const t of Object.values(TEMPLATES)) {
    assert.ok(t.name && t.intendedUse, t.id);
    assert.ok(DENSITIES[t.density], `${t.id} names a designed density`);
    assert.ok(t.variants >= 1 && t.variants <= 4, `${t.id} has designed variants, not a slider`);
  }
  assert.equal(recommendTemplate("full_moon"), "lunar_hero");
  assert.equal(recommendTemplate("new_moon"), "lunar_hero");
  assert.equal(recommendTemplate("sun_ingress"), "planet_shift");
  assert.equal(recommendTemplate("mercury_rx"), "planet_shift");
  assert.equal(recommendTemplate("daily_sky"), "sky_grid");
  assert.equal(recommendTemplate("educational", "your_sky"), "sky_contrast");
  assert.equal(recommendTemplate("educational", "calculated_not_invented"), "instrument");
  assert.equal(recommendTemplate("educational"), recommendTemplate("educational"), "deterministic");
});

test("normalizeDesign sanitizes unknown values to designed defaults", () => {
  const d = normalizeDesign({ aspect: "banner", template: "canva", variant: 99, density: "extreme" }, "full_moon");
  assert.equal(d.aspect, "square");
  assert.equal(d.template, "lunar_hero");
  assert.equal(d.variant, 0);
  assert.ok(DENSITIES[d.density]);
});

/* ── Rendering (§15, §54–55, §46) ───────────────────────────────────────── */

test("every fixture renders every aspect with correct dimensions and no leaks", () => {
  for (const candidate of FIXTURES) {
    const formatId = candidate.eventType === "daily_sky" ? "daily_signal"
      : candidate.eventType === "educational" ? "without_the_fog" : "something_changed";
    const { post } = buildScaffold(candidate, formatId, {});
    // Slide one's body is the HOOK, not a paragraph: filling it with body copy
    // renders two lines where one belongs, and the renderer says so.
    const filled = { ...post, slides: post.slides.map((s) => s.body ? s : { ...s,
      body: ["hero", "cover"].includes(s.role) ? "One movement, calculated."
        : "Tradition reads this as a moment worth noticing — interpretation, not fate." }) };
    for (const aspectId of ASPECT_IDS) {
      const A = ASPECTS[aspectId];
      const rendered = renderPost({ ...filled, design: { aspect: aspectId } },
        { eventType: candidate.eventType, title: candidate.title, facts: candidate.facts,
          sky: candidate.facts.planets || SKY });
      assert.equal(rendered.slides.length, filled.slides.length, `${candidate.eventKey} ${aspectId}`);
      for (const { svg } of rendered.slides) {
        assert.ok(svg.startsWith("<svg "), "standalone SVG");
        assert.ok(svg.includes(`viewBox="0 0 ${A.width} ${A.height}"`), `${aspectId} has its own designed geometry`);
        assert.ok(svg.includes('aria-label="Orbit Axis"'), "the accessible brand mark survives every template");
        assert.ok(!svg.includes(">ORBIT AXIS</text>"), "the exported mark does not repeat the wordmark");
        noNonsense(svg);
        assert.ok(!/write th|edit this|edit me|placeholder/i.test(svg), "no authoring instruction can reach an export");
      }
      assert.deepEqual(rendered.warnings, [], `${candidate.eventKey} ${aspectId} fits its own templates`);
    }
  }
});

test("Full and New Moon are meaningfully different discs, not relabelled twins (§62)", () => {
  const full = renderPost(
    { ...buildScaffold(FULL_MOON, "something_changed", {}).post,
      design: { template: "lunar_hero" } },
    { eventType: "full_moon", title: FULL_MOON.title, facts: FULL_MOON.facts }).slides[0].svg;
  const dark = renderPost(
    { ...buildScaffold(NEW_MOON, "something_changed", {}).post,
      design: { template: "lunar_hero" } },
    { eventType: "new_moon", title: NEW_MOON.title, facts: NEW_MOON.facts }).slides[0].svg;
  assert.ok(full.includes("100% illuminated"));
  assert.ok(dark.includes("0% illuminated"));
  assert.notEqual(full.replace(/Full Moon in Pisces/g, "X"), dark.replace(/New Moon in Virgo/g, "X"));
});

test("slides carry role-specific layouts under one format's control (§46)", () => {
  const { post } = buildScaffold(FULL_MOON, "something_changed", {});
  const filled = { ...post, design: { ...post.design, template: "lunar_hero" },
    slides: post.slides.map((s) => s.body ? s : { ...s, body: "Attributed to tradition." }) };
  const r = renderPost(filled, { eventType: "full_moon", title: FULL_MOON.title, facts: FULL_MOON.facts });
  const [hero, fact, symbolic] = r.slides.map((s) => s.svg);
  assert.match(hero, /aria-label="Moon, [\d.]+% illuminated"/, "slide 1: hero Moon");
  assert.ok(fact.includes("180°"), "slide 2: the Sun–Moon opposition, drawn");
  assert.ok(symbolic.includes("PISCES"), "slide 3: the sign, named and drawn");
  assert.ok(hero.includes("FULL MOON"), "the event badge anchors slide 1");
  assert.ok(hero.includes("1/5") && symbolic.includes("3/5"), "page numbers are subtle but present");
});

test("overflow copy surfaces as a named warning through renderPost (§17)", () => {
  const { post } = buildScaffold(FULL_MOON, "something_changed", {});
  const bloated = { ...post, headline: "A very long headline that keeps going and refuses to respect any safe area at all whatsoever tonight" };
  const r = renderPost(bloated, { eventType: "full_moon", title: FULL_MOON.title, facts: FULL_MOON.facts });
  assert.ok(r.warnings.some((w) => /Headline exceeds/.test(w)), "the desk can SAY it does not fit");
});

/* ── Language system (§27–31, §34–35, §39–40, §43) ──────────────────────── */

test("the framing bank rotates attribution without erasing it", () => {
  for (const frame of FRAMING_BANK) {
    assert.match(frame, /astrolog|symbol|tradition/i, "every framing keeps the interpretive boundary");
  }
  const sugg = symbolicSuggestions("Pisces", ["imagination", "sensitivity", "intuition"], "full_moon:2026-08-27");
  assert.ok(sugg.length >= 1);
  assert.ok(sugg[0].includes("imagination, sensitivity, and intuition"));
  assert.equal(symbolicSuggestions(null, [], "x").length, 0, "no themes, no invented symbolism");
  assert.equal(pick(FRAMING_BANK, "same-seed"), pick(FRAMING_BANK, "same-seed"), "deterministic rotation");
});

test("headlines are short, active, and engine-grounded", () => {
  assert.equal(headlineOptions(FULL_MOON)[0], "Full Moon in Pisces");
  assert.equal(headlineOptions(NEW_MOON)[0], "New Moon in Virgo");
  assert.equal(headlineOptions(INGRESS)[0], "Virgo season begins");
  assert.equal(headlineOptions({ ...STATION, eventType: "mercury_direct" })[0], "Mercury is direct");
  for (const c of FIXTURES) {
    for (const h of headlineOptions(c)) assert.ok(h.length <= 60, h);
  }
  assert.equal(signFromTitle("Sun enters Virgo"), "Virgo");
  assert.equal(signFromTitle("nothing here"), null);
});

test("fact sentences speak human dates, honour 'around', and never invent", () => {
  assert.match(factSentence(FULL_MOON), /on August 27/);
  assert.match(factSentence(FULL_MOON), /in Pisces/);
  assert.match(factSentence(FULL_MOON), /opposite the Sun in Virgo/);
  assert.match(factSentence(STATION), /around October 24/);
  assert.match(factSentence(STATION), /never actually reverses/);
  assert.match(factSentence(DAILY), /44% illuminated and waxing/);
  assert.equal(factSentence(EDUCATIONAL), EDUCATIONAL.facts.ground);
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(factSentence(FULL_MOON)), "ISO stays in the facts panel");
});

test("alt text describes the actual graphic, not the symbolism (§53)", () => {
  const alt = altTextFor(FULL_MOON, "Full Moon in Pisces");
  assert.match(alt, /bright full Moon disc/);
  assert.match(alt, /August 27/);
  assert.match(alt, /Orbit Axis/);
  assert.ok(!/imagination|surrender|intuition/.test(alt), "no invisible symbolism in alt text");
});

test("CTA classes exist, are short, and never beg (§43)", () => {
  assert.ok(CTA_CLASSES.product.length >= 4);
  assert.deepEqual(CTA_CLASSES.editorial, [...EDITORIAL_CTAS]);
  for (const cta of [...CTA_CLASSES.product, ...CTA_CLASSES.editorial]) {
    assert.ok(cta.length <= SAFE_LIMITS.ctaChars, cta);
    assert.ok(!/comment|tag \w+ friends|share or/i.test(cta), cta);
  }
  for (const r of REFLECTION_EXAMPLES) {
    assert.match(r, /\?$/, "reflections are questions");
    assert.ok(!/will|going to/.test(r), "and never predictions");
  }
});

test("title banks provide coherent, non-random sequences (§40)", () => {
  assert.ok(TITLE_BANKS.fact.includes("What changed"));
  assert.ok(TITLE_BANKS.symbolic.includes("In astrology"));
  assert.ok(TITLE_BANKS.reflection.includes("Notice"));
  const a = buildScaffold(FULL_MOON, "something_changed", {}).post;
  const b = buildScaffold(FULL_MOON, "something_changed", {}).post;
  assert.deepEqual(a.slides.map((s) => s.heading), b.slides.map((s) => s.heading), "same event, same sequence");
});

/* ── Advisories (§36, §52) ──────────────────────────────────────────────── */

test("the social validator warns on weak copy without blocking it", () => {
  const base = buildScaffold(FULL_MOON, "something_changed", {}).post;
  const warnedFor = (patch) => adviseCopy({ ...base, ...patch }).map((a) => a.rule);
  assert.ok(warnedFor({ headline: "The calculated astronomical Full Moon event occurring in Pisces" })
    .includes("headline_long"));
  assert.ok(warnedFor({ slides: base.slides.map((s) => ({ ...s,
    body: "The Moon reaches full illumination and everything about this sentence repeats itself exactly." })) })
    .includes("duplicate_sentence"));
  assert.ok(warnedFor({ caption: "Astrologers traditionally associate this with x.",
    slides: [{ role: "fact", heading: "h", body: "Astrologers traditionally associate this with y." },
      ...base.slides.slice(1)] }).includes("repetitive_framing"));
  assert.ok(warnedFor({ slides: [{ role: "reflection", heading: "Notice", body: "What does this mean for you?" },
    ...base.slides.slice(1)] }).includes("generic_reflection"));
  assert.ok(warnedFor({ caption: "The Full Moon is tonight!" }).includes("relative_time"),
    "relative timing depends on the publication instant (§52)");
  // Scoped to the 5.1 social rules: the 5.4 retention rules are asserted in
  // their own test, and the scaffold trips `no_hook` there BY DESIGN — the
  // hook starts empty and the advisory is what asks for one.
  const RETENTION = new Set(["no_hook", "hero_paragraph", "slide2_restates_hero",
    "bare_cta_ending", "no_celestial_anchor"]);
  assert.deepEqual(
    adviseCopy(base).filter((a) => a.rule !== "headline_long" && !RETENTION.has(a.rule)), [],
    "the scaffold itself publishes clean against the social rules");
});

test("worksheet text is a BLOCKING tripwire, not an advisory", () => {
  const findings = auditCopy({ caption: "Astrologers associate this with — write the symbolic layer here." });
  assert.ok(findings.some((f) => f.rule === "worksheet"), "the old scaffold language can never be stored again");
});

/* ── Completeness (§33, §71–72) ─────────────────────────────────────────── */

test("completeness counts required sections and approves only finished work", () => {
  const { post } = buildScaffold(FULL_MOON, "something_changed", {});
  const v = validateGeneratedPost(post, "something_changed", { requireComplete: false });
  const c = draftCompleteness(v);
  assert.equal(c.complete, false);
  assert.ok(c.missing.some((m) => m.includes("symbolic")));
  assert.ok(c.missing.some((m) => m.includes("reflection")));
  assert.ok(!c.missing.some((m) => m.includes("hero")), "slide one needs no paragraph (§41)");
  assert.ok(!c.missing.some((m) => m.includes("cta")), "a post may end on the idea (§42)");
  const done = { ...v, slides: v.slides.map((s) => s.body ? s : { ...s, body: "In astrology, read as reflection." }) };
  assert.equal(draftCompleteness(done).complete, true);
});

test("role sequences match format contracts and the design object round-trips", () => {
  for (const [formatId, roles] of Object.entries(ROLE_SEQUENCES)) {
    const f = FORMATS[formatId];
    assert.ok(roles.length >= f.slides.min && roles.length <= f.slides.max, formatId);
    for (const role of roles) assert.ok(SLIDE_ROLES.includes(role), role);
  }
  assert.equal(EXPANDABLE_ROLE.without_the_fog, "explain");
  const v = validateGeneratedPost({
    format: "something_changed", headline: "Full Moon in Pisces",
    slides: ROLE_SEQUENCES.something_changed.map((role) => ({ role, heading: "h", body: "b" })),
    caption: "c", cta: "", altText: "a",
    design: { aspect: "portrait", template: "lunar_hero", variant: 1, density: "minimal",
      visuals: { moon: true }, metadata: { time: false }, evil: "dropped" },
  }, "something_changed");
  assert.equal(v.design.aspect, "portrait");
  assert.equal(v.design.evil, undefined, "unknown design keys never reach storage");
  assert.equal(v.slides[0].role, "hero", "roles survive validation");
  const junk = validateGeneratedPost({
    format: "something_changed", headline: "x",
    slides: ROLE_SEQUENCES.something_changed.map((role) => ({ role, heading: "h", body: "b" })),
    caption: "c", cta: "", altText: "a", design: { aspect: "cinema" },
  }, "something_changed");
  assert.equal(junk.design, undefined, "a design of nothing valid stores nothing");
});

/* ── Facts drive visuals; visuals never drive facts (§49–50) ────────────── */

test("lunation packets carry sky_at_event and the renderer trusts only that", () => {
  const events = [{ date: "2026-08-27", instant_utc: "2026-08-28T04:18:33.000Z",
    kind: "full_moon", title: "Full Moon 🌕", detail: "Peak illumination.", source: "orbit-axis-engine" }];
  const { candidates } = buildCandidates(events, null, {
    skyAt: () => ({ moon: { sign: "Pisces", illumination_percent: 100, waxing: false }, sun: { sign: "Virgo" } }),
  });
  const fm = candidates.find((c) => c.eventType === "full_moon");
  assert.equal(fm.facts.sky_at_event.moon_sign, "Pisces");
  assert.equal(fm.facts.sky_at_event.sun_sign, "Virgo");
  assert.equal(fm.facts.sky_at_event.computed_at_utc, "2026-08-28T04:18:33.000Z");
  // A failing engine lookup yields absence, not invention.
  const { candidates: bare } = buildCandidates(events, null, { skyAt: () => { throw new Error("nope"); } });
  assert.equal(bare.find((c) => c.eventType === "full_moon").facts.sky_at_event, undefined);
  // And an event with no exact instant never gets an exact-instant
  // enrichment: precision that is not there is not manufactured.
  const noInstant = [{ date: "2026-10-24", kind: "new_moon", title: "New Moon 🌑", detail: "Dark sky." }];
  const { candidates: ni } = buildCandidates(noInstant, null, { skyAt: () => ({ moon: { sign: "Libra" } }) });
  assert.equal(ni.find((c) => c.eventType === "new_moon").facts.sky_at_event, undefined);
});

test("the reading packet carries its own strip so a saved draft re-renders forever", async () => {
  // The synthetic daily_sky candidate retired with Dev Update 5.3; the Daily
  // Reading is that post now. The guarantee is unchanged and still matters:
  // the positions live IN the saved packet, so a draft opened months later
  // redraws exactly the sky it was written about.
  const { buildReadingCandidate, calculateReadingPeriod } = await import("../lib/orbit-x/readings.js");
  const context = { context_version: 1, local_date: "2026-08-19", moon_phase_name: "First Quarter",
    illumination_percent: 44, is_waxing: true, moon: { sign: "Scorpio" },
    planets: { Sun: { name: "Sun", sign: "Leo", degrees: 26, retrograde: false },
      Saturn: { name: "Saturn", sign: "Aries", degrees: 2, retrograde: true } } };
  const period = calculateReadingPeriod("daily", "2026-08-19", "America/Chicago");
  const daily = buildReadingCandidate({ type: "daily", period, events: [], context });
  assert.equal(daily.facts.planets.length, 2);
  assert.equal(daily.facts.planets[1].retrograde, true);
  assert.equal(daily.facts.moon_sign, "Scorpio");
  assert.equal(daily.readingType, "daily", "the period is on the candidate, not only in the key");
});


/* ── The hook line and retention advisories (Dev Update 5.4) ─────────────── */

test("hook options are packet-derived open loops, never invented and never bait", () => {
  const fm = hookOptions(FULL_MOON);
  assert.ok(fm.length >= 2);
  assert.ok(fm.some((h) => h.includes("Pisces") && h.includes("Virgo")),
    "the full moon hook states the real opposition the engine calculated");

  const nm = hookOptions(NEW_MOON);
  assert.ok(nm.some((h) => h.includes("Virgo")), "the new moon hook names the calculated sign");

  const weekly = hookOptions({ eventType: "collective_reading", readingType: "weekly",
    facts: { selected_events: [1, 2, 3] } });
  assert.ok(weekly[0].startsWith("Three "), "a count is spelled, and it is the REAL count");
  assert.ok(weekly[0].includes("this week"), "and it names the period it promises");

  // The count must follow the packet, not a template.
  const one = hookOptions({ eventType: "collective_reading", readingType: "daily",
    facts: { selected_events: [1] } });
  assert.ok(one[0].startsWith("One movement"), "singular when there is one");
  const quiet = hookOptions({ eventType: "collective_reading", readingType: "daily",
    facts: { selected_events: [] } });
  assert.ok(quiet[0].includes("quiet sky"), "an empty sky is an honest hook, not a manufactured one");

  // No hook may trip the constitution's tripwires.
  for (const candidate of [FULL_MOON, NEW_MOON]) {
    for (const hook of hookOptions(candidate)) {
      assert.equal(auditCopy({ caption: hook }).length, 0, hook);
      assert.ok(hook.length <= SAFE_LIMITS.hookChars, `"${hook}" fits one line`);
    }
  }
  assert.equal(countWord(3), "three");
  assert.equal(countWord(42), "42", "past the spelled range it stays a numeral");
  assert.deepEqual(hookOptions({ eventType: "educational", facts: {} }), [],
    "no packet basis, no hook — absence over invention");
});

test("the hook renders on slide one and is flagged when it stops being a hook", () => {
  const { post } = buildScaffold(FULL_MOON, "something_changed", {});
  const withHook = { ...post, slides: post.slides.map((s, i) =>
    i === 0 ? { ...s, body: "Full in Pisces, opposite the Sun in Virgo." } : s) };
  const r = renderPost(withHook, { eventType: "full_moon", title: FULL_MOON.title, facts: FULL_MOON.facts });
  assert.ok(r.slides[0].svg.includes("opposite the Sun in Virgo"), "the hook is drawn on the hero");
  assert.deepEqual(r.warnings, [], "and fits");

  const bloated = { ...post, slides: post.slides.map((s, i) =>
    i === 0 ? { ...s, body: "A hook line that simply will not stop going and keeps adding clause after clause until it is plainly a paragraph pretending to be a single line of type." } : s) };
  const over = renderPost(bloated, { eventType: "full_moon", title: FULL_MOON.title, facts: FULL_MOON.facts });
  assert.ok(over.warnings.some((w) => /hook line is too long/.test(w)),
    "an overlong hook is named, not silently shrunk");
});

test("retention advisories name the four ways a correct deck still fails", () => {
  const base = buildScaffold(FULL_MOON, "something_changed", {}).post;
  const rules = (post) => adviseRetention(post).map((a) => a.rule);

  // 1. No open loop.
  assert.ok(rules(base).includes("no_hook"), "an empty hero hook is flagged");

  // 2. A paragraph where a hook belongs — and the threshold is the RENDERER's
  //    hook limit, not a second opinion about it. They disagreed once (140 vs
  //    72) and copy that passed the advisory came out truncated on the slide.
  const wall = { ...base, slides: base.slides.map((s, i) => i === 0
    ? { ...s, body: "x".repeat(SAFE_LIMITS.hookChars + 40) } : s) };
  assert.ok(rules(wall).includes("hero_paragraph"));
  const justFits = { ...base, slides: base.slides.map((s, i) => i === 0
    ? { ...s, body: "y".repeat(SAFE_LIMITS.hookChars) } : s) };
  assert.ok(!rules(justFits).includes("hero_paragraph"),
    "exactly the renderable length is fine — the advisory and the renderer agree");

  // 3. Slide 2 spends the swipe and returns nothing.
  const echoed = { ...base, headline: "Full Moon in Pisces",
    slides: base.slides.map((s, i) => i === 0 ? { ...s, body: "The Moon is full in Pisces." }
      : i === 1 ? { ...s, body: "The Moon is full in Pisces." } : s) };
  assert.ok(rules(echoed).includes("slide2_restates_hero"));

  // 4. Ending on a pitch with nothing landed.
  const pitch = { ...base, slides: [
    { role: "hero", heading: "h", body: "Full in Pisces." },
    { role: "fact", heading: "f", body: "The Moon reaches full illumination." },
    { role: "cta", heading: "Orbit Axis", body: "See your sky in Orbit Axis." },
  ] };
  assert.ok(rules(pitch).includes("bare_cta_ending"));
  const landed = { ...pitch, slides: [
    pitch.slides[0], pitch.slides[1],
    { role: "reflection", heading: "Notice", body: "What feels clearer now?" },
    pitch.slides[2],
  ] };
  assert.ok(!rules(landed).includes("bare_cta_ending"), "a closed idea before the invitation passes");

  // 5. Nothing to look at.
  const blind = { ...base, design: { visuals: { moon: false, strip: false, diagram: false } } };
  assert.ok(rules(blind).includes("no_celestial_anchor"));

  // A finished deck with a hook trips none of them.
  const good = { ...base,
    slides: base.slides.map((s) => s.role === "hero" ? { ...s, body: "Full in Pisces, opposite the Sun in Virgo." }
      : s.body ? s : { ...s, body: "In astrology, this is read as a culmination — attributed to tradition." }) };
  assert.deepEqual(rules(good), [], "a complete, anchored, looped deck is clean");

  // And they are ADVISORIES: adviseCopy folds them in without ever blocking.
  assert.ok(adviseCopy(base).some((a) => a.rule === "no_hook"));
});

test("the handoff brief carries facts and rules, and nothing personal", () => {
  const page = readFileSync(new URL("../lib/orbit-x/ui.html", import.meta.url), "utf8");
  assert.match(page, /function handoffBrief\(/);
  assert.match(page, /VERIFIED FACTS \(read-only\)/, "the brief marks the facts unwritable");
  assert.match(page, /CONSTITUTION/, "the editorial rules travel with the words");
  // The import is treated as untrusted: parsed leniently, fact-checked before
  // it can touch a field.
  assert.match(page, /function importedInventsFacts\(/);
  assert.match(page, /appears in no verified fact/, "an invented date is refused by name");
  assert.ok(!/ownerId|accessToken|session|natal|birth/i.test(
    page.slice(page.indexOf("function handoffBrief("), page.indexOf("function parseHandoff("))),
    "the brief carries no account or natal material");
});


test("a reading's first two slides are editable, or their copy has nowhere to land", () => {
  // cover maps to the hero layout and the renderer draws its body as the hook,
  // but the reading editor renders named fields (theme, one-sentence, cover
  // hook) instead of the indexed textareas. When those disagreed, an import
  // wrote into elements that did not exist and reported success — the copy
  // vanished and the no_hook advisory could never be satisfied.
  const page = readFileSync(new URL("../lib/orbit-x/ui.html", import.meta.url), "utf8");
  assert.match(page, /id="e-hook"/, "a reading has a field for its cover hook");
  assert.match(page, /function slideBodyField\(/,
    "one resolver decides where a body lives, so readCopy and the importer cannot disagree");
  assert.match(page, /COULD NOT PLACE/,
    "text with no field is named, never dropped quietly");
  // The importer must consult the resolver rather than reaching for [data-sb].
  const importer = page.slice(page.indexOf("function applyHandoff("), page.indexOf("function copyText("));
  assert.match(importer, /slideBodyField\(slide, i\)/);
  assert.match(importer, /headlineField\(\)/);
  assert.ok(!/querySelector\(`\[data-sb=/.test(importer),
    "no direct field lookup survives in the importer");
});

/* ── What a slide can hold (Dev Update 5.5) ─────────────────────────────── */

const READING_FACTS = Object.freeze({
  period: Object.freeze({ type: "daily", key: "daily:2026-08-22", label: "August 22, 2026",
    timezone: "America/Chicago", start_date: "2026-08-22", end_date: "2026-08-22" }),
  local_date: "2026-08-22", moon_phase_name: "Waxing Gibbous", illumination_percent: 69.5,
  is_waxing: true, moon_sign: "Sagittarius", selected_events: Object.freeze([]),
  planets: Object.freeze([
    { name: "Sun", sign: "Leo", degrees: 29, retrograde: false },
    { name: "Moon", sign: "Sagittarius", degrees: 22, retrograde: false },
    { name: "Mercury", sign: "Leo", degrees: 23, retrograde: false },
    { name: "Venus", sign: "Libra", degrees: 14, retrograde: false },
    { name: "Mars", sign: "Cancer", degrees: 7, retrograde: false },
    { name: "Jupiter", sign: "Leo", degrees: 11, retrograde: false },
    { name: "Saturn", sign: "Aries", degrees: 14, retrograde: true },
    { name: "Uranus", sign: "Gemini", degrees: 5, retrograde: false },
    { name: "Neptune", sign: "Aries", degrees: 3, retrograde: true },
    { name: "Pluto", sign: "Aquarius", degrees: 3, retrograde: true },
  ]),
});

const readingPost = (bodies) => ({
  format: "daily_reading", headline: "A daily reading",
  reading: { type: "daily", theme: "A daily reading", oneSentence: bodies.one_sentence || "",
    periodLabel: READING_FACTS.period.label },
  slides: ROLE_SEQUENCES.daily_reading.map((role) => ({ role, heading: "", body: bodies[role] || "" })),
  caption: "", cta: "", altText: "",
});

const renderReading = (bodies, design = {}) => renderPost({ ...readingPost(bodies), design },
  { eventType: "collective_reading", title: "Daily Reading", facts: READING_FACTS, sky: READING_FACTS.planets });

/** Where the drawn body copy ends, and where the positions grid begins. */
function bodyAndStrip(svg) {
  const strip = /<g transform="translate\((?:[\d.]+) ([\d.]+)\)" aria-label="Current sky positions"/.exec(svg);
  const before = strip ? svg.slice(0, strip.index) : svg;
  const ys = [...before.matchAll(new RegExp(`<text[^>]*fill="${TOKENS.body}"[^>]*>`, "g"))]
    .map((m) => Number(/\by="(-?[\d.]+)"/.exec(m[0])[1]));
  return { bodyBottom: ys.length ? Math.max(...ys) : null, stripTop: strip ? Number(strip[1]) : null };
}

test("body copy is fitted to the room the positions grid leaves, never drawn through it", () => {
  // The grid is calculated; the prose is not. So the grid keeps its space and
  // the copy fits above it. Seven lines of body used to print straight over
  // the ten positions with no warning of any kind — the render was wrong AND
  // silent, which is the pair this renderer exists to make impossible.
  const long = "Sun 29 Leo, Mercury 23 Leo and Jupiter 11 Leo share a sign. The Moon is at 22 "
    + "Sagittarius, Waxing Gibbous, 69.5% illuminated and still growing. Saturn (14 Aries), "
    + "Neptune (3 Aries) and Pluto (3 Aquarius) are retrograde. No exact events are listed for today.";
  const r = renderReading({ movements: long, evidence: long });
  for (const i of [2, 5]) {
    const { bodyBottom, stripTop } = bodyAndStrip(r.slides[i].svg);
    assert.ok(stripTop, `slide ${i + 1} draws the calculated positions`);
    assert.ok(bodyBottom < stripTop, `slide ${i + 1} body clears the grid (${bodyBottom} < ${stripTop})`);
  }

  // And copy that cannot fit that room is NAMED, not quietly cropped.
  const flood = { movements: Array(40).fill("retrograde").join(" ") };
  assert.ok(renderReading(flood).warnings.some((w) => /Slide 3 body exceeds the safe area/.test(w)),
    "unfittable copy is flagged");
});

test("fitText obeys the vertical room a region states, not just its line count", () => {
  const text = Array(40).fill("word").join(" ");
  const tall = fitText(text, { tiers: [44], maxLines: 8, width: 860, font: "sans", lineGap: 1.4 });
  const short = fitText(text, { tiers: [44], maxLines: 8, width: 860, font: "sans", lineGap: 1.4, maxHeight: 200 });
  assert.ok(short.lines.length < tall.lines.length, "a shorter region takes fewer lines");
  assert.ok(short.lines.length * 44 * 1.4 <= 200 + 44, "and the block stays inside the room it was given");
  assert.equal(short.overflow, true, "the copy that did not fit is flagged, not dropped in silence");
  assert.deepEqual(fitText(text, { tiers: [44], maxLines: 8, width: 860, maxHeight: Infinity }).lines,
    tall.lines, "no stated height is the historical behaviour, unchanged");
});

test("bodyCapacity reports the geometry the renderer actually draws with", () => {
  // One source of truth: the specs the renderer fits with are the specs the
  // desk quotes. A budget nobody can verify is how 300-character copy got
  // written for a 72-character hook.
  for (const role of ["cover", "one_sentence", "movements", "reading", "reflection", "evidence"]) {
    const spec = bodySpecFor(role);
    assert.ok(BODY_SPECS[Object.keys(BODY_SPECS).find((k) => BODY_SPECS[k] === spec)],
      `${role} resolves to a designed spec`);
    // The budget a writer is given is the smaller of the two limits: what the
    // format allows and what the slide can physically keep.
    const capacity = Math.min(FORMATS.daily_reading.limits.slideBody,
      bodyCapacity(role, { aspect: "portrait" }));
    assert.ok(capacity > 0, `${role} has a real budget`);
    const atCapacity = "notice ".repeat(Math.floor(capacity / 7)).trim();
    const r = renderReading({ [role]: atCapacity });
    assert.deepEqual(r.warnings, [], `${role} copy written to its stated budget fits`);
  }
  assert.equal(bodyCapacity("cover"), SAFE_LIMITS.hookChars, "the cover slot is the hook budget");
  assert.ok(bodyCapacity("movements", { aspect: "square" }) < bodyCapacity("movements", { aspect: "portrait" }),
    "a square slide has less room, and says so");
});

test("the desk quotes the slide's budget, not one flat number per format", () => {
  const page = readFileSync(new URL("../lib/orbit-x/ui.html", import.meta.url), "utf8");
  assert.match(page, /bodyCapacity/, "the editor reads the renderer's capacity");
  const brief = page.slice(page.indexOf("function handoffBrief("), page.indexOf("function parseHandoff("));
  assert.match(brief, /maxCharacters: budgetFor\(slide\.role\)/, "per slot, per role");
  assert.match(page, /function budgetFor\(role\)[\s\S]{0,400}Math\.min\(/,
    "the budget is the smaller of the format ceiling and what the slide holds");
});

test("the desk script parses — a grep-only suite cannot see a broken brace", () => {
  // Every other assertion about this page is a regex over its source, which
  // is exactly how a syntax error inside a template literal ships green. This
  // one PARSES the module: imports resolve only in the browser, so they are
  // stripped and the remaining program is compiled without being run.
  const page = readFileSync(new URL("../lib/orbit-x/ui.html", import.meta.url), "utf8");
  const open = page.indexOf('<script type="module">');
  assert.ok(open > -1, "the desk ships one module script");
  const body = page.slice(page.indexOf(">", open) + 1, page.lastIndexOf("</script>"));
  const program = body.replace(/^import[\s\S]*?from\s+"[^"]+";$/gm, "");
  assert.doesNotThrow(() => new Function(program), "the desk script is valid JavaScript");
});

test("the hero's celestial anchor clears its headline in every aspect", () => {
  // Slide one is bottom-clamped: a tall copy block reaches UP. The disc used
  // to be laid out at one radius (285) and drawn at another (200), so the
  // clearance the hero calculated was never the clearance on screen — the
  // headline printed across the lit half of the Moon, perfectly rendered and
  // unreadable. Copy is measured first now; the disc takes the room that is
  // left, and says so when there is none.
  const bodies = { cover: "Most of this sky is moving forward. Three slow planets are not." };
  for (const aspect of ASPECT_IDS) {
    const r = renderReading(bodies, { aspect });
    const svg = r.slides[0].svg;
    const disc = /<g transform="translate\((?:[\d.]+) ([\d.]+)\)" role="img" aria-label="Moon[^"]*">.*?r="([\d.]+)"/.exec(svg);
    assert.ok(disc, `${aspect} draws the calculated Moon on slide one`);
    const discBottom = Number(disc[1]) + Number(disc[2]);
    const headline = /<text x="[\d.]+" y="([\d.]+)" font-family="Georgia[^"]*" font-size="([\d.]+)"/.exec(svg);
    assert.ok(headline, `${aspect} draws the headline`);
    const capTop = Number(headline[1]) - Number(headline[2]);
    assert.ok(discBottom < capTop, `${aspect}: the disc ends (${discBottom}) above the headline (${capTop})`);
    assert.deepEqual(r.warnings, [], `${aspect} hero fits`);
  }
});
