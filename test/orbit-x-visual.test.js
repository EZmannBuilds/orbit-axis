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

import {
  PLANET_GLYPHS, ZODIAC_GLYPHS, PLANET_NAMES, ZODIAC_NAMES,
  planetGlyph, zodiacGlyph, retroGlyph, moonDisc, skyStrip,
  eventBadge, oppositionDiagram, ingressDiagram, MOON_MODES,
} from "../lib/orbit-x/celestial.js";
import {
  TOKENS, ASPECTS, ASPECT_IDS, DENSITIES, TEMPLATES, TEMPLATE_IDS,
  recommendTemplate, fitText, humanDate, utcTime, normalizeDesign,
  renderSlide, renderPost, SLIDE_ROLES, REQUIRED_ROLES, SAFE_LIMITS, TITLE_BANKS,
} from "../lib/orbit-x/templates.js";
import {
  FRAMING_BANK, REFLECTION_EXAMPLES, CTA_CLASSES, pick,
  headlineOptions, factSentence, altTextFor, buildScaffold, symbolicSuggestions, signFromTitle,
} from "../lib/orbit-x/language.js";
import { FORMATS, FORMAT_IDS, ROLE_SEQUENCES, EXPANDABLE_ROLE, EDITORIAL_CTAS } from "../lib/orbit-x/formats.js";
import { auditCopy, adviseCopy } from "../lib/orbit-x/editorial.js";
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
    const filled = { ...post, slides: post.slides.map((s) => s.body ? s : { ...s,
      body: "Tradition reads this as a moment worth noticing — interpretation, not fate." }) };
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
  assert.ok(hero.includes('r="200"'), "slide 1: hero Moon");
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
  assert.deepEqual(adviseCopy(base).filter((a) => a.rule !== "headline_long"), [],
    "the scaffold itself publishes clean");
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
