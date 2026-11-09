// Orbit Axis :: Orbit X automatic channel, the parts that decide (Dev Update 6.1).
//
// The rules that keep an unattended channel honest: what a post type may be,
// how approval binds to what was seen, how the rotation keeps the feed from
// repeating itself, what the policy refuses, and that the renderer produces
// the desk's own files. No database, no network: fakes only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { FORMATS } from "../lib/orbit-x/formats.js";
import {
  CHANNEL_FORMATS, READING_FORMAT_IDS, TEMPLATE_FORMATS, BUILTIN_POST_TYPES, HOOK_STYLES, CAPTION_STRUCTURES,
  validatePostTypeSpec, specHash, renderFingerprint, planRegistrySync, usability, designForType,
  renderTypeSample, typeLabel, TYPE_TRANSITIONS, fixtureCandidates, samplePost,
} from "../lib/orbit-x/post-types.js";
import { choosePlan, resolveRotation, nearDuplicate, DEFAULT_ROTATION, seeded } from "../lib/orbit-x/rotation.js";
import { runPostChecks, autonomyAllowed, autonomyFor, verifyHumanDates, channelBrief } from "../lib/orbit-x/policy.js";
import { normalizeDesign, renderPost, sanitizeMotif, motifLayer, ASPECTS } from "../lib/orbit-x/templates.js";
import { validateGeneratedPost } from "../lib/orbit-x/schemas.js";
import { layoutCollisions, postCollisions } from "../lib/orbit-x/layout-check.js";
import { rasterizePost, slideFilename, pngDimensions, jpegDimensions } from "../lib/orbit-x/raster.js";
import { channelOptions, EVERGREEN_TOPICS, evergreenCandidate } from "../lib/orbit-x/channel-candidates.js";
import { channelConfig, killSwitchEngaged, channelEnabled } from "../lib/orbit-x/channel-config.js";
import { buildPacket } from "../lib/orbit-x/prompts.js";
import { HOUSE_SYSTEMS } from "../lib/charts/service.js";

const clone = (v) => JSON.parse(JSON.stringify(v));
const builtin = (key) => BUILTIN_POST_TYPES.find((b) => b.key === key);

/* ── The registry ─────────────────────────────────────────────────────────── */

test("the channel carries Green and Yellow formats only; Red does not exist here", () => {
  for (const id of CHANNEL_FORMATS) {
    assert.ok(FORMATS[id], `${id} is a real format`);
    assert.ok(["green", "yellow"].includes(FORMATS[id].autonomyRisk), `${id} is green or yellow`);
  }
  assert.equal(autonomyFor("no_such_format"), "red", "an unknown format is treated as red");
  assert.deepEqual(autonomyAllowed("red", { yellow: true }), { allowed: false, reason: "red: never autonomous" });
  assert.equal(autonomyAllowed("yellow", { yellow: false }).allowed, false, "yellow needs its own flag");
  assert.equal(autonomyAllowed("yellow", { yellow: true }).allowed, true);
  assert.equal(autonomyAllowed("green").allowed, true);
});

test("every built-in type is valid, fits, and keeps text off the mark and off other text", () => {
  assert.equal(BUILTIN_POST_TYPES.length, 14);
  assert.equal(new Set(BUILTIN_POST_TYPES.map((b) => b.key)).size, 14, "keys are unique");
  for (const b of BUILTIN_POST_TYPES) {
    assert.equal(validatePostTypeSpec(b.spec).ok, true, `${b.key} validates`);
    const { warnings, layout } = renderFingerprint(b.spec);
    assert.deepEqual(warnings, [], `${b.key} renders without fitting warnings`);
    assert.deepEqual(layout, [], `${b.key} has no layout collisions`);
  }
  // Every channel format has at least one built-in to rotate through.
  for (const id of CHANNEL_FORMATS) {
    assert.ok(BUILTIN_POST_TYPES.some((b) => b.spec.formats.includes(id)), `${id} has a built-in type`);
  }
});

test("the spec vocabulary is closed: unknown or unsafe values are refused, never coerced", () => {
  const base = clone(builtin("lunar_field").spec);
  const refuse = (mutate, pattern) => {
    const raw = clone(base);
    mutate(raw);
    const result = validatePostTypeSpec(raw);
    assert.equal(result.ok, false, `expected refusal for ${pattern}`);
    assert.ok(result.problems.some((p) => pattern.test(p)), `${result.problems.join(" | ")} should mention ${pattern}`);
  };
  refuse((r) => { r.svg = "<svg/>"; }, /unknown spec key "svg"/);
  refuse((r) => { r.formats = ["natal_reading"]; }, /not a channel format/);
  refuse((r) => { r.formats = ["something_changed"]; }, /not designed for something_changed/);
  refuse((r) => { r.aspect = "square"; }, /square type cannot carry/);
  refuse((r) => { r.design.metadata.calculated = false; }, /calculated label cannot be switched off/);
  refuse((r) => { r.design.visuals = { moon: false, strip: false, diagram: false }; }, /at least one celestial visual/);
  refuse((r) => { r.motif = { kind: "orbit_rings", tone: "#ff0000", placement: "top_right", intensity: "subtle" }; }, /not a brand token/);
  refuse((r) => { r.voice.hookStyles = ["clickbait"]; }, /hook style "clickbait" is unknown/);
  refuse((r) => { r.familyVersion = "v0"; }, /not the current/);
  const event = clone(builtin("lunar_hero").spec);
  event.design.logoPosition = "footer_left";
  assert.match(validatePostTypeSpec(event).problems.join(" "), /upper corner/,
    "a footer mark is refused wherever the footer metadata line is drawn");
});

test("the spec hash is canonical: key order and set order do not change it", () => {
  const spec = clone(builtin("orbit_signal").spec);
  const shuffled = { voice: { captionStructures: [...spec.voice.captionStructures].reverse(),
    hookStyles: [...spec.voice.hookStyles].reverse() }, ...spec, formats: [...spec.formats].reverse() };
  assert.equal(specHash(validatePostTypeSpec(shuffled).spec), specHash(spec));
  const changed = clone(spec);
  changed.design.variant = 1;
  assert.notEqual(specHash(validatePostTypeSpec(changed).spec), specHash(spec), "any real change is a new hash");
});

test("registry sync proposes built-ins once, and an approved type the renderer moved past is superseded", () => {
  const first = planRegistrySync([]);
  assert.equal(first.inserts.length, BUILTIN_POST_TYPES.length);
  assert.ok(first.inserts.every((r) => r.status === "proposed" && r.version === 1), "nothing is born approved");
  assert.deepEqual(first.supersede, []);

  const stored = first.inserts.map((r, i) => ({ ...r, id: `id-${i}` }));
  stored[0].status = "approved";
  const again = planRegistrySync(stored);
  assert.deepEqual(again, { inserts: [], supersede: [] }, "a stable registry needs no changes");

  // The renderer changes underneath an approved type: its fingerprint moves.
  const moved = planRegistrySync(stored, { fingerprintOf: (spec) => `${specHash(spec)}-v2` });
  assert.ok(moved.supersede.some((s) => s.id === "id-0"), "the approved version is superseded");
  const next = moved.inserts.find((r) => r.type_key === stored[0].type_key);
  assert.equal(next.version, 2, "the new rendering is a new version");
  assert.equal(next.status, "proposed", "and it waits for approval like anything new");
});

test("usability: only an approved, untampered, current rendering may post", () => {
  const [row] = planRegistrySync([]).inserts;
  assert.equal(usability(row).usable, false, "proposed is not usable");
  const approved = { ...row, status: "approved" };
  assert.equal(usability(approved).usable, true);
  assert.equal(usability({ ...approved, spec_hash: "tampered" }).usable, false);
  assert.equal(usability({ ...approved, render_fingerprint: "old" }).usable, false);
  assert.equal(typeLabel(approved), `${row.type_key}/v1`);
  assert.deepEqual(TYPE_TRANSITIONS.rejected, [], "a rejected type is final");
});

/* ── Motifs and the renderer ─────────────────────────────────────────────── */

test("motifs are a closed, brand-only vocabulary, and their absence changes nothing", () => {
  assert.equal(sanitizeMotif({ kind: "laser_beam" }), null);
  assert.deepEqual(sanitizeMotif({ kind: "orbit_rings", tone: "#fff", placement: "middle", intensity: "loud" }),
    { kind: "orbit_rings", tone: "line", placement: "top_right", intensity: "subtle" });
  assert.ok(!("motif" in normalizeDesign({ template: "lunar_field" }, "collective_reading", "daily_reading")),
    "a design without a motif normalizes exactly as before Dev Update 6.1");
  const svg = motifLayer({ kind: "star_field", tone: "brand", placement: "top_left", intensity: "subtle" }, ASPECTS.portrait, 2);
  assert.equal(svg, motifLayer({ kind: "star_field", tone: "brand", placement: "top_left", intensity: "subtle" }, ASPECTS.portrait, 2),
    "the star field is deterministic");
  assert.doesNotMatch(svg, /#(?!7657e8|4a28b8|b9a7ff|232842|3a3f5c)[0-9a-f]{6}/i, "only brand tokens");
});

test("the hero's fallback axis never runs through a long evergreen headline", () => {
  const spec = builtin("fog_panel").spec;
  const candidate = evergreenCandidate(EVERGREEN_TOPICS.find((t) => t.format === "without_the_fog"));
  const design = normalizeDesign(designForType(spec), candidate.eventType, "without_the_fog");
  const post = { ...samplePost(candidate, "without_the_fog", designForType(spec)),
    headline: "A deliberately long headline that wraps onto three lines here" };
  const rendered = renderPost({ ...post, design }, { eventType: candidate.eventType, title: candidate.title, facts: candidate.facts, design });
  const hero = rendered.slides[0].svg;
  const axis = /<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/.exec(hero);
  const firstLine = /<text x="[\d.]+" y="([\d.]+)" font-family="Georgia[^"]*" font-size="(\d+)"/.exec(hero);
  assert.ok(firstLine, "the headline is drawn");
  if (axis) {
    const headTop = Number(firstLine[1]) - Number(firstLine[2]);
    assert.ok(Number(axis[2]) < headTop, "the axis ends above the headline's cap height");
  }
  assert.deepEqual(postCollisions(rendered), []);
});

test("the layout check finds text printed on the mark, which is how the footer collision was caught", () => {
  const mark = `<g role="img" aria-label="Orbit Axis" transform="translate(110 914) scale(0.64)"><circle/></g>`;
  const onIt = `<svg>${mark}<text x="110" y="926" font-family="Arial" font-size="26">AUG 28 · 04:18 UTC</text></svg>`;
  const clear = `<svg>${mark}<text x="110" y="700" font-family="Arial" font-size="26">AUG 28 · 04:18 UTC</text></svg>`;
  assert.equal(layoutCollisions(onIt)[0]?.kind, "text_on_mark");
  assert.deepEqual(layoutCollisions(clear), []);
});

test("server PNGs match the desk export: dimensions, filenames, and a JPEG for Meta", async () => {
  const c = fixtureCandidates().weekly_reading;
  const spec = builtin("planetary_grid").spec;
  const { rendered } = renderTypeSample(spec, "weekly_reading");
  const slides = await rasterizePost(rendered, { localDate: "2026-08-17", eventKey: c.eventKey });
  assert.equal(slides.length, rendered.slides.length);
  assert.equal(slides[0].filename, "orbit-axis_2026-08-17_weekly-2026-08-17-2026-08-23_01_portrait.png",
    "the same name exportSlides() gives the same slide");
  assert.equal(slides[0].jpegFilename, slides[0].filename.replace(/\.png$/, ".jpg"));
  assert.deepEqual(pngDimensions(slides[0].png), { width: 1080, height: 1350 });
  assert.deepEqual(jpegDimensions(slides[0].jpeg), { width: 1080, height: 1350 });
  assert.equal(slideFilename({ localDate: "2026-11-09", eventKey: "new_moon:2026-11-09", index: 9, aspect: "square" }),
    "orbit-axis_2026-11-09_new-moon-2026-11-09_10.png", "square has no suffix, as in the desk");
});

/* ── Rotation ─────────────────────────────────────────────────────────────── */

const usableTypes = BUILTIN_POST_TYPES.map((b) => ({ id: b.key, label: `${b.key}/v1`, spec: b.spec }));
const opt = (formatId, key, extra = {}) => ({
  candidate: { eventKey: key, eventType: "x" }, formatId, kind: "reading", autonomy: autonomyFor(formatId),
  urgency: "standing", periodKey: key, eventKey: key, ...extra,
});

test("the same visual family never runs twice in a row", () => {
  const history = [{ slot_date: "2026-11-08", format: "daily_reading", family: "lunar_field", post_type_label: "lunar_field/v1" }];
  for (const date of ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]) {
    const { plan } = choosePlan({ options: [opt("daily_reading", `daily:${date}`)], types: usableTypes, history, slotDate: date });
    assert.notEqual(plan.family, "lunar_field", `${date} avoids the previous family`);
  }
});

test("weekly caps and the evergreen topic window hold", () => {
  const history = ["2026-11-08", "2026-11-07", "2026-11-06"].map((d) => ({ slot_date: d, format: "daily_reading",
    family: "planetary_grid", post_type_label: "planetary_grid/v1" }));
  const capped = choosePlan({ options: [opt("daily_reading", "daily:2026-11-09")], types: usableTypes, history, slotDate: "2026-11-09" });
  assert.equal(capped.plan, null);
  assert.match(capped.considered[0].reason, /weekly cap reached \(3\/3/);

  const evergreen = opt("calculated_not_invented", "educational:x", { kind: "evergreen", topicKey: "x" });
  const recent = [{ slot_date: "2026-10-30", format: "calculated_not_invented", family: "instrument",
    post_type_label: "instrument/v1", topic_key: "x" }];
  const windowed = choosePlan({ options: [evergreen], types: usableTypes, history: recent, slotDate: "2026-11-09" });
  assert.equal(windowed.plan, null);
  assert.match(windowed.considered[0].reason, /topic ran 10 days ago/);
});

test("an event on its day outranks the standing options, and choices are deterministic", () => {
  const options = [opt("daily_reading", "daily:2026-11-09"),
    opt("something_changed", "new_moon:2026-11-09", { kind: "event", urgency: "event_today" })];
  const a = choosePlan({ options, types: usableTypes, history: [], slotDate: "2026-11-09" });
  const b = choosePlan({ options, types: usableTypes, history: [], slotDate: "2026-11-09" });
  assert.equal(a.plan.formatId, "something_changed");
  assert.deepEqual({ ...a.plan, candidate: null }, { ...b.plan, candidate: null }, "same inputs, same plan");
  assert.equal(seeded(["a", "b", "c"], "x"), seeded(["a", "b", "c"], "x"));
});

test("hook style and caption structure rotate away from the most recent ones", () => {
  const history = [
    { slot_date: "2026-11-08", format: "something_changed", family: "lunar_hero", post_type_label: "lunar_hero/v1",
      hook_style: "plain_fact", caption_structure: "three_beats" },
    { slot_date: "2026-11-07", format: "your_sky", family: "sky_contrast", post_type_label: "sky_contrast/v1",
      hook_style: "contrast", caption_structure: "short_note" },
  ];
  const { plan } = choosePlan({ options: [opt("daily_reading", "daily:2026-11-09")], types: usableTypes, history, slotDate: "2026-11-09" });
  assert.ok(!["plain_fact", "contrast"].includes(plan.hookStyle), "the last two hook styles are skipped");
  assert.notEqual(plan.captionStructure, "three_beats", "the last caption structure is skipped");
  assert.ok(HOOK_STYLES[plan.hookStyle] && CAPTION_STRUCTURES[plan.captionStructure]);
});

test("rotation overrides are validated: bad values are ignored and reported", () => {
  const { rotation, ignored } = resolveRotation({ weights: { daily_reading: 2, natal_reading: 5 }, familyNoRepeat: 99,
    weeklyCaps: { your_sky: 0 }, surprise: true });
  assert.equal(rotation.weights.daily_reading, 2);
  assert.equal(rotation.weeklyCaps.your_sky, 0);
  assert.equal(rotation.familyNoRepeat, DEFAULT_ROTATION.familyNoRepeat);
  assert.deepEqual(ignored.sort(), ["familyNoRepeat", "surprise", "weights.natal_reading"].sort());
});

test("near-duplicates are caught on the opening and on the caption", () => {
  const recent = [{ slot_date: "2026-11-01", headline: "The Moon goes dark in Scorpio", hook: "A quiet start",
    caption: "The New Moon arrives in Scorpio, a sign astrologers associate with depth." }];
  const same = { headline: "The Moon goes dark in Scorpio", slides: [{ role: "hero", body: "A quiet start" }], caption: "Different words entirely here." };
  assert.equal(nearDuplicate(same, recent).duplicate, true);
  const fresh = { headline: "Full in Taurus, opposite the Sun", slides: [{ role: "hero", body: "One instant" }], caption: "Something new." };
  assert.equal(nearDuplicate(fresh, recent).duplicate, false);
});

/* ── Policy ───────────────────────────────────────────────────────────────── */

function greenPost(overrides = {}) {
  const candidate = evergreenCandidate(EVERGREEN_TOPICS[0]);
  const post = samplePost(candidate, "calculated_not_invented", designForType(builtin("instrument").spec));
  return { candidate, post: { ...post, ...overrides } };
}

test("a clean green post passes every blocking check", () => {
  const { candidate, post } = greenPost();
  const result = runPostChecks(post, { candidate, autonomy: "green", renderWarnings: [], layout: [] });
  assert.equal(result.passed, true, JSON.stringify(result.checks.filter((c) => !c.passed && c.blocking)));
});

test("Red territory and predictive voice are refused in every autonomous post", () => {
  const { candidate, post } = greenPost();
  const cases = [
    ["This New Moon is good for your health.", "red_territory"],
    ["A moment to invest in what matters.", "red_territory"],
    ["Your partner will notice.", "red_territory"],
    ["This Moon will bring clarity.", "voice_symbolic_not_predictive"],
    ["The stars say it is time.", "voice_symbolic_not_predictive"],
    ["Beware the retrograde.", "voice_symbolic_not_predictive"],
    ["Look up tonight.", "voice_symbolic_not_predictive"],
  ];
  for (const [line, id] of cases) {
    const result = runPostChecks({ ...post, caption: line }, { candidate, autonomy: "green" });
    assert.equal(result.passed, false, `"${line}" should be refused`);
    assert.ok(result.checks.some((c) => c.id === id && !c.passed), `"${line}" fails ${id}`);
  }
  const negated = runPostChecks({ ...post, caption: "Astrology is symbolic reflection, not a prediction." }, { candidate, autonomy: "green" });
  assert.equal(negated.checks.find((c) => c.id === "voice_symbolic_not_predictive").passed, true,
    "saying what Orbit is NOT does not trip the prediction lint");
});

test("'this week' belongs to weekly readings only; human dates must be facts", () => {
  const { candidate, post } = greenPost({ caption: "Worth reading this week." });
  assert.equal(runPostChecks(post, { candidate, autonomy: "green" }).passed, false);
  const facts = { date: "2026-11-24", period: { start_date: "2026-11-09", end_date: "2026-11-15" } };
  assert.deepEqual(verifyHumanDates({ caption: "On November 12 and Nov 24." }, facts), []);
  assert.equal(verifyHumanDates({ caption: "Until December 3." }, facts)[0].rule, "invented_date");
});

test("alt text, lengths, layout, and the Yellow framing rule are enforced", () => {
  const { candidate, post } = greenPost();
  const ids = (p, extra = {}) => runPostChecks(p, { candidate, autonomy: "green", ...extra }).checks
    .filter((c) => !c.passed && c.blocking).map((c) => c.id);
  assert.ok(ids({ ...post, altText: "Short." }).includes("alt_text"));
  assert.ok(ids({ ...post, caption: `${"#tag ".repeat(6)}` }).includes("lengths"));
  assert.ok(ids(post, { layout: ["slide 2: text overlaps the mark"] }).includes("layout_clear"));
  assert.ok(ids(post, { renderWarnings: ["Headline exceeds the hero safe area"] }).includes("render_fits"));

  const reading = fixtureCandidates().daily_reading;
  const yellow = samplePost(reading, "daily_reading", {});
  const unframed = runPostChecks(yellow, { candidate: reading, autonomy: "yellow" });
  assert.equal(unframed.checks.find((c) => c.id === "yellow_attributed_framing").passed, false,
    "interpretive copy must be attributed to tradition before Yellow may post");
});

test("the channel brief rides in the packet; the desk's packet is unchanged", () => {
  const c = fixtureCandidates().something_changed;
  assert.ok(!("channel" in buildPacket(c, "something_changed", [], "")), "desk packets carry no channel brief");
  const brief = channelBrief({ autonomy: "green", hookStyleText: HOOK_STYLES.plain_fact,
    captionStructureText: CAPTION_STRUCTURES.short_note, recentOpenings: ["A", "B"] });
  const packet = buildPacket(c, "something_changed", [], "", brief);
  assert.equal(packet.channel.hookStyle, HOOK_STYLES.plain_fact);
  assert.match(packet.channel.neverMention, /money/);
  assert.match(JSON.stringify(packet.channel), /no per-post human review/);
});

test("the model's design is ignored: the approved type's design is what renders", () => {
  const c = fixtureCandidates().something_changed;
  const raw = { ...samplePost(c, "something_changed", {}), design: { template: "orbit_signal", aspect: "square" } };
  const forced = validateGeneratedPost({ ...raw, design: designForType(builtin("lunar_hero").spec) }, "something_changed");
  assert.equal(forced.design.template, "lunar_hero");
  assert.equal(forced.design.logoPosition, "upper_corner");
});

/* ── Candidates and configuration ────────────────────────────────────────── */

test("the day's options: weekly and monthly only at their start, moons only engine-exact and on their day", () => {
  const reading = (type) => ({ candidate: { ...fixtureCandidates()[`${type}_reading`] },
    period: fixtureCandidates()[`${type}_reading`].facts.period });
  const moon = { eventKey: "full_moon:2026-11-24", eventType: "full_moon", source: "orbit-engine", approximate: false,
    facts: { date: "2026-11-24", instant_utc: "2026-11-24T14:53:00Z" } };
  const tabled = { eventKey: "new_moon:2026-11-24", eventType: "new_moon", source: "orbit-sky-tables", approximate: false,
    facts: { date: "2026-11-24" } };
  const deps = { readingFor: reading, moonsFor: () => ({ candidates: [moon, tabled] }) };
  const env = { ORBIT_X_EDITORIAL_TIMEZONE: "America/Chicago" };
  const formats = (date) => channelOptions(date, env, deps).options.map((o) => o.formatId);
  assert.ok(formats("2026-11-09").includes("weekly_reading"), "Monday");
  assert.ok(formats("2026-11-10").includes("weekly_reading"), "Tuesday");
  assert.ok(!formats("2026-11-11").includes("weekly_reading"), "late in the week, the weekly lets go");
  assert.ok(formats("2026-11-01").includes("monthly_reading"));
  const day = channelOptions("2026-11-24", env, deps);
  assert.equal(day.options.filter((o) => o.formatId === "something_changed").length, 1, "only the engine-exact moon");
  assert.match(day.notes.join(" "), /not engine-exact/);
});

test("evergreen facts are read from code, never remembered", () => {
  const grounds = EVERGREEN_TOPICS.map((t) => t.ground()).join(" ");
  assert.match(grounds, new RegExp(`Orbit offers ${HOUSE_SYSTEMS.length}`));
  assert.doesNotMatch(grounds, /\bseven\b/i, "the retired stock's literal is gone");
});

test("flags are exact-string, and the kill switch fails safe", () => {
  assert.equal(channelEnabled({ ORBIT_X_ENABLED: "true", ORBIT_X_AUTOPUBLISH: "1" }), false);
  assert.equal(channelEnabled({ ORBIT_X_ENABLED: "true", ORBIT_X_AUTOPUBLISH: "true" }), true);
  assert.equal(channelConfig({ ORBIT_X_AUTOPUBLISH_LIVE: "TRUE" }).mode, "dry_run");
  assert.equal(channelConfig({ ORBIT_X_AUTOPUBLISH_LIVE: "true" }).mode, "live");
  assert.equal(channelConfig({ ORBIT_X_AUTOPUBLISH_YELLOW: "yes" }).yellow, false);
  for (const value of ["1", "true", "false", "stop", "yes"]) assert.equal(killSwitchEngaged({ ORBIT_X_KILL_SWITCH: value }), true, value);
  for (const value of [undefined, "", "   "]) assert.equal(killSwitchEngaged({ ORBIT_X_KILL_SWITCH: value }), false);
  const summary = JSON.stringify(channelConfig({ ORBIT_X_IG_ACCESS_TOKEN: "secret-token-value-1234567890", CRON_SECRET: "cron-secret-value-123" }));
  assert.ok(!summary.includes("secret-token-value") && !summary.includes("cron-secret-value"), "no secret in the summary");
});

/* ── The migration ────────────────────────────────────────────────────────── */

test("the channel migration holds the guarantees the code relies on", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261109170000_orbit_x_auto_channel.sql", import.meta.url), "utf8");
  assert.match(sql, /slot_key\s+text not null unique/, "one run per slot: the idempotency guard");
  assert.match(sql, /orbit_x_posts_published_is_real[\s\S]*external_media_id is not null and published_at is not null/);
  assert.match(sql, /event_payload is write-once/, "facts are write-once for every role");
  assert.match(sql, /only the Orbit X channel may set status/);
  assert.match(sql, /post types are inserted as proposed/);
  assert.match(sql, /spec is immutable; propose a new version/);
  assert.match(sql, /orbit_x_channel_events is append-only/);
  assert.match(sql, /'orbit-x-media',\s*'orbit-x-media',\s*true/, "the media bucket is public so Meta can fetch");
  assert.doesNotMatch(sql, /create policy[^;]*orbit_x_channel_runs[^;]*for insert/i, "no client role writes runs");
  // The partial unique index this channel reuses still covers its statuses.
  const readings = readFileSync(new URL("../supabase/migrations/20260820200000_orbit_x_collective_readings.sql", import.meta.url), "utf8");
  assert.match(readings, /status in \('approved', 'exported', 'scheduled', 'published'\)/);
});
