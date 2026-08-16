// Orbit Axis :: relationship-aware compatibility, proved over the wire (1.11).
//
// INTEGRATION tests against the REAL HTTP route: a real createOrbitApp handler
// on a real loopback port, real session cookies, a real local Supabase stack
// with RLS, and two disposable synthetic users.
//
// This suite boots rather than greps, and that is not a style preference. Two
// releases ago a set of green unit tests read the source and missed both a
// route that 500ed on every request and a write the service silently dropped,
// because reading a file cannot tell you what a handler returns. Everything
// asserted below is asserted on a response body.
//
// No owner data, no real names, no real relationship information, no real birth
// data. Every fixture is synthetic and deleted in after().

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";

const URL_ = process.env.ORBIT_TEST_SUPABASE_URL || "http://127.0.0.1:55321";
const ANON = process.env.ORBIT_TEST_SUPABASE_ANON_KEY
  || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
process.env.SUPABASE_URL = URL_;
process.env.SUPABASE_ANON_KEY = ANON;
process.env.GEOAPIFY_API_KEY = "compatibility-suite-synthetic-location-secret";
process.env.ORBIT_ENVIRONMENT = process.env.ORBIT_ENVIRONMENT || "test";

const isLoopback = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(URL_.replace(/\/+$/, ""));

const { createOrbitApp } = await import("../lib/server/create-app.js");
const { resolveEnvironment, classifyDatabaseTarget } = await import("../lib/env/environment.js");
const { SESSION_COOKIE } = await import("../lib/auth/supabase-auth.js");
const { safePlaceForClient } = await import("../lib/locations/geoapify.js");

if (classifyDatabaseTarget(URL_).target === "production") {
  throw new Error("Refusing to run compatibility tests against the hosted production database.");
}

// ── Synthetic fixtures ──────────────────────────────────────────────────────
// Invented dates and an invented city. None of these describe a real person and
// no two of them describe anybody's actual relationship.

const PLACE = {
  provider: "geoapify",
  provider_place_id: "compatibility-suite-synthetic-place",
  label: "Synthetic City, Testland",
  city: "Synthetic City", region: "Testland",
  country: "Testland", country_code: "tl",
  latitude: 40.7128, longitude: -74.006,
};
const chartInput = (extra = {}) => ({
  birth_date: "1990-06-15", birth_time: "08:30", time_accuracy: "exact",
  birthplace: safePlaceForClient(PLACE),
  ...extra,
});

let reachable = false;
let server = null, BASE = "";
let userA = null, userB = null;
const RESPONSES = [];

const realFetch = globalThis.fetch;

async function makeUser() {
  const email = `orbit-compat-suite-${randomUUID()}@example.test`;
  const password = `Test-${randomUUID()}`;             // synthetic, never a real credential
  const res = await realFetch(`${URL_}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`local signup failed: ${String(data.msg || res.status).slice(0, 120)}`);
  return { id: data.user.id, email, accessToken: data.access_token, refreshToken: data.refresh_token || null };
}

function cookieFor(user) {
  const payload = {
    access_token: user.accessToken, refresh_token: user.refreshToken,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: user.id, email: user.email },
  };
  return `${SESSION_COOKIE}=${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

async function call(method, path, { user = null, body } = {}) {
  const h = {};
  if (user) h.cookie = cookieFor(user);
  if (body !== undefined) h["content-type"] = "application/json";
  const res = await realFetch(`${BASE}${path}`, {
    method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  if (text) RESPONSES.push(text);
  return { status: res.status, json, text };
}

const rest = async (path, { token, method = "GET", body, prefer } = {}) => {
  const headers = { apikey: ANON, "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (prefer) headers.prefer = prefer;
  const res = await realFetch(`${URL_}/rest/v1/${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  return { status: res.status, json, text };
};

async function createChart(user, extra = {}) {
  const res = await call("POST", "/api/charts", { user, body: chartInput(extra) });
  assert.equal(res.status, 200, `chart create failed: ${JSON.stringify(res.json).slice(0, 200)}`);
  return res.json.profile;
}

/**
 * Force a stored relationship value the API itself refuses to write.
 *
 * `other`, `public_figure`, and NULL exist on rows created before 1.10 and can
 * never be produced through the current interface — so the only honest way to
 * test that they are blocked is to write them the way history wrote them.
 */
async function forceRelationship(user, chartId, value) {
  const r = await rest(`birth_profiles?id=eq.${chartId}`, {
    token: user.accessToken, method: "PATCH",
    body: { relationship_type: value }, prefer: "return=representation",
  });
  assert.equal(r.status, 200, `could not seed legacy relationship: ${r.text.slice(0, 160)}`);
  assert.equal(r.json?.[0]?.relationship_type ?? null, value);
}

const skipped = (t) => {
  if (!reachable) {
    t.skip(`local Supabase not reachable at ${URL_} — run "supabase start" and apply migrations`);
    return true;
  }
  return false;
};

// Charts used across the suite.
let selfA = null;        // user A, relationship self, primary
let selfA2 = null;       // user A, a second self record (self mode needs two)
let partnerA = null, friendA = null, familyA = null;
let legacyOther = null, legacyPublic = null, legacyNull = null;
let selfB = null;        // user B — never visible to A

before(async () => {
  if (!isLoopback) return;
  try {
    const res = await realFetch(`${URL_}/rest/v1/`, { headers: { apikey: ANON }, signal: AbortSignal.timeout(2500) });
    reachable = res.status < 500;
  } catch { reachable = false; }
  if (!reachable) return;

  const env = resolveEnvironment({
    env: { ORBIT_ENVIRONMENT: "local", SUPABASE_URL: URL_, SUPABASE_ANON_KEY: ANON },
    loadEnvFiles: false,
  });
  server = http.createServer(createOrbitApp({ env }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  BASE = `http://127.0.0.1:${server.address().port}`;

  userA = await makeUser();
  userB = await makeUser();

  selfA = await createChart(userA);                                    // first chart → My Chart / self
  // Different birth details so the comparisons are not all the same geometry.
  selfA2 = await createChart(userA, { nickname: "Alt Time", relationship_type: "self", birth_time: "19:45" });
  partnerA = await createChart(userA, { nickname: "Fixture P", relationship_type: "partner", birth_date: "1988-02-03", birth_time: "14:10" });
  friendA = await createChart(userA, { nickname: "Fixture F", relationship_type: "friend", birth_date: "1988-02-03", birth_time: "14:10" });
  familyA = await createChart(userA, { nickname: "Fixture M", relationship_type: "family", birth_date: "1988-02-03", birth_time: "14:10" });
  legacyOther = await createChart(userA, { nickname: "Fixture Legacy O", relationship_type: "friend", birth_date: "1975-11-09" });
  legacyPublic = await createChart(userA, { nickname: "Fixture Legacy P", relationship_type: "friend", birth_date: "1975-11-09" });
  legacyNull = await createChart(userA, { nickname: "Fixture Legacy N", relationship_type: "friend", birth_date: "1975-11-09" });
  await forceRelationship(userA, legacyOther.id, "other");
  await forceRelationship(userA, legacyPublic.id, "public_figure");
  await forceRelationship(userA, legacyNull.id, null);

  selfB = await createChart(userB);
});

after(async () => {
  // Every fixture chart and both synthetic accounts go away. Charts first, so
  // the owner-scoped delete path is the one that runs.
  if (reachable) {
    for (const [user, charts] of [[userA, [selfA, selfA2, partnerA, friendA, familyA, legacyOther, legacyPublic, legacyNull]], [userB, [selfB]]]) {
      for (const c of charts.filter(Boolean)) {
        await call("DELETE", `/api/charts/${c.id}`, { user }).catch(() => {});
      }
    }
  }
  if (server) await new Promise((r) => server.close(r));
});

// ── The boundary ────────────────────────────────────────────────────────────

test("compatibility requires a session", async (t) => {
  if (skipped(t)) return;
  for (const path of ["/api/compatibility/options", `/api/compatibility/compare?a=${selfA.id}&b=${partnerA.id}`]) {
    const res = await call("GET", path);
    assert.equal(res.status, 401, `${path} should refuse an anonymous caller`);
    assert.equal(res.json?.ok, false);
  }
});

test("another owner's chart is 404, not 403", async (t) => {
  if (skipped(t)) return;
  // The distinction matters: 403 would confirm the id exists on some account.
  const res = await call("GET", `/api/compatibility/compare?a=${selfA.id}&b=${selfB.id}`, { user: userA });
  assert.equal(res.status, 404);
  assert.equal(res.json.code, "not_found");
  // And the reverse direction, so the subject slot is not a softer boundary.
  const reverse = await call("GET", `/api/compatibility/compare?a=${selfB.id}&b=${partnerA.id}`, { user: userA });
  assert.equal(reverse.status, 404);
});

test("a chart that does not exist is indistinguishable from one that is not yours", async (t) => {
  if (skipped(t)) return;
  const ghost = await call("GET", `/api/compatibility/compare?a=${selfA.id}&b=${randomUUID()}`, { user: userA });
  const theirs = await call("GET", `/api/compatibility/compare?a=${selfA.id}&b=${selfB.id}`, { user: userA });
  assert.equal(ghost.status, theirs.status);
  assert.deepEqual(ghost.json, theirs.json);
});

test("malformed ids are refused before any query runs", async (t) => {
  if (skipped(t)) return;
  for (const bad of ["", "not-a-uuid", "1 OR 1=1", "../../etc/passwd", `${selfA.id}'`]) {
    const res = await call("GET", `/api/compatibility/compare?a=${encodeURIComponent(bad)}&b=${partnerA.id}`, { user: userA });
    assert.equal(res.status, 400, `"${bad}" should be refused`);
    assert.equal(res.json.code, "invalid_input");
  }
});

test("compatibility is read-only", async (t) => {
  if (skipped(t)) return;
  for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
    const res = await call(method, `/api/compatibility/compare?a=${selfA.id}&b=${partnerA.id}`, { user: userA, body: {} });
    assert.notEqual(res.status, 200, `${method} must not produce a comparison`);
  }
});

test("comparing a chart with itself is refused", async (t) => {
  if (skipped(t)) return;
  const res = await call("GET", `/api/compatibility/compare?a=${selfA.id}&b=${selfA.id}`, { user: userA });
  assert.equal(res.status, 400);
  assert.equal(res.json.code, "same_chart");
});

// ── Legacy relationship values are blocked, never mapped ────────────────────

test("legacy relationship values are blocked with an identity prompt", async (t) => {
  if (skipped(t)) return;
  for (const [chart, stored] of [[legacyOther, "other"], [legacyPublic, "public_figure"], [legacyNull, null]]) {
    const res = await call("GET", `/api/compatibility/compare?a=${selfA.id}&b=${chart.id}`, { user: userA });
    assert.equal(res.status, 409, `stored ${stored} should be blocked`);
    assert.equal(res.json.code, "relationship_required");
    // The response must point at the chart to fix and offer the real choices,
    // so the interface can send the person somewhere rather than apologise.
    assert.equal(res.json.chart_id, chart.id);
    assert.equal(res.json.remedy, "set_relationship");
    assert.deepEqual(res.json.allowed, ["partner", "friend", "family", "self"]);
    // Nothing anywhere may have quietly picked a mode.
    assert.equal(res.json.mode, undefined);
    assert.equal(res.json.comparison, undefined);
  }
});

test("a blocked chart is listed as unavailable rather than hidden", async (t) => {
  if (skipped(t)) return;
  const res = await call("GET", "/api/compatibility/options", { user: userA });
  assert.equal(res.status, 200);
  const byId = new Map(res.json.options.options.map((o) => [o.id, o]));
  for (const chart of [legacyOther, legacyPublic, legacyNull]) {
    const entry = byId.get(chart.id);
    assert.ok(entry, "a chart must never vanish from the picker");
    assert.equal(entry.available, false);
    assert.equal(entry.unavailable_reason, "relationship_required");
  }
  // And the usable ones are usable.
  assert.equal(byId.get(partnerA.id).available, true);
});

// ── The core claim: same astrology, different question ──────────────────────

test("the same two charts read differently per relationship type", async (t) => {
  if (skipped(t)) return;
  const got = {};
  for (const [mode, chart] of [["partner", partnerA], ["friend", friendA], ["family", familyA]]) {
    const res = await call("GET", `/api/compatibility/compare?a=${selfA.id}&b=${chart.id}`, { user: userA });
    assert.equal(res.status, 200, JSON.stringify(res.json).slice(0, 200));
    assert.equal(res.json.comparison.mode, mode);
    got[mode] = res.json.comparison;
  }

  // partnerA, friendA and familyA share identical birth details, so the
  // underlying astrology is the same in all three. If the contact counts ever
  // differ, the relationship type has started changing the chart — which is
  // the one thing this feature must never do.
  const contacts = new Set(Object.values(got).map((c) => c.evidence_summary.contacts));
  assert.equal(contacts.size, 1, "relationship type must not change the astrology");

  // The categories, however, must differ.
  const ids = (c) => c.categories.map((x) => x.id).join(",");
  assert.notEqual(ids(got.partner), ids(got.friend));
  assert.notEqual(ids(got.friend), ids(got.family));

  // Attraction is asked only of a partner. Friend and family mode do not score
  // it under another name; the theme is dropped entirely.
  assert.ok(got.partner.categories.some((c) => c.id === "attraction_intimacy"));
  for (const mode of ["friend", "family"]) {
    assert.ok(!got[mode].categories.some((c) => /attract|intimacy|romanc|sexual/i.test(c.id + c.label)),
      `${mode} mode must not score attraction`);
  }
});

test("every category explains itself", async (t) => {
  if (skipped(t)) return;
  const res = await call("GET", `/api/compatibility/compare?a=${selfA.id}&b=${partnerA.id}`, { user: userA });
  const c = res.json.comparison;

  assert.ok(c.overall.summary.length > 40, "the overall result must be a sentence, not a number");
  for (const cat of c.categories) {
    assert.ok(typeof cat.summary === "string" && cat.summary.length > 20,
      `${cat.id} has no readable summary: ${JSON.stringify(cat.summary)}`);
    assert.ok(cat.question, `${cat.id} must say what it is asking`);
    if (!cat.hasEvidence) continue;
    // A score with nothing behind it is the thing this feature exists to avoid.
    const factors = [...cat.supporting, ...cat.straining, ...cat.mixed];
    assert.ok(factors.length > 0, `${cat.id} scored ${cat.score} with no named evidence`);
    for (const f of factors) {
      assert.ok(/ and /.test(f.headline), `factor must name both sides: ${f.headline}`);
      assert.ok(f.technical.includes("orb"), "the technical detail must carry the orb");
    }
  }
  // The methodology and the disclaimer travel with the result, not beside it.
  assert.ok(c.methodology.note.includes("not guaranteed relationship outcomes"));
  assert.ok(c.methodology.points.some((p) => /not written by an AI|fixed, reviewed library/i.test(p)));
  assert.equal(c.version, "compatibility-v1");
});

test("results are deterministic across identical requests", async (t) => {
  if (skipped(t)) return;
  const path = `/api/compatibility/compare?a=${selfA.id}&b=${partnerA.id}`;
  const first = await call("GET", path, { user: userA });
  const second = await call("GET", path, { user: userA });
  assert.equal(first.status, 200);
  assert.deepEqual(second.json.comparison, first.json.comparison,
    "the same two charts must always produce the same reading");
});

// ── Self mode ───────────────────────────────────────────────────────────────

test("self mode compares records, never two people", async (t) => {
  if (skipped(t)) return;
  const res = await call("GET", `/api/compatibility/compare?a=${selfA.id}&b=${selfA2.id}`, { user: userA });
  assert.equal(res.status, 200, JSON.stringify(res.json).slice(0, 200));
  const c = res.json.comparison;
  assert.equal(c.mode, "self");
  assert.equal(c.framing.title, "Self Pattern Comparison");
  assert.match(c.framing.subtitle, /not a comparison between two people/i);

  const text = JSON.stringify({ ...c, methodology: undefined });
  assert.ok(!/\btheir\b/i.test(text), "self mode must not refer to 'their' anything");
  assert.ok(!/\bpartner\b/i.test(text), "self mode must never invoke a partner");
  // The relationship bands would read as a verdict on the person themselves.
  assert.ok(!/Supportive|Challenging/.test(text),
    "self mode must use its own alignment bands, not relationship bands");
});

test("self mode requires two distinct self charts", async (t) => {
  if (skipped(t)) return;
  // userB has exactly one self chart, so the option surface must say so up
  // front rather than let them pick their way into a refusal.
  const res = await call("GET", "/api/compatibility/options", { user: userB });
  assert.equal(res.status, 200);
  assert.equal(res.json.options.self_chart_count, 1);
  assert.equal(res.json.options.self_comparison_available, false);

  // userA has two, so it is offered.
  const mine = await call("GET", "/api/compatibility/options", { user: userA });
  assert.equal(mine.json.options.self_chart_count, 2);
  assert.equal(mine.json.options.self_comparison_available, true);
});

test("two other charts compare when neither is the owner's own", async (t) => {
  if (skipped(t)) return;
  // The case that was actually broken. relationship_type says how someone
  // relates to the OWNER, and a general comparison never consults it — but the
  // required-relationship check ran before the general branch, so comparing
  // two saved charts failed whenever the second had no type set. Which is most
  // saved charts.
  const res = await call("GET", `/api/compatibility/compare?a=${friendA.id}&b=${partnerA.id}`, { user: userA });
  assert.equal(res.status, 200, JSON.stringify(res.json).slice(0, 200));
  assert.equal(res.json.comparison.mode, "general");
});

test("two charts that are not the owner compare, without claiming a relationship", async (t) => {
  if (skipped(t)) return;
  // This used to be a 409. Comparing a friend with a partner is a real and
  // reasonable thing to want — the geometry between two charts does not
  // require the reader to be one of them — so it now returns a comparison.
  //
  // What it must NOT do is keep the relationship label. "partner" means "this
  // person is my partner", relative to the owner; carrying it into a
  // comparison between two other people would assert a relationship between
  // them that nobody has claimed exists. General mode is the answer: it
  // compares the charts and says plainly that it is not reading a bond.
  const res = await call("GET", `/api/compatibility/compare?a=${friendA.id}&b=${partnerA.id}`, { user: userA });
  assert.equal(res.status, 200);
  assert.equal(res.json.comparison.mode, "general");
  assert.equal(res.json.comparison.framing.title, "Chart Comparison");
  assert.match(res.json.comparison.framing.subtitle, /without assuming a relationship/);
  // The stored relationship may still be ECHOED — that chart genuinely is the
  // owner's partner, and hiding it would be its own kind of dishonesty. What
  // must not happen is the READING describing a partnership between two people
  // who never claimed one, so the assertion is on the authored copy.
  const copy = JSON.stringify({
    framing: res.json.comparison.framing,
    categories: res.json.comparison.categories,
    summary: res.json.comparison.summary,
  });
  assert.ok(!/\bpartner|\bfriendship|\bfamily member/i.test(copy),
    "a general comparison must not describe a relationship in its reading");
});

// ── Privacy and persistence ─────────────────────────────────────────────────

test("no internal identifiers reach the client", async (t) => {
  if (skipped(t)) return;
  const res = await call("GET", `/api/compatibility/compare?a=${selfA.id}&b=${partnerA.id}`, { user: userA });
  const text = JSON.stringify(res.json);
  assert.ok(!text.includes(userA.id), "the owner's user id must never appear in a comparison");
  assert.ok(!text.includes("avatar_storage_path"), "the storage path stays server-side");
  assert.ok(!text.includes("owner_id"));
  assert.ok(!text.includes(userA.email));
  // Birth data belongs to the chart, not to a comparison of two charts.
  assert.ok(!text.includes("1990-06-15") && !text.includes("Synthetic City"),
    "a comparison must not restate birth details");
});

test("a comparison is derived, never stored", async (t) => {
  if (skipped(t)) return;
  const tables = ["birth_profiles", "chart_calculations"];
  const before_ = {};
  for (const tb of tables) {
    const r = await rest(`${tb}?select=id`, { token: userA.accessToken });
    before_[tb] = (r.json || []).length;
  }
  for (let i = 0; i < 3; i++) {
    const res = await call("GET", `/api/compatibility/compare?a=${selfA.id}&b=${partnerA.id}`, { user: userA });
    assert.equal(res.status, 200);
  }
  for (const tb of tables) {
    const r = await rest(`${tb}?select=id`, { token: userA.accessToken });
    assert.equal((r.json || []).length, before_[tb],
      `${tb} grew — compatibility must persist nothing`);
  }
});

test("no fatalistic or deterministic language in any mode", async (t) => {
  if (skipped(t)) return;
  const banned = /\b(will (?:fail|succeed|last|end)|destined|doomed|soulmate|meant to be|never work|perfect match|incompatible|toxic|red flag)\b/i;
  for (const chart of [partnerA, friendA, familyA, selfA2]) {
    const res = await call("GET", `/api/compatibility/compare?a=${selfA.id}&b=${chart.id}`, { user: userA });
    assert.equal(res.status, 200);
    const text = JSON.stringify({ ...res.json.comparison, methodology: undefined });
    const hit = text.match(banned);
    assert.equal(hit, null, `${res.json.comparison.mode} mode used "${hit?.[0]}"`);
  }
});
