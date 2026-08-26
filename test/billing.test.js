// Orbit Axis :: billing (Dev Update 3.10).
//
// THE FAILURES THIS SUITE EXISTS TO PREVENT, IN ORDER OF HOW BADLY THEY END:
//
//   1. an unsigned request grants a plan
//   2. a replayed event grants a plan twice
//   3. an out-of-order event un-cancels a subscription
//   4. a price nobody mapped grants the wrong plan
//   5. a purchase arrives with no way to tell whose it is
//
// Every one of those is a pure-function bug, which is why the modules are split
// the way they are: the parts worth testing take literals and return values,
// and the parts that cannot be tested without a service-role key do nothing
// except make an HTTP call with what those functions produced.
//
// Nothing here touches the network or needs a key.

import { test } from "node:test";
import assert from "node:assert/strict";

import { CURRENT_MATRIX_VERSION } from "../lib/entitlements/plans.js";
import { validateIntent, rowFor, STATUSES, SOURCES, GRANT_PURPOSE }
  from "../lib/entitlements/grant.js";
import {
  parseSignatureHeader, expectedSignature, verifyStripeSignature,
} from "../lib/billing/stripe-signature.js";
import { intentFromStripeEvent, priceMapFrom, HANDLED_TYPES }
  from "../lib/billing/intents.js";
import { checkoutForm, priceIdFor, PURCHASABLE } from "../lib/billing/checkout.js";
import { SERVICE_ROLE_PURPOSES, serviceRoleVerdict, PURPOSE_VAR, PROJECT_VAR }
  from "../lib/env/service-role.js";
import { PRODUCTION_PROJECT_REF } from "../lib/env/known-targets.js";

const OWNER = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const SECRET = "whsec_test_secret";
const PRICE_MAP = { price_consumer: "consumer", price_researcher: "researcher" };

/** A subscription event, valid unless a test breaks one part of it. */
function subscriptionEvent(overrides = {}) {
  const { type, created, ...subscription } = overrides;
  return {
    id: "evt_1",
    type: type || "customer.subscription.updated",
    created: created ?? 1_760_000_000,
    data: {
      object: {
        status: "active",
        current_period_end: 1_762_000_000,
        cancel_at_period_end: false,
        metadata: { orbit_owner_id: OWNER },
        items: { data: [{ price: { id: "price_consumer" } }] },
        ...subscription,
      },
    },
  };
}

// ── The intent contract ─────────────────────────────────────────────────────

test("a well-formed intent validates", () => {
  const v = validateIntent({
    ownerId: OWNER, plan: "consumer", status: "active", source: "stripe",
    currentPeriodEnd: "2026-09-01T00:00:00.000Z",
  });
  assert.equal(v.ok, true);
});

test("an intent is refused unless every field is one of the closed sets", () => {
  const base = { ownerId: OWNER, plan: "consumer", status: "active", source: "stripe" };
  for (const [field, value] of [
    ["ownerId", "cus_12345"],          // a Stripe customer id is not an owner id
    ["ownerId", "not-a-uuid"],
    ["plan", "premium"],               // not in the matrix
    ["plan", "FREE"],                  // case matters
    ["status", "past_due"],            // Stripe's word, not Orbit's
    ["source", "paypal"],
  ]) {
    const v = validateIntent({ ...base, [field]: value });
    assert.equal(v.ok, false, `${field}=${value} should be refused`);
  }
});

test("a refusal never echoes the identifier it rejected", () => {
  // This runs on data from an external provider; a rejected value is exactly
  // what should not be copied into a log line.
  const v = validateIntent({
    ownerId: "cus_leaky_identifier", plan: "consumer", status: "active", source: "stripe",
  });
  assert.equal(v.ok, false);
  assert.ok(!v.reason.includes("cus_leaky_identifier"));
});

test("an unparseable period end is refused rather than stored as never-expires", () => {
  const v = validateIntent({
    ownerId: OWNER, plan: "consumer", status: "active", source: "stripe",
    currentPeriodEnd: "next tuesday",
  });
  assert.equal(v.ok, false);
});

test("the row is stamped with the matrix in force now", () => {
  // The whole reason the column exists: today's purchase buys today's
  // capabilities, and a later matrix must not quietly take one away.
  const row = rowFor({
    ownerId: OWNER, plan: "researcher", status: "active", source: "stripe",
    currentPeriodEnd: "2026-09-01T00:00:00.000Z",
  });
  assert.equal(row.matrix_version, CURRENT_MATRIX_VERSION);
  assert.equal(row.owner_id, OWNER);
  assert.equal(row.current_period_end, "2026-09-01T00:00:00.000Z");
});

test("a missing period end becomes null, not the epoch", () => {
  const row = rowFor({ ownerId: OWNER, plan: "consumer", status: "active", source: "manual" });
  assert.equal(row.current_period_end, null);
});

test("the status and source sets match the database's check constraints", () => {
  // Mirrored rather than shared, so drift is caught here instead of at 3am by
  // a failing insert.
  assert.deepEqual([...STATUSES], ["active", "grace", "expired", "cancelled"]);
  assert.deepEqual([...SOURCES], ["manual", "stripe", "app_store", "play"]);
});

// ── Signature verification: the only authentication there is ────────────────

test("a signature Stripe actually produced verifies", () => {
  const body = Buffer.from(JSON.stringify(subscriptionEvent()));
  const t = 1_760_000_000;
  const header = `t=${t},v1=${expectedSignature(body, t, SECRET)}`;
  const v = verifyStripeSignature({ rawBody: body, header, secret: SECRET, nowSeconds: t });
  assert.equal(v.ok, true);
});

test("one changed byte fails", () => {
  const body = Buffer.from(JSON.stringify(subscriptionEvent()));
  const t = 1_760_000_000;
  const header = `t=${t},v1=${expectedSignature(body, t, SECRET)}`;
  const tampered = Buffer.from(JSON.stringify(subscriptionEvent({ status: "canceled" })));
  const v = verifyStripeSignature({ rawBody: tampered, header, secret: SECRET, nowSeconds: t });
  assert.equal(v.ok, false);
});

test("a different secret fails", () => {
  const body = Buffer.from("{}");
  const t = 1_760_000_000;
  const header = `t=${t},v1=${expectedSignature(body, t, "whsec_someone_elses")}`;
  const v = verifyStripeSignature({ rawBody: body, header, secret: SECRET, nowSeconds: t });
  assert.equal(v.ok, false);
});

test("an old but validly signed event is refused", () => {
  // A correctly signed event from last year is still one Orbit must not act on.
  const body = Buffer.from("{}");
  const t = 1_760_000_000;
  const header = `t=${t},v1=${expectedSignature(body, t, SECRET)}`;
  const v = verifyStripeSignature({ rawBody: body, header, secret: SECRET, nowSeconds: t + 3600 });
  assert.equal(v.ok, false);
  assert.match(v.reason, /tolerance/);
});

test("a timestamp far in the future is refused too", () => {
  // Only guarding the past would accept a signature minted with a skewed clock
  // and valid indefinitely.
  const body = Buffer.from("{}");
  const t = 1_760_000_000;
  const header = `t=${t},v1=${expectedSignature(body, t, SECRET)}`;
  const v = verifyStripeSignature({ rawBody: body, header, secret: SECRET, nowSeconds: t - 3600 });
  assert.equal(v.ok, false);
});

test("during a secret rotation, either signature is accepted", () => {
  // Stripe signs with both while a secret is being rotated. Checking only the
  // first would fail half the deliveries.
  const body = Buffer.from("{}");
  const t = 1_760_000_000;
  const header = `t=${t},v1=${expectedSignature(body, t, "whsec_old")},`
    + `v1=${expectedSignature(body, t, SECRET)}`;
  const v = verifyStripeSignature({ rawBody: body, header, secret: SECRET, nowSeconds: t });
  assert.equal(v.ok, true);
});

test("a malformed header fails closed instead of throwing", () => {
  for (const header of ["", "garbage", "t=abc,v1=zz", "v1=deadbeef", `t=1,v1=${"x".repeat(5000)}`]) {
    const v = verifyStripeSignature({
      rawBody: Buffer.from("{}"), header, secret: SECRET, nowSeconds: 1,
    });
    assert.equal(v.ok, false, `"${header.slice(0, 20)}" should not verify`);
  }
});

test("v0 test-mode signatures are not accepted", () => {
  const { signatures } = parseSignatureHeader("t=1,v0=deadbeef");
  assert.equal(signatures.length, 0);
});

test("no configured secret means nothing verifies", () => {
  const v = verifyStripeSignature({ rawBody: Buffer.from("{}"), header: "t=1,v1=ab", secret: "" });
  assert.equal(v.ok, false);
});

// ── Translating an event into an instruction ────────────────────────────────

test("an active subscription grants the mapped plan until the period ends", () => {
  const r = intentFromStripeEvent(subscriptionEvent(), PRICE_MAP);
  assert.equal(r.ignored, false);
  assert.deepEqual(r.intent, {
    ownerId: OWNER,
    plan: "consumer",
    status: "active",
    source: "stripe",
    currentPeriodEnd: new Date(1_762_000_000 * 1000).toISOString(),
  });
});

test("a failed card becomes grace, not a lockout", () => {
  for (const status of ["past_due", "unpaid"]) {
    const r = intentFromStripeEvent(subscriptionEvent({ status }), PRICE_MAP);
    assert.equal(r.intent.status, "grace", status);
  }
});

test("a deleted subscription expires whatever the status field says", () => {
  const r = intentFromStripeEvent(
    subscriptionEvent({ type: "customer.subscription.deleted", status: "active" }), PRICE_MAP);
  assert.equal(r.intent.status, "expired");
});

test("a status Orbit has never heard of costs access rather than granting it", () => {
  const r = intentFromStripeEvent(subscriptionEvent({ status: "quantum_superposition" }), PRICE_MAP);
  assert.equal(r.intent.status, "expired");
});

test("cancelling while paid through the period records cancelled", () => {
  // NOTE: service.js does not currently treat 'cancelled' as entitling, so this
  // revokes access immediately. That disagreement between the migration's
  // intent and the evaluator is flagged in intents.js and is a product
  // decision. This test pins what is WRITTEN, so whichever way that decision
  // goes, the change is visible here.
  const r = intentFromStripeEvent(
    subscriptionEvent({ status: "active", cancel_at_period_end: true }), PRICE_MAP);
  assert.equal(r.intent.status, "cancelled");
});

test("a subscription with no Orbit metadata is ignored, not guessed at", () => {
  const r = intentFromStripeEvent(subscriptionEvent({ metadata: {} }), PRICE_MAP);
  assert.equal(r.ignored, true);
  assert.equal(r.intent, null);
});

test("an email is never accepted as an identity", () => {
  const r = intentFromStripeEvent(
    subscriptionEvent({ metadata: {}, customer_email: "erik@example.com" }), PRICE_MAP);
  assert.equal(r.ignored, true);
});

test("an unmapped price grants nothing", () => {
  const r = intentFromStripeEvent(
    subscriptionEvent({ items: { data: [{ price: { id: "price_from_some_other_product" } }] } }),
    PRICE_MAP);
  assert.equal(r.ignored, true);
  assert.match(r.reason, /not mapped/);
});

test("event types Orbit does not act on are ignored, and checkout is one of them", () => {
  for (const type of ["checkout.session.completed", "invoice.paid", "ping"]) {
    const r = intentFromStripeEvent(subscriptionEvent({ type }), PRICE_MAP);
    assert.equal(r.ignored, true, type);
  }
  assert.deepEqual([...HANDLED_TYPES], [
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
  ]);
});

test("a malformed event is ignored rather than thrown", () => {
  for (const event of [null, {}, { type: "customer.subscription.updated" },
    { type: "customer.subscription.updated", data: {} }]) {
    const r = intentFromStripeEvent(event, PRICE_MAP);
    assert.equal(r.ignored, true);
    assert.ok(typeof r.occurredAt === "string");
  }
});

test("the price map is built only from prices that are actually configured", () => {
  assert.deepEqual(priceMapFrom({}), {});
  assert.deepEqual(priceMapFrom({ STRIPE_PRICE_CONSUMER: "price_x" }), { price_x: "consumer" });
});

// ── Checkout: where the owner id gets attached ──────────────────────────────

test("the owner id is stamped onto the SUBSCRIPTION, not just the session", () => {
  // client_reference_id does not travel onto customer.subscription.* events,
  // which is what the webhook reads. If this assertion ever goes, payments
  // arrive with nothing to attach them to.
  const form = checkoutForm({
    ownerId: OWNER, priceId: "price_consumer",
    successUrl: "https://example.test/ok", cancelUrl: "https://example.test/no",
  });
  assert.equal(form.get("subscription_data[metadata][orbit_owner_id]"), OWNER);
  assert.equal(form.get("client_reference_id"), OWNER);
  assert.equal(form.get("mode"), "subscription");
});

test("free is not purchasable", () => {
  assert.deepEqual([...PURCHASABLE], ["consumer", "researcher"]);
  assert.equal(priceIdFor("free", { STRIPE_PRICE_CONSUMER: "price_x" }), null);
});

// ── The service-role authorization this all depends on ──────────────────────

test("billing-webhook is an authorized purpose", () => {
  assert.ok(SERVICE_ROLE_PURPOSES.includes(GRANT_PURPOSE));
});

test("two purposes can be authorized at once, and each is matched whole", () => {
  const env = {
    [PURPOSE_VAR]: "account-deletion,billing-webhook",
    [PROJECT_VAR]: PRODUCTION_PROJECT_REF,
    SUPABASE_SERVICE_ROLE_KEY: "key",
    SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
  };
  const context = { environment: "production", isVercel: false };
  for (const purpose of ["account-deletion", "billing-webhook"]) {
    assert.equal(serviceRoleVerdict(purpose, env, context).authorized, true, purpose);
  }
});

test("a prefix does not authorize a purpose", () => {
  // "billing" must never authorize "billing-webhook".
  const verdict = serviceRoleVerdict("billing-webhook", {
    [PURPOSE_VAR]: "billing",
    [PROJECT_VAR]: PRODUCTION_PROJECT_REF,
    SUPABASE_SERVICE_ROLE_KEY: "key",
    SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
  }, { environment: "production" });
  assert.equal(verdict.authorized, false);
});

test("the billing webhook cannot write outside production", () => {
  for (const environment of ["local", "test", "preview"]) {
    const verdict = serviceRoleVerdict("billing-webhook", {
      [PURPOSE_VAR]: "billing-webhook",
      [PROJECT_VAR]: PRODUCTION_PROJECT_REF,
      SUPABASE_SERVICE_ROLE_KEY: "key",
      SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
    }, { environment });
    assert.equal(verdict.authorized, false, environment);
  }
});
