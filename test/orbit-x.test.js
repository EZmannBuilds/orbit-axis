// Orbit Axis :: Orbit X, the internal content desk (Dev Update 5.0).
//
// The rule the whole suite holds: THE ENGINE OWNS THE FACTS AND THE HUMAN
// OWNS THE DECISION. The model is handed calculated facts and can neither
// invent astronomy nor overwrite it; a non-admin cannot see the desk exists;
// nothing here can mark anything published.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildCandidates, CANDIDATE_TYPES, MOON_LOOKAHEAD_PER_KIND } from "../lib/orbit-x/candidates.js";
import { scoreCandidate, rankCandidates, SCORE_DIMENSIONS, SCORE_MAX_PER_DIMENSION } from "../lib/orbit-x/scoring.js";
import { FORMATS, FORMAT_IDS, APPROVED_CTAS, TEMPLATE } from "../lib/orbit-x/formats.js";
import { auditCopy, verifyFactIntegrity, AUDIT_RULES } from "../lib/orbit-x/editorial.js";
import { buildPacket, systemPrompt } from "../lib/orbit-x/prompts.js";
import { parseModelJson, validateGeneratedPost, draftCompleteness, OrbitXValidationError } from "../lib/orbit-x/schemas.js";
import { buildScaffold } from "../lib/orbit-x/language.js";
import { handleOrbitXRoute, orbitXEnabled } from "../lib/orbit-x/api.js";
import { orbitXStore } from "../lib/orbit-x/store.js";
import { editorialDate } from "../lib/orbit-x/readings.js";

/* ── Fixtures: engine-SHAPED, never presented as live sky ─────────────── */

const CONTEXT = Object.freeze({
  context_version: 1, local_date: "2026-03-05", timezone_name: "America/Chicago",
  moon_phase_name: "Waxing Gibbous", illumination_percent: 84, is_waxing: true,
  next_full_moon: { local_date: "2026-03-09", instant_utc: "2026-03-09T18:00:00Z" },
  next_new_moon: { local_date: "2026-03-24", instant_utc: "2026-03-24T02:00:00Z" },
});
const EVENTS = Object.freeze([
  { date: "2026-03-09", instant_utc: "2026-03-09T18:00:00Z", kind: "full_moon", title: "Full Moon 🌕", detail: "Peak illumination.", source: "orbit-axis-engine" },
  { date: "2026-03-24", instant_utc: "2026-03-24T02:00:00Z", kind: "new_moon", title: "New Moon 🌑", detail: "Dark sky.", source: "orbit-axis-engine" },
  { date: "2026-03-20", kind: "sun_ingress", title: "Sun enters Aries ♈", detail: "Aries season begins — Fire Cardinal." },
  { date: "2026-03-14", kind: "mercury_direct", title: "Mercury stations direct ☿", detail: "Retrograde ends. (approximate)" },
  { date: "2026-03-15", kind: "comet_flyby", title: "Unsupported thing", detail: "?" },
  null,
]);

const AUTH = Object.freeze({ url: "https://stub.supabase.test", anonKey: "anon", accessToken: "tok", ownerId: "22222222-2222-4222-8222-222222222222" });
const ENV_ON = Object.freeze({ ORBIT_X_ENABLED: "true" });

function stubStore({ admin = true, history = [], coverage = [] } = {}) {
  const inserted = [], updated = [];
  return {
    inserted, updated,
    isAdmin: async () => admin,
    history: async () => history,
    coverageFor: async () => coverage,
    byId: async (id) => history.find((r) => r.id === id) || null,
    insert: async (row) => { inserted.push(row); return { id: "post-1", ...row }; },
    update: async (id, fields) => { updated.push({ id, fields }); return { id, ...fields }; },
  };
}

function goodPost(format = "something_changed", slides = 4) {
  return {
    format, headline: "Mercury stations direct",
    slides: Array.from({ length: slides }, (_, i) => ({ heading: `Slide ${i + 1}`, body: "Around March 14, Mercury resumes forward motion. Astrologers associate the shift with clearer lanes." })),
    caption: "Mercury stations direct around March 14. One way to consider it: what stalled that can move again?",
    cta: "Explore today's sky in Orbit Axis.", altText: "Dark slide reading Mercury stations direct.",
  };
}


/** A live moon candidate — key and date that genuinely agree with the engine.
 *  The lifecycle tests below exercise the STORE, not candidate selection, but
 *  the route rebuilds the candidate server-side, so the pair must be real. */
async function liveMoon() {
  const { createCurrentSkyContext } = await import("../lib/astro/current-sky-context.js");
  const { upcomingEvents } = await import("../lib/sky.js");
  const dateIso = "2026-08-19";
  const context = createCurrentSkyContext({
    at: new Date(`${dateIso}T12:00:00.000Z`), timezoneName: "America/Chicago", timezoneSource: "request",
  });
  const events = upcomingEvents(new Date(`${context.local_date}T12:00:00.000Z`), 12, { currentSkyContext: context });
  const { candidates } = buildCandidates(events, context);
  return { dateIso, eventKey: candidates[0].eventKey };
}

/* ── Candidates ─────────────────────────────────────────────────────────── */

test("only the moon readings become event candidates; everything else is named, not invented", () => {
  const { candidates, skipped, setAside } = buildCandidates(EVENTS, CONTEXT);
  const keys = candidates.map((c) => c.eventKey);
  assert.ok(keys.includes("full_moon:2026-03-09"), "stable key = kind + date");
  for (const c of candidates) assert.ok(CANDIDATE_TYPES.includes(c.eventType), c.eventType);

  // Dev Update 5.3: the desk recommends four things. Ingresses and stations
  // are still real, calculated events — they are SET ASIDE by editorial
  // policy, which is a different fact from malformed and is counted apart so
  // the UI never implies the engine produced something broken.
  assert.deepEqual(skipped.map((s) => s.kind), ["malformed"],
    "only genuinely malformed input is 'skipped'");
  const asideKinds = setAside.map((s) => s.kind);
  assert.ok(asideKinds.includes("sun_ingress") && asideKinds.includes("mercury_direct"),
    "retired kinds are set aside by name");
  assert.ok(asideKinds.includes("comet_flyby"), "and so is a kind nothing understands");
  assert.ok(!keys.some((k) => k.startsWith("educational:")), "the evergreen stock is no longer recommended");
  assert.ok(!keys.some((k) => k.startsWith("daily_sky:")), "the Daily Reading replaced today's-sky");

  const twice = buildCandidates(EVENTS, CONTEXT);
  assert.deepEqual(twice.candidates.map((c) => c.eventKey), keys, "deterministic");
});

test("only the NEXT lunation of each kind is recommended", () => {
  const many = [
    { date: "2026-03-09", instant_utc: "2026-03-09T18:00:00Z", kind: "full_moon", title: "Full Moon", detail: "a", source: "orbit-axis-engine" },
    { date: "2026-04-08", instant_utc: "2026-04-08T18:00:00Z", kind: "full_moon", title: "Full Moon", detail: "b", source: "orbit-axis-engine" },
    { date: "2026-03-24", instant_utc: "2026-03-24T02:00:00Z", kind: "new_moon", title: "New Moon", detail: "c", source: "orbit-axis-engine" },
  ];
  const { candidates, setAside } = buildCandidates(many, CONTEXT);
  assert.equal(candidates.filter((c) => c.eventType === "full_moon").length, MOON_LOOKAHEAD_PER_KIND);
  assert.equal(candidates.filter((c) => c.eventType === "new_moon").length, MOON_LOOKAHEAD_PER_KIND);
  assert.equal(candidates[0].eventKey, "full_moon:2026-03-09", "the soonest one, not the last seen");
  assert.ok(setAside.some((s) => s.date === "2026-04-08"), "the backlog is set aside, not silently dropped");
});

test("a moon's event key does not move with the caller's timezone", async () => {
  // The August 2026 full moon is the 27th in Chicago and the 28th in UTC, and
  // event.date is what the key is built from. Keyed off the requester, one
  // real moon became two candidates — and since the key IS the duplicate
  // guard, the desk would mint a second draft of a moon it had covered.
  const store = stubStore();
  const asked = async (tz) => {
    const params = new URLSearchParams(`date=2026-08-19${tz ? `&tz=${tz}` : ""}`);
    const res = await handleOrbitXRoute("GET", "/api/orbit-x/candidates", params, {},
      { ...AUTH }, { env: ENV_ON, store });
    return res.body.candidates.map((c) => c.candidate.eventKey)
      .filter((k) => k.startsWith("full_moon:") || k.startsWith("new_moon:"));
  };
  const chicago = await asked("America/Chicago");
  const utc = await asked("UTC");
  const tokyo = await asked("Asia/Tokyo");
  assert.deepEqual(chicago, utc, "the same moon, whoever asks");
  assert.deepEqual(chicago, tokyo, "including from the other side of the date line");
  assert.ok(chicago.includes("full_moon:2026-08-27"),
    "and it stays the key the existing production draft was saved under");
});

/* ── Scoring ────────────────────────────────────────────────────────────── */

test("scores are bounded, deterministic, and explainable", () => {
  const { candidates } = buildCandidates(EVENTS, CONTEXT);
  for (const candidate of candidates) {
    const s1 = scoreCandidate(candidate, [], "2026-03-05");
    const s2 = scoreCandidate(candidate, [], "2026-03-05");
    assert.deepEqual(s1, s2, "same inputs, same score");
    for (const dim of SCORE_DIMENSIONS) {
      assert.ok(s1.scores[dim] >= 0 && s1.scores[dim] <= SCORE_MAX_PER_DIMENSION, dim);
    }
    assert.equal(s1.totalScore, SCORE_DIMENSIONS.reduce((n, d) => n + s1.scores[d], 0));
    assert.ok(s1.reasons.length > 0, "the UI can always say WHY");
  }
});

test("novelty: covered events floor, recent same-type work is penalised", () => {
  const { candidates } = buildCandidates(EVENTS, CONTEXT);
  const full = candidates.find((c) => c.eventKey === "full_moon:2026-03-09");
  const covered = scoreCandidate(full, [{ event_key: full.eventKey, event_type: "full_moon", status: "approved", created_at: "2026-03-01" }], "2026-03-05");
  assert.equal(covered.scores.novelty, 0);
  assert.equal(covered.duplicate, true);
  const crowded = scoreCandidate(full, [
    { event_key: "full_moon:2026-02-08", event_type: "full_moon", status: "exported", created_at: "2026-02-25" },
    { event_key: "new_moon:2026-02-23", event_type: "full_moon", status: "draft", created_at: "2026-03-01" },
  ], "2026-03-05");
  assert.ok(crowded.scores.novelty < SCORE_MAX_PER_DIMENSION, "recent same-type coverage costs novelty");
  const rejectedOnly = scoreCandidate(full, [{ event_key: full.eventKey, event_type: "full_moon", status: "rejected", created_at: "2026-03-01" }], "2026-03-05");
  assert.equal(rejectedOnly.duplicate, false, "a rejected draft is not living coverage");
});

test("ranking is total-score first and fully deterministic", () => {
  const { candidates } = buildCandidates(EVENTS, CONTEXT);
  const scored = candidates.map((candidate) => ({ candidate, score: scoreCandidate(candidate, [], "2026-03-05") }));
  const ranked = rankCandidates(scored);
  for (let i = 1; i < ranked.length; i += 1) {
    assert.ok(ranked[i - 1].score.totalScore >= ranked[i].score.totalScore);
  }
  assert.deepEqual(rankCandidates(scored), ranked);
});

/* ── Formats ────────────────────────────────────────────────────────────── */

test("legacy formats plus three first-class reading formats keep explicit risk categories", () => {
  assert.equal(FORMAT_IDS.length, 8);
  for (const f of Object.values(FORMATS)) {
    assert.ok(["green", "yellow", "red"].includes(f.autonomyRisk), f.id);
    assert.ok(f.slides.min >= 1 && f.slides.max >= f.slides.min, f.id);
    assert.ok(f.limits.headline > 0 && f.limits.slideBody > 0 && f.limits.caption > 0, f.id);
  }
  assert.ok(APPROVED_CTAS.includes(""), "an educational post may carry no CTA");
  assert.ok(!APPROVED_CTAS.join(" ").includes("Pro"), "no CTA sells an offer that is not live");
  assert.equal(TEMPLATE.width, 1080);
});

/* ── The AI boundary ────────────────────────────────────────────────────── */

test("the packet carries facts and editorial context — and nothing personal", () => {
  const { candidates } = buildCandidates(EVENTS, CONTEXT);
  const packet = buildPacket(candidates.find((c) => c.eventType === "new_moon"), "something_changed", ["full_moon:2026-02-08"]);
  const text = JSON.stringify(packet);
  for (const banned of ["birth", "natal", "email", "ownerId", "owner_id", "accessToken", "apiKey", "sk_", "whsec"]) {
    assert.ok(!text.toLowerCase().includes(banned.toLowerCase()), `packet must not carry ${banned}`);
  }
  assert.ok(text.includes("orbit-engine") || text.includes("orbit-sky-tables"), "facts arrive attributed");
  assert.match(systemPrompt(), /never calculate positions/i);
  assert.match(systemPrompt(), /symbolic reflection/i);
});

test("malformed or oversized model output is rejected cleanly", () => {
  assert.throws(() => parseModelJson("Here you go! { not json"), OrbitXValidationError);
  assert.throws(() => validateGeneratedPost({ format: "something_changed", headline: "x" }, "something_changed"),
    OrbitXValidationError, "missing slides/caption/alt");
  const tooMany = goodPost("something_changed", 9);
  assert.throws(() => validateGeneratedPost(tooMany, "something_changed"), /slides/);
  const noAlt = { ...goodPost(), altText: "" };
  assert.throws(() => validateGeneratedPost(noAlt, "something_changed"), /altText/);
  // The one liberty: a markdown fence is stripped, not fatal.
  const fenced = "```json\n" + JSON.stringify(goodPost()) + "\n```";
  assert.equal(parseModelJson(fenced).format, "something_changed");
});

test("fact integrity: a date the engine never supplied is refused", () => {
  const facts = { date: "2026-03-14", instant_utc: null };
  const honest = verifyFactIntegrity(goodPost(), facts);
  assert.equal(honest.length, 0);
  const invented = { ...goodPost(), caption: "Everything shifts on 2026-03-17, mark it." };
  const findings = verifyFactIntegrity(invented, facts);
  assert.equal(findings[0].rule, "invented_timestamp");
});

/* ── Editorial audit ────────────────────────────────────────────────────── */

test("the audit refuses the worst shapes: prediction, advice, fear, persona", () => {
  const bad = [
    ["you are going to meet someone this month", "deterministic_prediction"],
    ["this transit causes your breakup", "causal_transit"],
    ["this alignment can cure your anxiety", "medical"],
    ["a financial windfall is coming — invest now", "financial"],
    ["Mercury says: sign the contract now", "legal"],
    ["your life is about to change forever", "fear_bait"],
    ["last chance to align before it's too late", "fake_scarcity"],
    ["hey guys, I noticed Venus moved", "persona"],
  ];
  for (const [text, rule] of bad) {
    const findings = auditCopy({ caption: text });
    assert.ok(findings.some((f) => f.rule === rule), `"${text}" should trip ${rule}`);
  }
  assert.equal(auditCopy(goodPost()).length, 0, "the allowed register passes clean");
  assert.ok(AUDIT_RULES.length >= 8);
});

/* ── Security at the boundary ───────────────────────────────────────────── */

test("flag off = the desk does not exist, for anyone", async () => {
  assert.equal(orbitXEnabled({}), false);
  assert.equal(orbitXEnabled({ ORBIT_X_ENABLED: "1" }), false, "only the exact string enables");
  const res = await handleOrbitXRoute("GET", "/api/orbit-x/candidates", new URLSearchParams(), {},
    { ownerId: AUTH.ownerId }, { env: {}, store: stubStore() });
  assert.equal(res.status, 404);
});

test("a signed-in NON-admin gets 404 — the tool does not advertise itself", async () => {
  const store = stubStore({ admin: false });
  const res = await handleOrbitXRoute("GET", "/api/orbit-x/posts", new URLSearchParams(), {},
    { ...AUTH }, { env: ENV_ON, store });
  assert.equal(res.status, 404);
  assert.equal(store.inserted.length, 0);
});

test("no session at all is refused before the store is ever consulted", async () => {
  const res = await handleOrbitXRoute("GET", "/api/orbit-x/posts", new URLSearchParams(), {}, null, { env: ENV_ON });
  assert.equal(res.status, 401);
});

test("the server wires the route behind requireAuth and the page outside public/", () => {
  const src = readFileSync(new URL("../lib/server/create-app.js", import.meta.url), "utf8");
  const block = src.slice(src.indexOf('route.startsWith("/api/orbit-x/")'), src.indexOf('route.startsWith("/api/orbit-x/")') + 1100);
  assert.match(block, /requireAuth\(req, res, env\)/);
  // process.env, deliberately: the handler-scope `env` is the resolved
  // environment classification, not raw variables — reading the flag off it
  // left the desk permanently off, which is exactly what this caught live.
  assert.match(block, /orbitXEnabled\(process\.env\)/);
  assert.match(src, /orbit-x\/ui\.html/, "the desk page is served from lib/, not shipped in the bundle");
  assert.match(src, /editorial\|posting-package/, "the ZIP helper is on the explicit safe module allow-list");
  const fs = readFileSync(new URL("../lib/orbit-x/ui.html", import.meta.url), "utf8");
  assert.ok(!/sk_(live|test)|whsec_|ORBIT_X_AI_API_KEY|service.role/i.test(fs), "no secret shapes in the page");
});

/* ── Persistence and lifecycle ──────────────────────────────────────────── */

test("saving stores verified facts write-once, beside the copy — never under it", async () => {
  const store = stubStore();
  const moon = await liveMoon();
  const res = await handleOrbitXRoute("POST", "/api/orbit-x/posts", new URLSearchParams(),
    { eventKey: moon.eventKey, date: moon.dateIso, format: "something_changed",
      copy: { ...goodPost("something_changed", 4) } },
    { ...AUTH }, { env: ENV_ON, store });
  assert.equal(res.status, 200);
  const row = store.inserted[0];
  assert.equal(row.event_key, moon.eventKey);
  assert.equal(row.status, "draft");
  assert.ok(row.event_payload.facts.date, "the verified packet is stored whole");
  assert.ok(row.edited_copy.headline, "the copy is stored beside it");
  // And the store's own allow-list makes facts unwritable afterwards:
  const real = orbitXStore(AUTH, { fetchImpl: async () => ({ ok: true, json: async () => [{}] }) });
  await assert.rejects(real.update("post-1", { event_payload: { forged: true } }), /not an editable column/);
});

test("duplicate coverage is refused unless the fresh treatment is deliberate", async () => {
  const store = stubStore({ coverage: [{ id: "old", status: "approved", created_at: "2026-03-01" }] });
  const moon = await liveMoon();
  const body = { eventKey: moon.eventKey, date: moon.dateIso, format: "something_changed", copy: goodPost("something_changed", 4) };
  const refused = await handleOrbitXRoute("POST", "/api/orbit-x/posts", new URLSearchParams(), body, { ...AUTH }, { env: ENV_ON, store });
  assert.equal(refused.status, 409);
  const allowed = await handleOrbitXRoute("POST", "/api/orbit-x/posts", new URLSearchParams(),
    { ...body, allowDuplicate: true }, { ...AUTH }, { env: ENV_ON, store });
  assert.equal(allowed.status, 200, "same event, NEW draft — deliberately");
});

test("the lifecycle refuses illegal jumps and nothing can become published", async () => {
  // edited_copy is complete because approval now runs the quality gate (5.1):
  // an unfinished draft is a different test below.
  const draft = { id: "11111111-2222-4333-8444-555555555555", status: "draft", selected_format: "without_the_fog",
    event_payload: { facts: {} }, edited_copy: goodPost("without_the_fog", 3) };
  const store = stubStore({ history: [draft] });
  const jump = await handleOrbitXRoute("PATCH", `/api/orbit-x/posts/${draft.id}`, new URLSearchParams(),
    { status: "exported" }, { ...AUTH }, { env: ENV_ON, store });
  assert.equal(jump.status, 409, "draft cannot leap to exported without approval");
  const publish = await handleOrbitXRoute("PATCH", `/api/orbit-x/posts/${draft.id}`, new URLSearchParams(),
    { status: "published" }, { ...AUTH }, { env: ENV_ON, store });
  assert.equal(publish.status, 409, "published belongs to a publisher that does not exist");
  const approve = await handleOrbitXRoute("PATCH", `/api/orbit-x/posts/${draft.id}`, new URLSearchParams(),
    { status: "approved" }, { ...AUTH }, { env: ENV_ON, store });
  assert.equal(approve.status, 200);
  assert.ok(store.updated[0].fields.approved_at, "approval is timestamped");
});

test("an edit that violates editorial rules is refused exactly like the model's", async () => {
  const draft = { id: "11111111-2222-4333-8444-555555555555", status: "draft", selected_format: "without_the_fog",
    event_payload: { facts: { ground: "x" } } };
  const store = stubStore({ history: [draft] });
  const res = await handleOrbitXRoute("PATCH", `/api/orbit-x/posts/${draft.id}`, new URLSearchParams(),
    { copy: { ...goodPost("without_the_fog", 3), caption: "Brace yourself: your life is about to change forever." } },
    { ...AUTH }, { env: ENV_ON, store });
  assert.equal(res.status, 422);
  assert.equal(store.updated.length, 0, "nothing was stored");
});

/* ── Real engine, one integration case ──────────────────────────────────── */

test("real Orbit engine data produces candidates end to end", async () => {
  const { createCurrentSkyContext } = await import("../lib/astro/current-sky-context.js");
  const { upcomingEvents } = await import("../lib/sky.js");
  const context = createCurrentSkyContext({ at: new Date("2026-08-19T17:00:00Z"), timezoneName: "America/Chicago", timezoneSource: "request" });
  const events = upcomingEvents(new Date(`${context.local_date}T12:00:00.000Z`), 12, { currentSkyContext: context });
  const { candidates, skipped } = buildCandidates(events, context);
  assert.equal(skipped.length, 0, "the live pipeline produces nothing malformed");
  assert.ok(candidates.length >= 1 && candidates.length <= 2,
    "live sky yields the next full moon and the next new moon, and nothing else");
  for (const c of candidates) {
    assert.ok(["full_moon", "new_moon"].includes(c.eventType), c.eventType);
    assert.equal(c.source, "orbit-engine", "facts are the engine's, verbatim");
  }
});

/* ── The manual lane: the desk owes nothing to a provider ───────────────── */

test("the manual scaffold passes every gate a draft must — publishable or empty, never a worksheet", () => {
  const { candidates } = buildCandidates(EVENTS, CONTEXT);
  const samples = [
    candidates.find((c) => c.eventType === "full_moon"),
    candidates.find((c) => c.eventType === "new_moon"),
  ];
  for (const candidate of samples) {
    for (const formatId of FORMAT_IDS.filter((id) => !FORMATS[id].readingType)) {
      const { post: raw, suggestions } = buildScaffold(candidate, formatId, {});
      const post = validateGeneratedPost(raw, formatId, { requireComplete: false }); // throws if invalid
      assert.equal(post.format, formatId);
      assert.equal(auditCopy(post).length, 0, `${formatId} scaffold trips no editorial rule (worksheet tripwire included)`);
      assert.equal(verifyFactIntegrity(post, candidate.facts).length, 0,
        `${formatId} scaffold invents no dates for ${candidate.eventKey}`);
      // The 5.1 contract: no field ever contains an authoring instruction —
      // guidance lives in the suggestions object the desk renders as UI.
      assert.ok(!/write th|edit this|edit me|edit before approving/i.test(JSON.stringify(post)),
        `${formatId} scaffold copy carries no worksheet text`);
      assert.ok(suggestions.slides.length === post.slides.length, "every slide gets its guidance beside it");
      // And an unedited scaffold can never be approved where interpretive
      // sections exist: they start empty, and completeness says so by name.
      // (daily_signal's single slide is the engine's fact register, so it
      // alone starts complete — concise by design.)
      const completeness = draftCompleteness(post);
      if (post.slides.some((s) => ["symbolic", "reflection", "the_sky", "your_sky"].includes(s.role))) {
        assert.equal(completeness.complete, false,
          `${formatId} for ${candidate.eventKey} still needs the editor before approval`);
      }
    }
  }
  // Approximate sources scaffold with "around", never a false precision — and
  // in human dates, with the ISO instant left to the facts panel. Mercury is
  // no longer RECOMMENDED (Dev Update 5.3), but a post already saved under it
  // must still scaffold and render, so the behaviour is still pinned here.
  const mercury = Object.freeze({
    eventKey: "mercury_direct:2026-03-14", eventType: "mercury_direct",
    title: "Mercury stations direct", timestamp: "2026-03-14", approximate: true,
    source: "orbit-sky-tables",
    facts: Object.freeze({ date: "2026-03-14", instant_utc: null,
      detail: "Retrograde ends. (approximate)", approximate: true }),
  });
  const { post: mercPost } = buildScaffold(mercury, "something_changed", {});
  const factSlide = mercPost.slides.find((s) => s.role === "fact");
  assert.match(factSlide.body, /around March 14/);
});

test("the approval quality gate refuses an unfinished draft, by name", async () => {
  const { candidates } = buildCandidates(EVENTS, CONTEXT);
  const full = candidates.find((c) => c.eventType === "full_moon");
  const { post: scaffold } = buildScaffold(full, "something_changed", {});
  const draft = { id: "11111111-2222-4333-8444-555555555555", status: "draft",
    selected_format: "something_changed", event_payload: full, edited_copy: scaffold };
  const store = stubStore({ history: [draft] });
  const refused = await handleOrbitXRoute("PATCH", `/api/orbit-x/posts/${draft.id}`, new URLSearchParams(),
    { status: "approved" }, { ...AUTH }, { env: ENV_ON, store });
  assert.equal(refused.status, 422);
  assert.ok(refused.body.missing.some((m) => /symbolic/.test(m)), "the gate names what is missing");
  assert.equal(store.updated.length, 0);
  // Author the missing sections and the same transition succeeds.
  const finished = { ...scaffold, slides: scaffold.slides.map((s) =>
    s.body ? s : { ...s, body: "In astrology, this moment is read as a culmination — attributed to tradition, not fate." }) };
  const ok = await handleOrbitXRoute("PATCH", `/api/orbit-x/posts/${draft.id}`, new URLSearchParams(),
    { status: "approved", copy: finished }, { ...AUTH }, { env: ENV_ON, store });
  assert.equal(ok.status, 200, "completing the sections opens the gate");
});

test("the manual endpoint needs no provider and mirrors /generate's shape", async () => {
  // ENV_ON deliberately carries no ORBIT_X_AI_API_KEY.
  const store = stubStore();
  const moon = await liveMoon();
  const res = await handleOrbitXRoute("POST", "/api/orbit-x/manual", new URLSearchParams(),
    { eventKey: moon.eventKey, date: moon.dateIso, format: "something_changed" },
    { ...AUTH }, { env: ENV_ON, store });
  assert.equal(res.status, 200);
  assert.equal(res.body.manual, true);
  assert.equal(res.body.usage, null);
  assert.ok(res.body.post.headline && res.body.post.slides.length >= 4);
  assert.ok(res.body.candidate.facts.date, "the verified candidate rides along, same as /generate");
});

test("missing AI configuration is a state on the candidates response, never an error", async () => {
  const store = stubStore();
  const without = await handleOrbitXRoute("GET", "/api/orbit-x/candidates", new URLSearchParams("date=2026-03-05"), {},
    { ...AUTH }, { env: ENV_ON, store });
  assert.equal(without.status, 200, "the desk lists and scores without any provider");
  assert.equal(without.body.aiAvailable, false);
  const withKey = await handleOrbitXRoute("GET", "/api/orbit-x/candidates", new URLSearchParams("date=2026-03-05"), {},
    { ...AUTH }, { env: { ...ENV_ON, ORBIT_X_AI_API_KEY: "k", ORBIT_X_AI_PROVIDER: "anthropic" }, store });
  assert.equal(withKey.body.aiAvailable, true);
});

test("Today and Tomorrow are resolved in the server-controlled editorial timezone", async () => {
  const store = stubStore();
  const env = { ...ENV_ON, ORBIT_X_EDITORIAL_TIMEZONE: "America/Chicago" };
  const today = await handleOrbitXRoute("GET", "/api/orbit-x/candidates", new URLSearchParams("relative=today"), {},
    { ...AUTH }, { env, store });
  const tomorrow = await handleOrbitXRoute("GET", "/api/orbit-x/candidates", new URLSearchParams("relative=tomorrow"), {},
    { ...AUTH }, { env, store });
  assert.equal(today.body.localDate, editorialDate(new Date(), "America/Chicago"));
  assert.equal(tomorrow.body.localDate, editorialDate(new Date(), "America/Chicago", 1));
  assert.equal(today.body.editorialTimezone, "America/Chicago");
});

test("a manual draft saves through the full lifecycle and records human authorship", async () => {
  const store = stubStore();
  const moon = await liveMoon();
  const { body } = await handleOrbitXRoute("POST", "/api/orbit-x/manual", new URLSearchParams(),
    { eventKey: moon.eventKey, date: moon.dateIso, format: "something_changed" }, { ...AUTH }, { env: ENV_ON, store });
  const saved = await handleOrbitXRoute("POST", "/api/orbit-x/posts", new URLSearchParams(),
    { eventKey: moon.eventKey, date: moon.dateIso, format: "something_changed",
      copy: body.post, generatedCopy: null }, { ...AUTH }, { env: ENV_ON, store });
  assert.equal(saved.status, 200);
  assert.equal(store.inserted[0].generated_copy, null,
    "generated_copy stays null — human-authored is a recorded fact, not a pretence");
  assert.ok(store.inserted[0].edited_copy.headline);
});

test("the desk page hides AI controls rather than rendering apologies", () => {
  const page = readFileSync(new URL("../lib/orbit-x/ui.html", import.meta.url), "utf8");
  assert.ok(page.includes("data-manual"), "Manual draft is a first-class action");
  assert.match(page, /aiAvailable \?/, "Generate and Regenerate render only when a provider exists");
  assert.match(page, /manual drafting \(no AI provider configured\)/,
    "absence is stated once, neutrally, in the status line — never as an error");
});

test("the desk signs itself in without ever widening who may enter", () => {
  const page = readFileSync(new URL("../lib/orbit-x/ui.html", import.meta.url), "utf8");
  // The gate exists and runs BEFORE any candidate request, so a signed-out
  // visit opens on a form instead of a dead-end error line.
  assert.match(page, /checkSession\(\)\.then/, "the page decides gate-or-desk at boot");
  assert.match(page, /"\/api\/auth\/session"/, "it asks the ordinary session endpoint");
  assert.match(page, /"\/api\/auth\/signin"/, "and posts to the ordinary sign-in endpoint");
  assert.match(page, /"\/api\/auth\/signout"/, "sign-out is reachable from the desk");

  // A 401 arriving mid-session re-gates instead of stranding the editor.
  assert.match(page, /showGate\("Your session expired/);

  // THE LINE THAT MATTERS: the gate answers "is there a session", never
  // "may this person use Orbit X". Nothing in the page may decide admin
  // membership — that is orbit_x_admins, checked server-side and re-checked
  // by RLS on every row. A page that branched on an admin flag would be a
  // second, weaker authorization system.
  assert.ok(!/isAdmin|is_admin|orbit_x_admins/i.test(page),
    "the desk page never evaluates admin membership client-side");

  // Credentials are used and dropped: never stored, never echoed into a URL.
  assert.match(page, /\$\("#x-password"\)\.value = "";/, "the password field is cleared after use");
  assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(page),
    "no credential or session material is stashed by the page");
  assert.ok(!/password=|email=\$\{/.test(page), "credentials never travel in a URL");
  assert.match(page, /type="password"[^>]*autocomplete="current-password"/,
    "a real password field, so password managers behave normally");
});
