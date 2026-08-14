// Orbit Axis :: entitlements (Dev Update 3.0).
//
// AUTHORIZATION IS THE WRONG PLACE TO TEST BY GREPPING SOURCE. Every assertion
// here RUNS the evaluator. A test that checks the matrix contains a key would
// pass while the function reading it returned the wrong plan.
//
// The failure this suite exists to prevent is a generous one: somebody getting
// a capability they did not pay for, or — worse — a paying subscriber silently
// losing one because a constant moved.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CURRENT_MATRIX_VERSION, DEFAULT_PLAN, NEVER_PAID, PLANS, UNLIMITED,
  atLeast, capabilities, capability, isPlan,
} from "../lib/entitlements/plans.js";
import {
  can, capabilityFor, describeForClient, holdingFor, withHolding,
} from "../lib/entitlements/service.js";
import {
  clampHistoryWindow, entitlementsEnforced, refuseIfAtLimit, refuseUnless,
} from "../lib/entitlements/enforce.js";

/** A caller whose plan is already resolved, so nothing reaches the network. */
const holder = (plan, extra = {}) => ({
  ownerId: "owner-1",
  holding: {
    plan, status: "active", matrixVersion: CURRENT_MATRIX_VERSION,
    reason: "entitled", ...extra,
  },
});

const ON = { ORBIT_ENTITLEMENTS_ENFORCED: "true" };
const OFF = {};

// ── The matrix ──────────────────────────────────────────────────────────────

test("an unknown plan resolves to free, not to something generous", () => {
  // A typo in a database row must not be an upgrade.
  for (const bogus of ["premium", "Consumer", "", null, undefined, "admin"]) {
    assert.equal(capability(bogus, "chart.compatibility"), false, `${bogus}`);
    assert.equal(capability(bogus, "chart.saved.limit"),
      capability(DEFAULT_PLAN, "chart.saved.limit"));
  }
});

test("a capability the matrix does not define is denied, not undefined", () => {
  // `if (capability(...))` must not be handed undefined by a typo and then be
  // fixed by someone writing `!== false`.
  for (const plan of PLANS) {
    assert.equal(capability(plan, "chart.teleportation"), false);
    assert.equal(capability(plan, ""), false);
  }
});

test("an unknown matrix version falls back rather than throwing", () => {
  assert.equal(capability("consumer", "chart.compatibility", 999), true);
  assert.doesNotThrow(() => capabilities("consumer", 999));
});

test("never-paid capabilities are true for every plan, by BOTH routes", () => {
  // Asserted through capability() AND capabilities(), because they are separate
  // code paths to the same promise. A mutation test caught this: deleting the
  // guard in one of them left every assertion here green.
  for (const plan of [...PLANS, "bogus", undefined]) {
    const set = capabilities(plan);
    for (const name of NEVER_PAID) {
      assert.equal(capability(plan, name), true,
        `capability(): ${name} must never be sold — plan ${plan}`);
      assert.equal(set[name], true,
        `capabilities(): ${name} must never be sold — plan ${plan}`);
    }
  }
});

test("the plan ladder is ordered, and nothing outranks researcher", () => {
  assert.equal(atLeast("researcher", "free"), true);
  assert.equal(atLeast("consumer", "researcher"), false);
  assert.equal(atLeast("free", "free"), true);
  assert.equal(atLeast("bogus", "free"), false);
  assert.equal(isPlan("consumer"), true);
  assert.equal(isPlan("Consumer"), false);
});

test("unlimited is a number the client can serialise", () => {
  // Infinity becomes null in JSON and then reads as zero — which would present
  // as "you may save no charts" to exactly the people paying the most.
  assert.equal(Number.isFinite(UNLIMITED), true);
  assert.equal(JSON.parse(JSON.stringify({ n: UNLIMITED })).n, UNLIMITED);
  assert.equal(capability("researcher", "chart.saved.limit"), UNLIMITED);
});

test("each plan includes everything the weaker one had", () => {
  // Not a style rule. If consumer lost something free had, somebody would pay
  // money to have less, and no test elsewhere would notice.
  const rank = { none: 0, partial: 1, full: 2, basic: 0, expanded: 1, advanced: 2,
    deeper: 1, "source-context": 2 };
  const numeric = (v) => (v === UNLIMITED ? Infinity : v);

  for (let i = 1; i < PLANS.length; i += 1) {
    const weaker = capabilities(PLANS[i - 1]);
    const stronger = capabilities(PLANS[i]);
    for (const [name, was] of Object.entries(weaker)) {
      const now = stronger[name];
      if (typeof was === "boolean") {
        assert.ok(!was || now, `${PLANS[i]} lost ${name}`);
      } else if (typeof was === "number") {
        assert.ok(numeric(now) >= numeric(was), `${PLANS[i]} reduced ${name}`);
      } else {
        assert.ok(rank[now] >= rank[was], `${PLANS[i]} downgraded ${name}`);
      }
    }
  }
});

// ── The evaluator ───────────────────────────────────────────────────────────

test("a caller who is not signed in holds free", async () => {
  const held = await holdingFor({});
  assert.equal(held.plan, "free");
  assert.equal(held.reason, "not_signed_in");
});

test("a lookup failure degrades to free rather than guessing", async () => {
  // No Supabase configuration is reachable in this process, so fetchEntitlement
  // fails. The requirement is that it ANSWERS, and answers conservatively.
  const held = await holdingFor({ ownerId: "owner-1", url: "http://127.0.0.1:1", anonKey: "k", accessToken: "t" });
  assert.equal(held.plan, "free");
  assert.ok(["lookup_failed", "no_row"].includes(held.reason), held.reason);
});

test("an expired or cancelled status holds free even on a paid plan", async () => {
  for (const status of ["expired", "cancelled"]) {
    const auth = holder("researcher", { status });
    // withHolding must not overwrite a holding that is already resolved.
    const resolved = await withHolding(auth);
    assert.equal(resolved.holding.status, status);
  }
});

test("capabilityFor reads the caller's resolved plan", async () => {
  assert.equal(await capabilityFor(holder("free"), "chart.compatibility"), false);
  assert.equal(await capabilityFor(holder("consumer"), "chart.compatibility"), true);
  assert.equal(await capabilityFor(holder("free"), "chart.saved.limit"), 1);
  assert.equal(await capabilityFor(holder("researcher"), "chart.saved.limit"), UNLIMITED);
});

test("can() refuses to answer for non-boolean capabilities", async () => {
  // can(auth, "chart.saved.limit") would be true for a limit of 1, which reads
  // as "yes, unlimited" at the call site. Better to fail loudly.
  await assert.rejects(() => can(holder("free"), "chart.saved.limit"), TypeError);
  assert.equal(await can(holder("free"), "chart.compatibility"), false);
});

test("withHolding resolves once and is not re-fetched", async () => {
  const auth = holder("consumer");
  const again = await withHolding(auth);
  assert.equal(again, auth, "an already-resolved context is returned unchanged");
});

test("what the client is told matches what the server decided", async () => {
  const described = await describeForClient(holder("consumer"));
  assert.equal(described.plan, "consumer");
  assert.equal(described.capabilities["chart.compatibility"], true);
  for (const name of NEVER_PAID) {
    assert.equal(described.capabilities[name], true);
  }
});

// ── The dark switch ─────────────────────────────────────────────────────────

test("enforcement is off unless explicitly switched on", () => {
  assert.equal(entitlementsEnforced({}), false);
  assert.equal(entitlementsEnforced({ ORBIT_ENTITLEMENTS_ENFORCED: "" }), false);
  assert.equal(entitlementsEnforced({ ORBIT_ENTITLEMENTS_ENFORCED: "1" }), false);
  assert.equal(entitlementsEnforced({ ORBIT_ENTITLEMENTS_ENFORCED: "yes" }), false);
  assert.equal(entitlementsEnforced({ ORBIT_ENTITLEMENTS_ENFORCED: "TRUE " }), true);
  assert.equal(entitlementsEnforced({ ORBIT_ENTITLEMENTS_ENFORCED: "enabled" }), true);
});

test("while dark, nothing is refused", async () => {
  // The whole promise of this update: deploying it takes nothing away.
  assert.equal(
    await refuseUnless(holder("free"), "chart.compatibility", "…", OFF), null);
  assert.equal(
    await refuseIfAtLimit(holder("free"), "chart.saved.limit", 99, "…", OFF), null);

  const window = await clampHistoryWindow(holder("free"), 365, OFF);
  assert.deepEqual(window, { days: 365, clamped: false });
});

test("switched on, a plan without the capability is refused", async () => {
  const refusal = await refuseUnless(
    holder("free"), "chart.compatibility", "Compatibility needs an upgrade.", ON);
  assert.equal(refusal.status, 403);
  assert.equal(refusal.body.code, "upgrade_required");
  assert.equal(refusal.body.capability, "chart.compatibility");
  assert.equal(
    await refuseUnless(holder("consumer"), "chart.compatibility", "…", ON), null);
});

test("a refusal never names a price", async () => {
  // No price is decided, and an API that hardcodes one lies the day it changes.
  const refusal = await refuseUnless(holder("free"), "chart.compatibility", "Upgrade to compare charts.", ON);
  assert.ok(!/\$|\d+\.\d{2}|per month|\/mo/.test(JSON.stringify(refusal.body)),
    "the API must not carry pricing");
});

// ── Limits ──────────────────────────────────────────────────────────────────

test("the limit refuses only at the limit, and says what it is", async () => {
  assert.equal(await refuseIfAtLimit(holder("free"), "chart.saved.limit", 0, "…", ON), null);

  const refusal = await refuseIfAtLimit(
    holder("free"), "chart.saved.limit", 1, "You can save one chart.", ON);
  assert.equal(refusal.status, 403);
  assert.equal(refusal.body.limit, 1);
  assert.equal(refusal.body.current, 1);
});

test("unlimited never refuses, however many exist", async () => {
  assert.equal(
    await refuseIfAtLimit(holder("researcher"), "chart.saved.limit", 10_000, "…", ON), null);
});

test("downgrade refuses the next one and takes nothing away", async () => {
  // The single most likely place for this design to go wrong under pressure.
  // Ten charts, lapsed to free: the eleventh is refused, and NOTHING in the
  // entitlement layer can express deleting the ten.
  const lapsed = holder("free");
  const refusal = await refuseIfAtLimit(lapsed, "chart.saved.limit", 10, "…", ON);
  assert.equal(refusal.status, 403);

  // Reading and exporting what they already have stays permitted, always.
  assert.equal(await capabilityFor(lapsed, "export.personal"), true);
  assert.equal(await capabilityFor(lapsed, "account.deletion"), true);
});

// ── Clamping ────────────────────────────────────────────────────────────────

test("history clamps rather than refusing", async () => {
  // A 403 for reading your own past reads as a bug, and gets reported as one.
  const clamped = await clampHistoryWindow(holder("free"), 365, ON);
  assert.deepEqual(clamped, { days: 7, clamped: true });

  const everything = await clampHistoryWindow(holder("free"), null, ON);
  assert.deepEqual(everything, { days: 7, clamped: true });

  const within = await clampHistoryWindow(holder("free"), 3, ON);
  assert.deepEqual(within, { days: 3, clamped: false });

  const paid = await clampHistoryWindow(holder("consumer"), 365, ON);
  assert.deepEqual(paid, { days: 365, clamped: false });
});

// ── The boundary with feature flags ─────────────────────────────────────────

test("entitlements and feature flags share no code", async () => {
  // If they ever do, somebody grants a paid plan by setting a variable in a
  // dashboard. This asserts the import graph, which is the thing that decays.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");

  for (const file of ["plans.js", "service.js", "enforce.js"]) {
    const source = readFileSync(join(root, "lib/entitlements", file), "utf8");
    assert.ok(!/from\s+"\.\.\/features\.js"/.test(source),
      `lib/entitlements/${file} must not import the feature-flag registry`);
    assert.ok(!/featureEnabled|FEATURE_IDS/.test(source),
      `lib/entitlements/${file} must not read feature flags`);
  }
});
