// Orbit Axis :: first-party analytics (Dev Update 6.0).
//
// The failure this suite exists to prevent is a privacy regression that nobody
// notices: an event carrying content, an attribution field storing whatever was
// in the URL, a client claiming to be an account, or the admin metrics panel
// leaking a row about one person.
//
// Every assertion RUNS the code. Supabase is stubbed, because what is under
// test is this module's contract — what it validates, what it refuses, whose
// owner id it writes — and a live database would make that slower without
// making it stronger.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ATTRIBUTION_FIELDS, EVENT_NAMES, cleanAttribution, cleanLandingPath,
  cleanReferrerHost, isEventName, isIdentifier, validateEvent, validateSession,
} from "../lib/analytics/events.js";
import { recordEvent, recordSession, betaMetrics } from "../lib/analytics/service.js";
import { handleAnalyticsRoute } from "../lib/analytics/api.js";
import { campaignForPost, campaignKeyForPost, campaignUrl, CAMPAIGN_PARAM } from "../lib/orbit-x/campaign.js";

const SESSION = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const VISITOR = "9c858901-8a57-4791-81fe-4c455b099bc9";
const OWNER = "11111111-1111-4111-8111-111111111111";

// Injected rather than read from the environment. These tests assert WHAT gets
// written, so they must not depend on whether a .env file happens to exist —
// that made them pass under `npm run test:local` and fail under a bare
// `node --test`, which is a test that proves nothing.
const CONFIG = Object.freeze({ url: "https://stub.supabase.test", anonKey: "anon-key-stub" });

function stubFetch(response = [], { capture = [] } = {}) {
  const impl = async (url, options = {}) => {
    capture.push({ url: String(url), options, body: options.body ? JSON.parse(options.body) : null });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(response),
      headers: { get: () => "0-0/0" },
    };
  };
  impl.calls = capture;
  return impl;
}

/* ── The vocabulary is closed ─────────────────────────────────────────────── */

test("the event vocabulary is small, and closed", () => {
  // A list that grows without anyone noticing is how "analytics" becomes
  // "surveillance". If this number climbs, it should be a deliberate act.
  assert.ok(EVENT_NAMES.length <= 12, "the vocabulary should stay small on purpose");
  for (const name of EVENT_NAMES) assert.equal(isEventName(name), true);
  for (const bad of ["click", "scroll", "hover", "page_view", "", null, 7, "SIGNUP_COMPLETED"]) {
    assert.equal(isEventName(bad), false, `${bad} must not be accepted`);
  }
});

test("the vocabulary names the four questions the beta has", () => {
  for (const required of ["session_started", "signup_completed", "chart_created", "returning_session"]) {
    assert.ok(EVENT_NAMES.includes(required), `${required} is load-bearing for the funnel`);
  }
  // No event exists for the noisy interactions that would make this surveillance.
  for (const forbidden of EVENT_NAMES) {
    assert.ok(!/click|scroll|hover|focus|mouse|keypress/i.test(forbidden),
      `${forbidden} is an interaction event, not a product event`);
  }
});

/* ── Attribution is normalised, never stored raw ──────────────────────────── */

test("attribution values are bounded and stripped, never stored as sent", () => {
  assert.equal(cleanAttribution("Instagram"), "instagram");
  assert.equal(cleanAttribution("  daily-card  "), "daily-card");
  // The failure mode: a query parameter used as a storage endpoint for someone
  // else's content, or for a script.
  assert.equal(cleanAttribution("<script>alert(1)</script>"), "scriptalert1script");
  assert.equal(cleanAttribution("a".repeat(500)).length, 64);
  assert.equal(cleanAttribution("   "), null);
  assert.equal(cleanAttribution(null), null);
  assert.equal(cleanAttribution({ nope: true }), null);
});

test("only the four standard campaign fields are recognised", () => {
  assert.deepEqual([...ATTRIBUTION_FIELDS],
    ["utm_source", "utm_medium", "utm_campaign", "utm_content"]);
});

test("the referrer is reduced to a host, never a full address", () => {
  // A full referring URL can carry a path, a query, and occasionally somebody's
  // search terms. The host answers the only question Orbit is asking.
  assert.equal(cleanReferrerHost("https://www.instagram.com/p/abc123/?taken_by=someone"), "www.instagram.com");
  assert.equal(cleanReferrerHost("https://google.com/search?q=very+private+question"), "google.com");
  assert.equal(cleanReferrerHost("javascript:alert(1)"), null);
  assert.equal(cleanReferrerHost("not a url"), null);
  assert.equal(cleanReferrerHost(""), null);
});

test("the landing path drops its query string", () => {
  // That is where the utm values already captured separately would be, and
  // where anything accidentally personal would end up.
  assert.equal(cleanLandingPath("/?utm_source=instagram&email=someone@example.com"), "/");
  assert.equal(cleanLandingPath("/privacy#usage"), "/privacy");
  assert.equal(cleanLandingPath("https://evil.test/x"), null, "must be a path, not a URL");
  assert.equal(cleanLandingPath(""), null);
});

/* ── Validation ───────────────────────────────────────────────────────────── */

test("an event needs a known name and two real identifiers", () => {
  assert.deepEqual(validateEvent({ name: "today_opened", session_id: SESSION, visitor_id: VISITOR }),
    { name: "today_opened", session_id: SESSION, visitor_id: VISITOR });
  assert.equal(validateEvent({ name: "invented", session_id: SESSION, visitor_id: VISITOR }), null);
  assert.equal(validateEvent({ name: "today_opened", session_id: "not-a-uuid", visitor_id: VISITOR }), null);
  assert.equal(validateEvent(null), null);
  assert.equal(isIdentifier("../../etc/passwd"), false);
});

test("an event carries a name and a time, and nothing else survives", () => {
  // The guarantee the privacy page makes, enforced here: extra fields a client
  // sends are dropped rather than stored.
  const clean = validateEvent({
    name: "tarot_saved", session_id: SESSION, visitor_id: VISITOR,
    card: "the-tower", question: "will I be ok?", birth_date: "1990-06-15", owner_id: "someone-else",
  });
  assert.deepEqual(Object.keys(clean).sort(), ["name", "session_id", "visitor_id"]);
  const serialized = JSON.stringify(clean);
  for (const leak of ["the-tower", "will I be ok", "1990-06-15", "someone-else"]) {
    assert.ok(!serialized.includes(leak), `${leak} must not survive validation`);
  }
});

test("a session row keeps only normalised attribution", () => {
  const row = validateSession({
    session_id: SESSION, visitor_id: VISITOR,
    landing_path: "/?utm_source=Instagram&secret=abc",
    referrer: "https://www.instagram.com/p/xyz/",
    utm_source: "Instagram", utm_medium: "Social", utm_campaign: "daily-card", utm_content: "slide-1",
    campaign_key: "ox-3f2504e0",
    ip: "203.0.113.9", user_agent: "Mozilla/5.0", email: "someone@example.com",
  });
  assert.equal(row.utm_source, "instagram");
  assert.equal(row.referrer_host, "www.instagram.com");
  assert.equal(row.landing_path, "/");
  assert.equal(row.campaign_key, "ox-3f2504e0");
  // Anything Orbit did not ask for is absent, not merely unused.
  const keys = Object.keys(row);
  for (const forbidden of ["ip", "user_agent", "email", "referrer"]) {
    assert.ok(!keys.includes(forbidden), `${forbidden} must never reach a stored row`);
  }
});

/* ── Ownership ────────────────────────────────────────────────────────────── */

test("a client cannot file an event under an account", async () => {
  // The same rule the rest of Orbit follows: who a write belongs to comes from
  // the verified session, never from the body.
  const calls = [];
  const fetchImpl = stubFetch([], { capture: calls });
  await recordEvent(
    { name: "chart_created", session_id: SESSION, visitor_id: VISITOR, owner_id: "22222222-2222-4222-8222-222222222222" },
    { ownerId: null, fetchImpl, config: CONFIG });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.owner_id, null, "a forged owner must not survive");
  assert.ok(!JSON.stringify(calls[0].body).includes("22222222"));
});

test("a signed-in event is attributed to the verified session's account", async () => {
  const calls = [];
  const fetchImpl = stubFetch([], { capture: calls });
  await recordEvent({ name: "chart_created", session_id: SESSION, visitor_id: VISITOR },
    { ownerId: OWNER, fetchImpl, config: CONFIG });
  assert.equal(calls[0].body.owner_id, OWNER);
});

test("a rejected event never reaches the database", async () => {
  const calls = [];
  const fetchImpl = stubFetch([], { capture: calls });
  const written = await recordEvent({ name: "not_a_real_event", session_id: SESSION, visitor_id: VISITOR },
    { ownerId: null, fetchImpl, config: CONFIG });
  assert.equal(written, false);
  assert.equal(calls.length, 0, "validation must happen before the request, not after");
});

test("a visit is a plain insert, because an upsert would need read access", async () => {
  // PostgREST resolves on_conflict by reading the existing row, so an upsert
  // requires SELECT — which anon deliberately does not have on these tables.
  // Asking for one returned 401 and silently recorded nothing. The primary key
  // already makes a replayed beacon a no-op, so the upsert bought nothing and
  // cost everything.
  const calls = [];
  const fetchImpl = stubFetch([], { capture: calls });
  const written = await recordSession({ session_id: SESSION, visitor_id: VISITOR, utm_source: "instagram" }, { fetchImpl, config: CONFIG });
  assert.equal(written, true);
  assert.ok(!calls[0].url.includes("on_conflict"),
    "an upsert here needs a SELECT grant that would expose every visit");
  assert.equal(calls[0].body.id, SESSION, "the session id is the primary key that makes this idempotent");
});

test("a replayed landing beacon is refused by the database, not duplicated", async () => {
  // The second insert of the same primary key fails, and that failure is
  // swallowed exactly like any other write failure — the first landing, which
  // carries the attribution, is the one that stands.
  const conflicting = async () => ({ ok: false, status: 409, text: async () => "duplicate key" });
  assert.equal(await recordSession({ session_id: SESSION, visitor_id: VISITOR }, { fetchImpl: conflicting, config: CONFIG }), false);
});

test("a storage failure is swallowed rather than surfaced", async () => {
  // A count that cannot be written must never become an error the reader meets.
  const angry = async () => { throw new Error("supabase is down"); };
  assert.equal(await recordEvent({ name: "today_opened", session_id: SESSION, visitor_id: VISITOR },
    { ownerId: null, fetchImpl: angry, config: CONFIG }), false);
  assert.equal(await recordSession({ session_id: SESSION, visitor_id: VISITOR }, { fetchImpl: angry, config: CONFIG }), false);
});

/* ── The HTTP surface ─────────────────────────────────────────────────────── */

test("the beacon accepts unconditionally and explains nothing", async () => {
  // 202 whether or not anything was stored: a beacon that reported validation
  // failures would be a map of what to forge.
  const good = await handleAnalyticsRoute("POST", "/api/analytics/event",
    { name: "today_opened", session_id: SESSION, visitor_id: VISITOR },
    { auth: null, fetchImpl: stubFetch(), config: CONFIG });
  assert.equal(good.status, 202);

  const bad = await handleAnalyticsRoute("POST", "/api/analytics/event",
    { name: "invented_event", session_id: "nope", visitor_id: "nope" },
    { auth: null, fetchImpl: stubFetch(), config: CONFIG });
  assert.equal(bad.status, 202, "a refused event answers exactly like an accepted one");
  assert.deepEqual(bad.body, { ok: true });
});

test("the metrics panel is invisible to anyone who is not an admin", async () => {
  // 404 rather than 403, matching the Orbit X desk: an internal surface does
  // not confirm it exists to an account that cannot use it.
  for (const context of [
    { auth: null, isAdmin: false },
    { auth: { ownerId: OWNER }, isAdmin: false },
  ]) {
    const res = await handleAnalyticsRoute("GET", "/api/analytics/metrics", {}, context);
    assert.equal(res.status, 404);
    assert.equal(res.body.code, "not_found");
  }
});

test("unknown analytics routes are not claimed", async () => {
  assert.equal(await handleAnalyticsRoute("GET", "/api/analytics/nonsense", {}, {}), null);
  assert.equal(await handleAnalyticsRoute("DELETE", "/api/analytics/event", {}, {}), null);
});

/* ── The metrics themselves ───────────────────────────────────────────────── */

test("the metrics panel reports aggregates and never a person", async () => {
  const sessions = [
    { visitor_id: VISITOR, created_at: "2026-08-01T10:00:00Z", utm_source: "instagram" },
    { visitor_id: VISITOR, created_at: "2026-08-03T10:00:00Z", utm_source: "instagram" },
    { visitor_id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", created_at: "2026-08-04T10:00:00Z", utm_source: null },
  ];
  const events = [
    { name: "signup_completed", visitor_id: VISITOR, owner_id: OWNER, occurred_at: "2026-08-01T10:05:00Z" },
    { name: "today_opened", visitor_id: VISITOR, owner_id: OWNER, occurred_at: "2026-08-03T10:05:00Z" },
  ];
  let call = 0;
  const fetchImpl = async (url, options = {}) => {
    call += 1;
    const body = String(url).includes("analytics_events") ? events
      : String(url).includes("analytics_sessions") ? sessions
      : { users_total: 2 };
    return { ok: true, status: 200, text: async () => JSON.stringify(body), headers: { get: () => "0-0/0" } };
  };

  const metrics = await betaMetrics({
    auth: { url: "https://stub.test", anonKey: "anon", accessToken: "token", ownerId: OWNER },
    now: new Date("2026-08-05T00:00:00Z"),
    fetchImpl,
  });

  assert.equal(metrics.visits.unique_visitors_30d, 2);
  assert.equal(metrics.visits.returning_visitors_30d, 1, "one visitor was seen on two distinct days");
  assert.equal(metrics.acquisition.by_source_30d.instagram, 2);
  // One person, two visits from the same source, one signup. Counting the
  // signup twice — once per visit — is the bug this assertion exists to catch.
  const instagram = metrics.acquisition.conversion_by_source_30d.instagram;
  assert.deepEqual(instagram, { visits: 2, visitors: 1, signups: 1 });
  assert.equal(metrics.usage_30d.today_opened, 1);

  // The load-bearing privacy assertion: no identifier for any individual is in
  // the output the panel renders.
  const serialized = JSON.stringify(metrics);
  assert.ok(!serialized.includes(VISITOR), "a visitor id must not reach the panel");
  assert.ok(!serialized.includes(OWNER), "an account id must not reach the panel");
  assert.ok(!/@/.test(serialized), "no address of any kind belongs in aggregates");
  assert.ok(Array.isArray(metrics.caveats) && metrics.caveats.length >= 2,
    "the numbers ship with their own limitations attached");
});

/* ── Orbit X campaign keys ────────────────────────────────────────────────── */

test("a campaign key is derived from the post, and is stable", () => {
  const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  assert.equal(campaignKeyForPost(id), "ox-3f2504e0");
  assert.equal(campaignKeyForPost(id), campaignKeyForPost(id), "the same post always yields the same key");
  assert.equal(campaignKeyForPost("not-a-uuid"), null);
  assert.equal(campaignKeyForPost(null), null);
});

test("a campaign link carries the content key and no personal data", () => {
  const url = campaignUrl({
    baseUrl: "https://orbit-axis-omega.vercel.app",
    post: { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", reading_type: "daily" },
    source: "Instagram",
  });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get(CAMPAIGN_PARAM), "ox-3f2504e0");
  assert.equal(parsed.searchParams.get("utm_medium"), "social");
  assert.equal(parsed.searchParams.get("utm_campaign"), "daily");
  assert.equal(parsed.searchParams.get("utm_source"), "instagram");
  // The key identifies the POST. Nothing about an account or a reader is in it.
  assert.ok(!/owner|user|account|email/i.test(url));
  // http is refused: a campaign link is published, and Orbit vouches for it.
  assert.equal(campaignUrl({ baseUrl: "http://example.test", post: { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" } }), null);
});

test("a campaign key says a link was made, never that anything was posted", () => {
  // Exporting is not publishing. campaignForPost works on an exported post and
  // asserts nothing about a platform, because Orbit has no connection to one.
  const post = { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", status: "exported" };
  const campaign = campaignForPost(post, { baseUrl: "https://orbit-axis-omega.vercel.app" });
  assert.equal(campaign.key, "ox-3f2504e0");
  assert.ok(!("published_at" in campaign) && !("external_media_id" in campaign),
    "the reserved publication fields belong to a publisher that does not exist");
});
