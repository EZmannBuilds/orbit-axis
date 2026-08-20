// Orbit Axis :: Orbit X, the internal content desk (Dev Update 5.0).
//
// The rule the whole suite holds: THE ENGINE OWNS THE FACTS AND THE HUMAN
// OWNS THE DECISION. The model is handed calculated facts and can neither
// invent astronomy nor overwrite it; a non-admin cannot see the desk exists;
// nothing here can mark anything published.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildCandidates, EDUCATIONAL_TOPICS, CANDIDATE_TYPES } from "../lib/orbit-x/candidates.js";
import { scoreCandidate, rankCandidates, SCORE_DIMENSIONS, SCORE_MAX_PER_DIMENSION } from "../lib/orbit-x/scoring.js";
import { FORMATS, FORMAT_IDS, APPROVED_CTAS, TEMPLATE } from "../lib/orbit-x/formats.js";
import { auditCopy, verifyFactIntegrity, AUDIT_RULES } from "../lib/orbit-x/editorial.js";
import { buildPacket, systemPrompt } from "../lib/orbit-x/prompts.js";
import { manualScaffold, parseModelJson, validateGeneratedPost, OrbitXValidationError } from "../lib/orbit-x/schemas.js";
import { handleOrbitXRoute, orbitXEnabled } from "../lib/orbit-x/api.js";
import { orbitXStore } from "../lib/orbit-x/store.js";

/* ── Fixtures: engine-SHAPED, never presented as live sky ─────────────── */

const CONTEXT = Object.freeze({
  context_version: 1, local_date: "2026-03-05", timezone_name: "America/Chicago",
  moon_phase_name: "Waxing Gibbous", illumination_percent: 84, is_waxing: true,
  next_full_moon: { local_date: "2026-03-09", instant_utc: "2026-03-09T18:00:00Z" },
  next_new_moon: { local_date: "2026-03-24", instant_utc: "2026-03-24T02:00:00Z" },
});
const EVENTS = Object.freeze([
  { date: "2026-03-09", instant_utc: "2026-03-09T18:00:00Z", kind: "full_moon", title: "Full Moon 🌕", detail: "Peak illumination.", source: "orbit-axis-engine" },
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

/* ── Candidates ─────────────────────────────────────────────────────────── */

test("engine events become candidates with stable keys; junk is skipped, named", () => {
  const { candidates, skipped } = buildCandidates(EVENTS, CONTEXT);
  const keys = candidates.map((c) => c.eventKey);
  assert.ok(keys.includes("full_moon:2026-03-09"), "stable key = kind + date");
  assert.ok(keys.includes("daily_sky:2026-03-05"), "today's sky is a candidate in its own right");
  assert.ok(keys.includes("educational:why-apps-disagree"), "evergreen stock rides along");
  assert.deepEqual(skipped.map((s) => s.kind), ["comet_flyby", "malformed"],
    "unsupported and malformed are categories, never invented handling");
  for (const c of candidates) assert.ok(CANDIDATE_TYPES.includes(c.eventType), c.eventType);
  const twice = buildCandidates(EVENTS, CONTEXT);
  assert.deepEqual(twice.candidates.map((c) => c.eventKey), keys, "deterministic");
});

test("approximate sources stay approximate all the way through", () => {
  const { candidates } = buildCandidates(EVENTS, CONTEXT);
  const mercury = candidates.find((c) => c.eventType === "mercury_direct");
  assert.equal(mercury.approximate, true, "the table said approximate; the candidate says so too");
  const full = candidates.find((c) => c.eventType === "full_moon");
  assert.equal(full.approximate, false);
  assert.equal(full.source, "orbit-engine");
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

test("five formats, as code, each with a risk category a future cannot erase", () => {
  assert.equal(FORMAT_IDS.length, 5);
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
  const packet = buildPacket(candidates[1], "something_changed", ["full_moon:2026-02-08"]);
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
  const fs = readFileSync(new URL("../lib/orbit-x/ui.html", import.meta.url), "utf8");
  assert.ok(!/sk_(live|test)|whsec_|ORBIT_X_AI_API_KEY|service.role/i.test(fs), "no secret shapes in the page");
});

/* ── Persistence and lifecycle ──────────────────────────────────────────── */

test("saving stores verified facts write-once, beside the copy — never under it", async () => {
  const store = stubStore();
  const res = await handleOrbitXRoute("POST", "/api/orbit-x/posts", new URLSearchParams(),
    { eventKey: "educational:why-apps-disagree", format: "without_the_fog",
      copy: { ...goodPost("without_the_fog", 3) } },
    { ...AUTH }, { env: ENV_ON, store });
  assert.equal(res.status, 200);
  const row = store.inserted[0];
  assert.equal(row.event_key, "educational:why-apps-disagree");
  assert.equal(row.status, "draft");
  assert.ok(row.event_payload.facts.ground, "the verified packet is stored whole");
  assert.ok(row.edited_copy.headline, "the copy is stored beside it");
  // And the store's own allow-list makes facts unwritable afterwards:
  const real = orbitXStore(AUTH, { fetchImpl: async () => ({ ok: true, json: async () => [{}] }) });
  await assert.rejects(real.update("post-1", { event_payload: { forged: true } }), /not an editable column/);
});

test("duplicate coverage is refused unless the fresh treatment is deliberate", async () => {
  const store = stubStore({ coverage: [{ id: "old", status: "approved", created_at: "2026-03-01" }] });
  const body = { eventKey: "educational:what-is-a-transit", format: "without_the_fog", copy: goodPost("without_the_fog", 3) };
  const refused = await handleOrbitXRoute("POST", "/api/orbit-x/posts", new URLSearchParams(), body, { ...AUTH }, { env: ENV_ON, store });
  assert.equal(refused.status, 409);
  const allowed = await handleOrbitXRoute("POST", "/api/orbit-x/posts", new URLSearchParams(),
    { ...body, allowDuplicate: true }, { ...AUTH }, { env: ENV_ON, store });
  assert.equal(allowed.status, 200, "same event, NEW draft — deliberately");
});

test("the lifecycle refuses illegal jumps and nothing can become published", async () => {
  const draft = { id: "11111111-2222-4333-8444-555555555555", status: "draft", selected_format: "without_the_fog", event_payload: { facts: {} } };
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
  assert.ok(candidates.length >= EDUCATIONAL_TOPICS.length + 3, "sky + lunations + stock");
  assert.equal(skipped.length, 0, "the live pipeline produces nothing unsupported");
  const daily = candidates.find((c) => c.eventType === "daily_sky");
  assert.equal(daily.facts.moon_phase_name, context.moon_phase_name, "facts are the engine's, verbatim");
});

/* ── The manual lane: the desk owes nothing to a provider ───────────────── */

test("the manual scaffold passes every gate a generated draft must, for every format", () => {
  const { candidates } = buildCandidates(EVENTS, CONTEXT);
  const samples = [
    candidates.find((c) => c.eventType === "full_moon"),
    candidates.find((c) => c.eventType === "mercury_direct"),
    candidates.find((c) => c.eventType === "daily_sky"),
    candidates.find((c) => c.eventKey === "educational:why-apps-disagree"),
  ];
  for (const candidate of samples) {
    for (const formatId of FORMAT_IDS) {
      const post = manualScaffold(candidate, formatId);   // throws if invalid
      assert.equal(post.format, formatId);
      assert.equal(auditCopy(post).length, 0, `${formatId} scaffold trips no editorial rule`);
      assert.equal(verifyFactIntegrity(post, candidate.facts).length, 0,
        `${formatId} scaffold invents no dates for ${candidate.eventKey}`);
      assert.ok(post.editorialNotes.join(" ").includes("manual scaffold"),
        "a scaffold names itself so an unedited one never reads as finished");
    }
  }
  // Approximate candidates scaffold with "around", never a false precision.
  const mercury = samples[1];
  assert.match(manualScaffold(mercury, "something_changed").slides[0].body, /around 2026-03-14/);
});

test("the manual endpoint needs no provider and mirrors /generate's shape", async () => {
  // ENV_ON deliberately carries no ORBIT_X_AI_API_KEY.
  const store = stubStore();
  const res = await handleOrbitXRoute("POST", "/api/orbit-x/manual", new URLSearchParams(),
    { eventKey: "educational:why-birth-time-matters", format: "without_the_fog" },
    { ...AUTH }, { env: ENV_ON, store });
  assert.equal(res.status, 200);
  assert.equal(res.body.manual, true);
  assert.equal(res.body.usage, null);
  assert.ok(res.body.post.headline && res.body.post.slides.length >= 3);
  assert.ok(res.body.candidate.facts.ground, "the verified candidate rides along, same as /generate");
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

test("a manual draft saves through the full lifecycle and records human authorship", async () => {
  const store = stubStore();
  const { body } = await handleOrbitXRoute("POST", "/api/orbit-x/manual", new URLSearchParams(),
    { eventKey: "educational:what-is-a-transit", format: "without_the_fog" }, { ...AUTH }, { env: ENV_ON, store });
  const saved = await handleOrbitXRoute("POST", "/api/orbit-x/posts", new URLSearchParams(),
    { eventKey: "educational:what-is-a-transit", format: "without_the_fog",
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
