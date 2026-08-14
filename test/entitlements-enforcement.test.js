// Orbit Axis :: entitlement enforcement, through the real handlers (Dev Update 3.0).
//
// test/entitlements.test.js proves the EVALUATOR is right. This proves the
// handlers actually ask it — which is a different claim, and the one that fails
// silently. Wiring that is never exercised looks identical to wiring that
// works, right up until an offer launches and nothing is gated.
//
// These call `handleCompatibilityRoute` itself rather than a copy of its logic.
// No Supabase is reached: the refusal is returned before any query runs, which
// is itself worth pinning — an authorization check that costs a database round
// trip is one somebody eventually moves for performance.

import { test } from "node:test";
import assert from "node:assert/strict";

import { handleCompatibilityRoute } from "../lib/compatibility/api.js";
import { CURRENT_MATRIX_VERSION } from "../lib/entitlements/plans.js";

/**
 * An authenticated caller with a plan already resolved.
 *
 * The Supabase fields are shaped so requireOwner() is satisfied. They point
 * nowhere: if enforcement ever stopped short-circuiting, these tests would fail
 * on a connection error rather than passing quietly, which is the failure mode
 * we want.
 */
const caller = (plan) => ({
  url: "http://127.0.0.1:1",
  anonKey: "anon",
  accessToken: "token",
  ownerId: "00000000-0000-4000-8000-000000000001",
  holding: {
    plan, status: "active", matrixVersion: CURRENT_MATRIX_VERSION, reason: "entitled",
  },
});

// The switch is read from process.env by the enforcement helpers, so these
// tests set it there rather than threading an env argument the handler does
// not take.
const compare = (auth) => handleCompatibilityRoute(
  "GET",
  "/api/compatibility/compare",
  new URLSearchParams({ a: "11111111-1111-4111-8111-111111111111", b: "22222222-2222-4222-8222-222222222222" }),
  {},
  auth,
);

// ── Dark ────────────────────────────────────────────────────────────────────

test("while dark, a free caller is not refused by the entitlement layer", async () => {
  // The promise of shipping 3.0: deploying it takes nothing away. Whatever this
  // returns, it must not be the upgrade refusal.
  delete process.env.ORBIT_ENTITLEMENTS_ENFORCED;
  const result = await compare(caller("free"));
  assert.notEqual(result?.body?.code, "upgrade_required",
    "nothing may be gated until enforcement is switched on");
});

// ── Switched on ─────────────────────────────────────────────────────────────

test("switched on, a free caller is refused before any query runs", async (t) => {
  process.env.ORBIT_ENTITLEMENTS_ENFORCED = "true";
  t.after(() => { delete process.env.ORBIT_ENTITLEMENTS_ENFORCED; });

  const result = await compare(caller("free"));
  assert.equal(result.status, 403);
  assert.equal(result.body.code, "upgrade_required");
  assert.equal(result.body.capability, "chart.compatibility");

  // Reaching Supabase would have thrown or hung on 127.0.0.1:1. Returning a
  // clean 403 is the evidence that the check came first.
  assert.equal(result.body.ok, false);
});

test("switched on, a paying caller is not refused by the entitlement layer", async (t) => {
  process.env.ORBIT_ENTITLEMENTS_ENFORCED = "true";
  t.after(() => { delete process.env.ORBIT_ENTITLEMENTS_ENFORCED; });

  // Consumer passes the gate and proceeds — and then fails on the unreachable
  // database, which is exactly right: the entitlement layer got out of the way.
  const result = await compare(caller("consumer")).catch((e) => ({ threw: e }));
  const code = result?.body?.code;
  assert.notEqual(code, "upgrade_required",
    "a consumer plan includes compatibility and must not be gated");
});

test("the refusal names the capability and no price", async (t) => {
  process.env.ORBIT_ENTITLEMENTS_ENFORCED = "true";
  t.after(() => { delete process.env.ORBIT_ENTITLEMENTS_ENFORCED; });

  const body = JSON.stringify((await compare(caller("free"))).body);
  assert.ok(/chart\.compatibility/.test(body), "the client needs to know WHICH capability");
  assert.ok(!/\$|\d+\.\d{2}|per month|\/mo|price/i.test(body),
    "no price is decided; an API that hardcodes one lies the day it changes");
});

// ── The options endpoint stays open ─────────────────────────────────────────

test("listing which charts COULD be compared is never gated", async (t) => {
  process.env.ORBIT_ENTITLEMENTS_ENFORCED = "true";
  t.after(() => { delete process.env.ORBIT_ENTITLEMENTS_ENFORCED; });

  // A locked door you can read the sign on is honest. An empty room is a bug
  // report. /options must not return the upgrade refusal.
  const result = await handleCompatibilityRoute(
    "GET", "/api/compatibility/options", new URLSearchParams(), {}, caller("free"),
  ).catch((e) => ({ threw: e }));

  assert.notEqual(result?.body?.code, "upgrade_required");
});
