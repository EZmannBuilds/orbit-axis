import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_EDITORIAL_TIMEZONE, READING_TYPES, READING_FORMATS,
  calculateReadingPeriod, selectReadingEvents, buildReadingCandidate,
} from "../lib/orbit-x/readings.js";
import { buildReadingScaffold } from "../lib/orbit-x/language.js";
import { buildPacket } from "../lib/orbit-x/prompts.js";
import { validateGeneratedPost, draftCompleteness } from "../lib/orbit-x/schemas.js";
import {
  ASPECTS, TEMPLATES, TEMPLATE_FAMILY_IDS, READING_TEMPLATE_DEFAULTS,
  renderPost, normalizeDesign, recommendTemplate,
} from "../lib/orbit-x/templates.js";
import { orbitLogo } from "../lib/orbit-x/celestial.js";
import { auditCopy, verifyFactIntegrity } from "../lib/orbit-x/editorial.js";
import { handleOrbitXRoute } from "../lib/orbit-x/api.js";
import { READING_CONTEXT, READING_EVENTS } from "./fixtures/orbit-x-reading-fixtures.js";

test("reading periods are explicit, timezone-aware, and use exclusive UTC ends", () => {
  assert.equal(DEFAULT_EDITORIAL_TIMEZONE, "America/Chicago");
  const dst = calculateReadingPeriod("daily", "2026-03-08", DEFAULT_EDITORIAL_TIMEZONE);
  assert.equal(dst.key, "daily:2026-03-08");
  assert.equal(dst.start_utc, "2026-03-08T06:00:00.000Z");
  assert.equal(dst.end_utc, "2026-03-09T05:00:00.000Z", "spring-forward day is honestly 23 hours");
  assert.equal(dst.end_exclusive, true);

  const week = calculateReadingPeriod("weekly", "2026-08-20", DEFAULT_EDITORIAL_TIMEZONE);
  assert.equal(week.key, "weekly:2026-08-17:2026-08-23");
  assert.equal(week.start_date, "2026-08-17");
  assert.equal(week.end_date, "2026-08-23");
  assert.match(week.label, /^Aug 17–Aug 23, 2026$/);

  const month = calculateReadingPeriod("monthly", "2026-08-20", DEFAULT_EDITORIAL_TIMEZONE);
  assert.equal(month.key, "monthly:2026-08");
  assert.equal(month.label, "August 2026");
});

test("event curation selects supported movements inside the period and caps the narrative", () => {
  const month = calculateReadingPeriod("monthly", "2026-08-20");
  const noisy = [...READING_EVENTS, ...Array.from({ length: 12 }, (_, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, "0")}`, kind: "sun_ingress", title: `Movement ${i}`,
  })), { date: "2026-08-20", kind: "unsupported", title: "Do not promise this" }];
  const selected = selectReadingEvents("monthly", noisy, month);
  assert.equal(selected.length, 8);
  assert.ok(selected.every((event) => event.date >= "2026-08-01" && event.date <= "2026-08-31"));
  assert.ok(!selected.some((event) => event.kind === "unsupported"));
  assert.deepEqual(selected.map((event) => event.date), [...selected.map((event) => event.date)].sort());
});

function fixtureCandidate(type) {
  const period = calculateReadingPeriod(type, "2026-08-20");
  return buildReadingCandidate({ type, period, events: READING_EVENTS, context: READING_CONTEXT,
    skyAt: () => ({ moon: { sign: "Pisces", illumination_percent: 99.8, waxing: true }, sun: { sign: "Virgo" } }) });
}

test("Daily, Weekly, and Monthly share one reading schema with adaptive slide orders", () => {
  const expected = { daily: 6, weekly: 8, monthly: 10 };
  for (const type of READING_TYPES) {
    const candidate = fixtureCandidate(type);
    const format = READING_FORMATS[type];
    const { post: raw, suggestions } = buildReadingScaffold(candidate, format);
    const post = validateGeneratedPost(raw, format, { requireComplete: false });
    assert.equal(post.reading.type, type);
    assert.equal(post.reading.periodKey, candidate.eventKey);
    assert.equal(post.slides.length, expected[type]);
    assert.equal(post.slides[0].role, "cover");
    assert.equal(post.slides[1].role, "one_sentence");
    assert.equal(post.design.aspect, "portrait");
    assert.equal(suggestions.slides.length, post.slides.length);
    assert.equal(auditCopy(post).length, 0);
    assert.equal(verifyFactIntegrity(post, candidate.facts).length, 0);
    const incomplete = draftCompleteness(post);
    assert.ok(incomplete.missing.includes("theme"));
    assert.ok(incomplete.missing.includes("reading in one sentence"));
  }
});

test("a quiet week leaves the optional pivot empty instead of inventing an event", () => {
  const candidate = buildReadingCandidate({ type: "weekly",
    period: calculateReadingPeriod("weekly", "2026-08-20"), events: [], context: READING_CONTEXT });
  const { post } = buildReadingScaffold(candidate, "weekly_reading");
  const pivot = post.slides.find((slide) => slide.role === "pivot");
  assert.equal(pivot.body, "");
  assert.equal(draftCompleteness(post).missing.some((item) => item.includes("pivot")), false);
});

test("the five visual families are versioned, portrait-first, distinct, and share one reading", () => {
  assert.deepEqual(TEMPLATE_FAMILY_IDS, [
    "orbit_instrument", "celestial_editorial", "lunar_field", "planetary_grid", "orbit_signal",
  ]);
  const candidate = fixtureCandidate("daily");
  const { post: raw } = buildReadingScaffold(candidate, "daily_reading");
  const base = { ...raw, headline: "The pace changes before the plan does.",
    reading: { ...raw.reading, theme: "The pace changes before the plan does.",
      oneSentence: "One symbolic thread in today's sky is the value of noticing movement before naming its outcome." },
    slides: raw.slides.map((slide) => slide.role === "one_sentence"
      ? { ...slide, body: "One symbolic thread in today's sky is the value of noticing movement before naming its outcome." }
      : slide.role === "reading" ? { ...slide, body: "Editorial copy: the verified movements can be read as a change in pace, not a prediction about any one person." }
        : slide.role === "reflection" ? { ...slide, body: "What becomes clearer when the pace changes?" } : slide),
    caption: "Editorial collective-reading demo using verified Orbit sky data." };
  const svgs = [];
  let signalSlides = [];
  for (const id of TEMPLATE_FAMILY_IDS) {
    assert.equal(TEMPLATES[id].version, "v1");
    const design = normalizeDesign({ template: id }, candidate.eventType, base.format);
    assert.equal(design.aspect, "portrait");
    const rendered = renderPost({ ...base, design }, { eventType: candidate.eventType,
      title: candidate.title, facts: candidate.facts, sky: candidate.facts.planets, design });
    assert.equal(rendered.slides.length, 6);
    assert.match(rendered.slides[0].svg, new RegExp(`width="${ASPECTS.portrait.width}" height="${ASPECTS.portrait.height}"`));
    assert.match(rendered.slides[0].svg, /Orbit Axis/);
    assert.doesNotMatch(rendered.slides.map((slide) => slide.svg).join(""), />ORBIT AXIS<\/text>/,
      "exports use the mark without the wordmark");
    if (id === "orbit_signal") signalSlides = rendered.slides.map((slide) => slide.svg);
    svgs.push(rendered.slides[0].svg);
  }
  assert.equal(new Set(svgs).size, 5, "families are not relabelled copies");
  assert.ok(signalSlides.length);
  assert.match(signalSlides[0], /data-orbit-signal-season="Leo"/);
  assert.match(signalSlides[0], /aria-label="Leo season"/);
  assert.doesNotMatch(signalSlides[0], /aria-label="Moon,/,
    "Orbit Signal replaces the circular Moon hero with the current zodiac season");
  assert.doesNotMatch(signalSlides.join(""), /stroke="#4a28b8" stroke-width="3"/,
    "Orbit Signal omits the 62-degree line-and-dot motif");
  const square = renderPost({ ...base, design: { template: "orbit_instrument", aspect: "square" } },
    { eventType: candidate.eventType, title: candidate.title, facts: candidate.facts, sky: candidate.facts.planets });
  assert.match(square.slides[0].svg, /width="1080" height="1080"/);
});

test("founder-selected families map deterministically to each reading cadence", () => {
  assert.deepEqual(READING_TEMPLATE_DEFAULTS, {
    daily_reading: "lunar_field",
    weekly_reading: "planetary_grid",
    monthly_reading: "orbit_signal",
    special_reading: "orbit_signal",
  });
  assert.equal(recommendTemplate("collective_reading", "daily_reading"), "lunar_field");
  assert.equal(recommendTemplate("collective_reading", "weekly_reading"), "planetary_grid");
  assert.equal(recommendTemplate("collective_reading", "monthly_reading"), "orbit_signal");
  assert.equal(recommendTemplate("full_moon", "something_changed"), "orbit_signal");
});

test("the canonical logo lockup preserves mark geometry and accessible naming", () => {
  const mark = orbitLogo({ x: 20, y: 20 });
  assert.match(mark, /aria-label="Orbit Axis"/);
  assert.match(mark, /M37 115 91 13/);
  assert.match(mark, /ORBIT AXIS/);
});

test("Template Lab, library filters, and duplicate-period migration are present", () => {
  const page = readFileSync(new URL("../lib/orbit-x/ui.html", import.meta.url), "utf8");
  assert.match(page, /Founder Template Review/);
  assert.match(page, /Compare all five/);
  assert.match(page, /data-reading="daily"/);
  assert.match(page, /daily_reading/);
  assert.match(page, /data-open-post/);
  assert.match(page, /openSavedPost/);
  assert.match(page, /Draft updated/);
  assert.match(page, /method: "PATCH"/);
  const migration = readFileSync(new URL("../supabase/migrations/20260820200000_orbit_x_collective_readings.sql", import.meta.url), "utf8");
  assert.match(migration, /one_live_period/);
  assert.match(migration, /status in \('approved', 'exported', 'scheduled', 'published'\)/);
});

test("the generated zodiac collection contains twelve attributed OpenMoji designs", () => {
  const sheet = readFileSync(new URL("../public/brand/orbit-zodiac-glyphs.svg", import.meta.url), "utf8");
  assert.equal([...sheet.matchAll(/data-zodiac-sign=/g)].length, 12);
  assert.match(sheet, /data-zodiac-sign="Aries"/);
  assert.match(sheet, /data-zodiac-sign="Pisces"/);
  const leo = readFileSync(new URL("../public/brand/zodiac/leo.svg", import.meta.url), "utf8");
  assert.match(leo, /Orbit Leo zodiac sign/);
  assert.match(leo, /OpenMoji Zodiac artwork/);
  assert.match(leo, /<path d=/);
  assert.doesNotMatch(leo, /[♈-♓]/u, "assets do not depend on font-rendered zodiac characters");
  const source = readFileSync(new URL("../public/brand/zodiac/openmoji-source/2648.svg", import.meta.url), "utf8");
  assert.match(source, /id="line-supplement"/);
  assert.match(source, /m36 48\.84c3\.087-16\.36/);
  const attribution = readFileSync(new URL("../public/brand/zodiac/ATTRIBUTION.md", import.meta.url), "utf8");
  assert.match(attribution, /OpenMoji/);
  assert.match(attribution, /CC BY-SA 4\.0/);
});

test("the real reading endpoint and manual draft lane work with no AI key", async () => {
  const inserted = [];
  const store = {
    isAdmin: async () => true,
    coverageFor: async () => [],
    history: async () => [],
    insert: async (row) => { inserted.push(row); return { id: "11111111-2222-4333-8444-555555555555", ...row }; },
  };
  const env = { ORBIT_X_ENABLED: "true", ORBIT_X_EDITORIAL_TIMEZONE: "America/Chicago" };
  const auth = { ownerId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" };
  const query = new URLSearchParams("type=daily&date=2026-08-20");
  const reading = await handleOrbitXRoute("GET", "/api/orbit-x/readings", query, {}, auth, { env, store });
  assert.equal(reading.status, 200);
  assert.equal(reading.body.aiAvailable, false);
  assert.equal(reading.body.candidate.source, "orbit-engine");
  assert.equal(reading.body.period.key, "daily:2026-08-20");

  const manual = await handleOrbitXRoute("POST", "/api/orbit-x/manual", new URLSearchParams(), {
    eventKey: reading.body.candidate.eventKey, date: "2026-08-20", format: "daily_reading",
  }, auth, { env, store });
  assert.equal(manual.status, 200);
  assert.equal(manual.body.manual, true);
  assert.ok(manual.body.completeness.missing.includes("theme"));

  const saved = await handleOrbitXRoute("POST", "/api/orbit-x/posts", new URLSearchParams(), {
    eventKey: reading.body.candidate.eventKey, date: "2026-08-20", format: "daily_reading",
    copy: manual.body.post, generatedCopy: null,
  }, auth, { env, store });
  assert.equal(saved.status, 200);
  assert.equal(inserted[0].reading_type, "daily");
  assert.equal(inserted[0].period_key, "daily:2026-08-20");
  assert.equal(inserted[0].template_family, "lunar_field");
  assert.equal(inserted[0].template_version, "v1");
  assert.equal(inserted[0].generated_copy, null);
});

test("a generated reading gets its metadata from the engine, not the model", async () => {
  // The model returns publishable prose and NO `reading` object — which is
  // exactly what the packet tells it to do, and what used to fail validation.
  const modelPost = {
    format: "daily_reading",
    headline: "Let the Day Show Its Shape",
    slides: [
      { role: "cover", heading: "Daily reading", body: "" },
      { role: "one_sentence", heading: "Today in one sentence",
        body: "Today's sky holds a settled Moon against a Sun still early in its sign: enough light to see by, not yet enough to sort." },
      { role: "movements", heading: "What's moving",
        body: "Sun: 27 degrees Leo. Moon: 4 degrees Capricorn. Venus: 12 degrees Libra." },
      { role: "reading", heading: "The reading",
        body: "Astrologers traditionally associate Capricorn with structure and Leo with expression. With the Moon waxing, one symbolic reading is to notice which shape is forming before naming it." },
      { role: "reflection", heading: "Carry this with you",
        body: "What has taken on a shape clear enough to describe, but not yet one you would defend?" },
      { role: "evidence", heading: "Sky behind the reading",
        body: "Current sky: Sun 27 degrees Leo, Moon 4 degrees Capricorn, Venus 12 degrees Libra." },
    ],
    caption: "The Moon sits in Capricorn while the Sun is early in its sign. Traditionally, Capricorn is associated with structure. Held together, the day can invite reflection on what is taking shape. Positions calculated by the Orbit Axis engine; the symbolic reading is editorial.",
    cta: "",
    altText: "Orbit Axis daily reading carousel with a calculated Moon graphic, celestial glyphs, editorial copy and a current sky register.",
  };
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ content: [{ type: "text", text: JSON.stringify(modelPost) }],
      usage: { input_tokens: 10, output_tokens: 20 } }),
  });
  const store = { isAdmin: async () => true, coverageFor: async () => [], history: async () => [] };
  const env = {
    ORBIT_X_ENABLED: "true", ORBIT_X_EDITORIAL_TIMEZONE: "America/Chicago",
    ORBIT_X_AI_PROVIDER: "anthropic", ORBIT_X_AI_API_KEY: "test-key-not-a-real-secret",
  };
  const auth = { ownerId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" };

  const reading = await handleOrbitXRoute("GET", "/api/orbit-x/readings",
    new URLSearchParams("type=daily&date=2026-08-20"), {}, auth, { env, store });
  assert.equal(reading.body.aiAvailable, true, "a configured key must light the AI lane up for readings");

  const res = await handleOrbitXRoute("POST", "/api/orbit-x/generate", new URLSearchParams(), {
    eventKey: reading.body.candidate.eventKey, date: "2026-08-20", format: "daily_reading",
  }, auth, { env, store, fetchImpl });

  assert.equal(res.status, 200, `generation should pass validation, got: ${JSON.stringify(res.body.problems || res.body.error || "")}`);
  const { reading: meta } = res.body.post;
  assert.ok(meta, "the server must attach reading metadata the model never wrote");
  assert.equal(meta.type, "daily");
  assert.equal(meta.periodKey, "daily:2026-08-20", "period key is an engine fact, echoed by nobody");
  assert.equal(meta.periodLabel, reading.body.period.label);
  assert.equal(meta.theme, modelPost.headline, "theme mirrors the headline structurally");
  assert.equal(meta.oneSentence, modelPost.slides[1].body, "oneSentence mirrors the thesis slide structurally");
});

test("the packet asks a reading's writer for prose, never for period metadata", () => {
  const period = calculateReadingPeriod("daily", "2026-08-20", DEFAULT_EDITORIAL_TIMEZONE);
  const candidate = buildReadingCandidate({
    type: "daily", period,
    events: selectReadingEvents("daily", READING_EVENTS, period),
    context: READING_CONTEXT,
  });
  const packet = buildPacket(candidate, "daily_reading", []);
  assert.ok(packet.reading, "reading formats get a structural brief");
  assert.equal(packet.reading.readingType, "daily");
  assert.equal(packet.reading.periodLabel, period.label);
  assert.ok(!("periodKey" in packet.reading), "the key is never shown, so it can never be echoed wrong");
  assert.ok(packet.reading.structure.some((line) => line.includes("Do not output a \"reading\" object")),
    "the brief must tell the writer the metadata is not its to author");

  const moonPacket = buildPacket(candidate, "something_changed", []);
  assert.ok(!moonPacket.reading, "non-reading formats are untouched");
});

test("the desk offers Regenerate on readings once a key is configured", () => {
  const ui = readFileSync(new URL("../lib/orbit-x/ui.html", import.meta.url), "utf8");
  assert.match(ui, /\$\{aiAvailable \? `<button[^>]*id="e-regen"/,
    "the AI button must gate on the key alone — readings were excluded while their packet was unwired");
  assert.ok(!/aiAvailable && !isReading/.test(ui), "the reading exclusion should be gone");
});
