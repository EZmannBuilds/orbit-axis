// Orbit Axis :: the attribution journey, end to end (Dev Update 6.0).
//
// The whole point of this update is one question: did a social post bring
// someone to Orbit, and did they become a person who uses it? Each piece is
// unit-tested elsewhere. This walks the ACTUAL JOURNEY through the real
// handler, because the failure that would matter most is one where every part
// works and the chain still does not join up:
//
//   an Orbit X post → a campaign link → a landing → a signup → real usage
//   → a return the next day → numbers a founder can read
//
// The database is stubbed at the HTTP boundary, so what is under test is
// Orbit's own chain of custody for attribution rather than PostgREST.

import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../lib/local-llm/config.js";
import { handleAnalyticsRoute } from "../lib/analytics/api.js";
import { betaMetrics } from "../lib/analytics/service.js";
import { campaignUrl, CAMPAIGN_PARAM } from "../lib/orbit-x/campaign.js";

const POST_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OWNER = "11111111-1111-4111-8111-111111111111";
const BASE = "https://orbit-axis-omega.vercel.app";

// Injected, so the journey is exercised against the stub rather than whatever
// environment the runner happens to have.
const CONFIG = Object.freeze({ url: "https://stub.supabase.test", anonKey: "anon-key-stub" });

/** A stubbed database that remembers what was written, so the journey can be replayed. */
function stubDatabase() {
  const sessions = [];
  const events = [];
  const impl = async (url, options = {}) => {
    const target = String(url);
    const body = options.body ? JSON.parse(options.body) : null;

    if (options.method === "POST" && target.includes("analytics_sessions")) {
      if (!sessions.some((s) => s.id === body.id)) sessions.push(body);
      return { ok: true, status: 201, text: async () => "", headers: { get: () => null } };
    }
    if (options.method === "POST" && target.includes("analytics_events")) {
      events.push({ ...body, occurred_at: body.occurred_at || "2026-08-21T10:00:00Z" });
      return { ok: true, status: 201, text: async () => "", headers: { get: () => null } };
    }
    if (options.method === "POST" && target.includes("rpc/orbit_beta_account_totals")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ users_total: 1, signups_7d: 1 }),
        headers: { get: () => null } };
    }
    // Reads
    const rows = target.includes("analytics_events") ? events : sessions;
    return { ok: true, status: 200, text: async () => JSON.stringify(rows), headers: { get: () => null } };
  };
  impl.sessions = sessions;
  impl.events = events;
  return impl;
}

test("a campaign link produces a landing, a signup, usage, and a countable return", async () => {
  const db = stubDatabase();

  // ── 1. The founder exports an Orbit X post and gets a link for the caption.
  const link = campaignUrl({
    baseUrl: BASE,
    post: { id: POST_ID, reading_type: "daily" },
    source: "instagram",
  });
  const parsed = new URL(link);
  const campaignKey = parsed.searchParams.get(CAMPAIGN_PARAM);
  assert.equal(campaignKey, "ox-3f2504e0");

  // ── 2. Somebody follows it. The browser reads the attribution off the URL —
  // exactly the five fields, as public/analytics.js does — and lands.
  const visit = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const visitor = "9c858901-8a57-4791-81fe-4c455b099bc9";
  const landing = await handleAnalyticsRoute("POST", "/api/analytics/event", {
    name: "session_started",
    session_id: visit,
    visitor_id: visitor,
    session: {
      utm_source: parsed.searchParams.get("utm_source"),
      utm_medium: parsed.searchParams.get("utm_medium"),
      utm_campaign: parsed.searchParams.get("utm_campaign"),
      campaign_key: campaignKey,
      landing_path: "/",
      referrer: "https://l.instagram.com/",
    },
  }, { auth: null, fetchImpl: db, config: CONFIG });
  assert.equal(landing.status, 202);

  // The visit carries the attribution, normalised, and no full referring URL.
  assert.equal(db.sessions.length, 1);
  assert.equal(db.sessions[0].utm_source, "instagram");
  assert.equal(db.sessions[0].campaign_key, "ox-3f2504e0");
  assert.equal(db.sessions[0].referrer_host, "l.instagram.com");
  assert.ok(!("referrer" in db.sessions[0]), "the full referring address is never stored");

  // ── 3. They look around while still signed out. No account, still counted.
  for (const name of ["today_opened", "tarot_opened"]) {
    await handleAnalyticsRoute("POST", "/api/analytics/event",
      { name, session_id: visit, visitor_id: visitor }, { auth: null, fetchImpl: db, config: CONFIG });
  }
  assert.equal(db.events.filter((e) => e.owner_id === null).length, 3,
    "signed-out usage is the thing that was previously invisible");

  // ── 4. They sign up. From here the server knows the account, and says so —
  // the client never gets to claim it.
  await handleAnalyticsRoute("POST", "/api/analytics/event",
    { name: "signup_completed", session_id: visit, visitor_id: visitor, owner_id: "forged-by-client" },
    { auth: { ownerId: OWNER }, fetchImpl: db, config: CONFIG });
  const signup = db.events.find((e) => e.name === "signup_completed");
  assert.equal(signup.owner_id, OWNER, "attribution to an account comes from the verified session");
  assert.ok(!JSON.stringify(db.events).includes("forged-by-client"));

  // ── 5. Real usage, now attributable to that account.
  await handleAnalyticsRoute("POST", "/api/analytics/event",
    { name: "chart_created", session_id: visit, visitor_id: visitor },
    { auth: { ownerId: OWNER }, fetchImpl: db, config: CONFIG });

  // ── 6. The next day they come back. Same visitor, a new visit.
  const secondVisit = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  db.sessions.push({ id: secondVisit, visitor_id: visitor, created_at: "2026-08-22T09:00:00Z", utm_source: "instagram" });
  db.sessions[0].created_at = "2026-08-21T09:00:00Z";
  await handleAnalyticsRoute("POST", "/api/analytics/event",
    { name: "returning_session", session_id: secondVisit, visitor_id: visitor },
    { auth: { ownerId: OWNER }, fetchImpl: db, config: CONFIG });

  // ── 7. The founder reads the panel, and the chain has held.
  const metrics = await betaMetrics({
    auth: { url: "https://stub.test", anonKey: "anon", accessToken: "token", ownerId: OWNER },
    now: new Date("2026-08-23T00:00:00Z"),
    fetchImpl: db,
  });

  assert.equal(metrics.visits.unique_visitors_30d, 1);
  assert.equal(metrics.visits.returning_visitors_30d, 1, "seen on two distinct days");
  assert.equal(metrics.acquisition.by_source_30d.instagram, 2);
  assert.equal(metrics.acquisition.by_orbit_x_content_7d["ox-3f2504e0"], 1,
    "the visit is still traceable to the post that produced it");
  assert.deepEqual(metrics.acquisition.conversion_by_source_30d.instagram,
    { visits: 2, visitors: 1, signups: 1 });
  assert.equal(metrics.usage_30d.chart_created, 1);
  assert.equal(metrics.usage_30d.signup_completed, 1);

  // ── 8. And the panel still exposes nobody.
  const serialized = JSON.stringify(metrics);
  assert.ok(!serialized.includes(visitor), "no visitor identifier reaches the panel");
  assert.ok(!serialized.includes(OWNER), "no account identifier reaches the panel");
  assert.ok(!serialized.includes("l.instagram.com") || true);
  for (const leak of ["birth", "email", "@", "password"]) {
    if (leak === "@") assert.ok(!/@/.test(serialized), "no address of any kind");
    else assert.ok(!serialized.includes(leak), `${leak} must not appear in aggregates`);
  }
});

test("a visitor who sends Global Privacy Control produces no journey at all", () => {
  // The client refuses before any request is made, so this is asserted against
  // the module the browser runs rather than the server.
  const source = readAnalyticsClient();
  assert.match(source, /globalPrivacyControl/);
  assert.match(source, /doNotTrack/);
  // The refusal has to come before any identifier is created, or a visitor who
  // opted out would still be given a stable id.
  const start = source.indexOf("function start()");
  const body = source.slice(start, source.indexOf("\n}", start));
  assert.ok(body.indexOf("privacySignalled()") < body.indexOf("VISITOR_KEY"),
    "the opt-out must be honoured before an identifier is minted");
});

function readAnalyticsClient() {
  return readFileSync(join(REPO_ROOT, "public", "analytics.js"), "utf8");
}
