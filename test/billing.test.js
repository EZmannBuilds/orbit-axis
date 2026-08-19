// Orbit Axis :: web billing (Dev Update 3.10).
//
// The rule the whole suite holds: MONEY STATE MOVES ONLY ON A VERIFIED
// WEBHOOK. The browser's word grants nothing, a replayed delivery applies
// nothing twice, an out-of-order delivery never moves state backwards, and no
// identifier a user can edit — an email above all — ever selects whose
// subscription changes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { billingConfig, billingOrigin, intervalForPrice, PAID_PLAN } from "../lib/billing/config.js";
import { formEncode, signPayloadForTest, verifyWebhookSignature, BillingError } from "../lib/billing/stripe.js";
import {
  GRACE_DAYS, applyStripeEvent, beginCheckout, describeBilling,
  entitlementForSubscription, subscriptionRow,
} from "../lib/billing/service.js";
import { handleStripeWebhook, handleBillingRoute } from "../lib/billing/api.js";
import { capability } from "../lib/entitlements/plans.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const ENV = {
  STRIPE_SECRET_KEY: "sk_test_stub",
  STRIPE_WEBHOOK_SECRET: "whsec_stub_secret",
  STRIPE_PRICE_MONTHLY_ID: "price_month_stub",
  STRIPE_PRICE_ANNUAL_ID: "price_year_stub",
};

/** An in-memory store with the same contract as billingStore(). */
function memoryStore(seed = {}) {
  const rows = new Map(Object.entries(seed.rows || {}));
  const events = new Set(seed.events || []);
  const entitlements = new Map();
  return {
    rows, events, entitlements,
    read: async (ownerId) => rows.get(ownerId) || null,
    ownerForCustomer: async (cus) =>
      [...rows.entries()].find(([, r]) => r.stripe_customer_id === cus)?.[0] || null,
    linkCustomer: async (ownerId, cus, created) => {
      rows.set(ownerId, { ...(rows.get(ownerId) || {}), owner_id: ownerId,
        stripe_customer_id: cus, last_event_created: new Date(created * 1000).toISOString() });
    },
    upsert: async (row) => { rows.set(row.owner_id, { ...(rows.get(row.owner_id) || {}), ...row }); },
    entitle: async (ownerId, fields) => { entitlements.set(ownerId, fields); },
    recordEvent: async (id) => { if (events.has(id)) return "replay"; events.add(id); return "new"; },
  };
}

function subEvent(type, sub, { id = `evt_${Math.random().toString(36).slice(2)}`, created = 1_800_000_000 } = {}) {
  return { id, type, created, data: { object: sub } };
}

const SUB = (overrides = {}) => ({
  id: "sub_1", customer: "cus_1", status: "active",
  current_period_end: 1_802_592_000, cancel_at_period_end: false,
  metadata: { orbit_user_id: OWNER },
  items: { data: [{ price: { id: "price_month_stub", product: "prod_1", recurring: { interval: "month" } } }] },
  ...overrides,
});

/* ── Signatures ─────────────────────────────────────────────────────────── */

test("a genuine signature verifies and a forged one does not", () => {
  const body = JSON.stringify({ id: "evt_1", type: "x" });
  const good = signPayloadForTest(body, "whsec_stub_secret");
  assert.equal(verifyWebhookSignature(body, good, "whsec_stub_secret").ok, true);
  assert.equal(verifyWebhookSignature(body, good, "whsec_other").ok, false, "wrong secret");
  assert.equal(verifyWebhookSignature(body + " ", good, "whsec_stub_secret").ok, false,
    "one changed byte of body fails — the RAW bytes are what is signed");
  assert.equal(verifyWebhookSignature(body, "t=abc,v1=zz", "whsec_stub_secret").ok, false, "malformed header");
  assert.equal(verifyWebhookSignature(body, null, "whsec_stub_secret").ok, false, "absent header");
});

test("a captured delivery cannot be replayed outside the tolerance window", () => {
  const body = "{}";
  const old = signPayloadForTest(body, "whsec_stub_secret", { timestamp: 1000 });
  assert.equal(verifyWebhookSignature(body, old, "whsec_stub_secret", { nowSeconds: 1000 + 301 }).ok, false);
  assert.equal(verifyWebhookSignature(body, old, "whsec_stub_secret", { nowSeconds: 1000 + 299 }).ok, true);
});

test("the webhook endpoint refuses an unsigned delivery outright", async () => {
  const body = Buffer.from(JSON.stringify(subEvent("customer.subscription.created", SUB())));
  const res = await handleStripeWebhook(body, "t=1,v1=forged", { env: ENV, store: memoryStore(), admin: { url: "x", serviceKey: "y" } });
  assert.equal(res.status, 400);
  assert.ok(!JSON.stringify(res.body).includes("tolerance"), "the reason stays in the log, not the response");
});

/* ── Idempotency and ordering ───────────────────────────────────────────── */

test("a replayed event id is acknowledged and applied zero times", async () => {
  const store = memoryStore();
  const event = subEvent("customer.subscription.created", SUB(), { id: "evt_once" });
  const first = await applyStripeEvent(event, store, { env: ENV });
  const second = await applyStripeEvent(event, store, { env: ENV });
  assert.equal(first.outcome, "applied");
  assert.equal(second.outcome, "replay");
  assert.equal(store.entitlements.size, 1, "the second delivery wrote nothing");
});

test("an out-of-order older event never moves state backwards", async () => {
  const store = memoryStore();
  await applyStripeEvent(subEvent("customer.subscription.updated", SUB({ status: "active" }), { created: 2000 }), store, { env: ENV });
  const stale = await applyStripeEvent(
    subEvent("customer.subscription.updated", SUB({ status: "past_due" }), { created: 1000 }), store, { env: ENV });
  assert.equal(stale.outcome, "stale");
  assert.equal(store.rows.get(OWNER).status, "active", "yesterday's delivery does not overwrite today's state");
});

/* ── The lifecycle ──────────────────────────────────────────────────────── */

test("activation: a paid subscription grants Pro through the read model", async () => {
  const store = memoryStore();
  const result = await applyStripeEvent(subEvent("customer.subscription.created", SUB()), store, { env: ENV });
  assert.equal(result.outcome, "applied");
  const grant = store.entitlements.get(OWNER);
  assert.equal(grant.plan, PAID_PLAN);
  assert.equal(grant.status, "active");
  assert.equal(grant.source, "stripe");
  assert.ok(grant.current_period_end, "the clock backstop has a date to expire against");
  const row = store.rows.get(OWNER);
  assert.equal(row.billing_interval, "month");
  assert.equal(row.stripe_price_id, "price_month_stub");
});

test("a plan change updates the interval without touching anything it should not", async () => {
  const store = memoryStore();
  await applyStripeEvent(subEvent("customer.subscription.created", SUB(), { created: 1000 }), store, { env: ENV });
  const yearly = SUB({ items: { data: [{ price: { id: "price_year_stub", product: "prod_1", recurring: { interval: "year" } } }] } });
  await applyStripeEvent(subEvent("customer.subscription.updated", yearly, { created: 2000 }), store, { env: ENV });
  assert.equal(store.rows.get(OWNER).billing_interval, "year");
  assert.equal(store.entitlements.get(OWNER).plan, PAID_PLAN, "still Pro across the change");
});

test("payment failure: past_due keeps Pro in grace, with a real horizon", async () => {
  const now = Date.parse("2026-08-19T12:00:00Z");
  const store = memoryStore();
  await applyStripeEvent(subEvent("customer.subscription.updated",
    SUB({ status: "past_due", current_period_end: Math.floor(now / 1000) - 3600 })), store, { env: ENV, nowMs: now });
  const grant = store.entitlements.get(OWNER);
  assert.equal(grant.plan, PAID_PLAN);
  assert.equal(grant.status, "grace", "the evaluator's ENTITLING set includes grace — this is why");
  const horizon = Date.parse(grant.current_period_end);
  assert.ok(horizon >= now + (GRACE_DAYS - 1) * 86400_000,
    "grace must actually grant time — Stripe's period end has already passed by past_due");
});

test("cancel at period end keeps Pro until the paid period actually ends", async () => {
  const store = memoryStore();
  await applyStripeEvent(subEvent("customer.subscription.updated",
    SUB({ cancel_at_period_end: true })), store, { env: ENV });
  const grant = store.entitlements.get(OWNER);
  assert.equal(grant.plan, PAID_PLAN, "they paid for the period; they keep the period");
  const shown = describeBilling(store.rows.get(OWNER));
  assert.equal(shown.cancelAtPeriodEnd, true);
  assert.ok(shown.endsAt, "the account page says when it ends");
  assert.equal(shown.renewsAt, null, "and does not claim it renews");
});

test("completed cancellation and every dead status resolve to free", async () => {
  for (const status of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) {
    const grant = entitlementForSubscription({ status, current_period_end: 1_802_592_000 });
    assert.equal(grant.plan, "free", `${status} must not entitle`);
  }
  const store = memoryStore();
  await applyStripeEvent(subEvent("customer.subscription.created", SUB(), { created: 1000 }), store, { env: ENV });
  await applyStripeEvent(subEvent("customer.subscription.deleted", SUB({ status: "active" }), { created: 2000 }), store, { env: ENV });
  assert.equal(store.entitlements.get(OWNER).plan, "free", "deletion ends access whatever the payload's status says");
  assert.equal(store.rows.get(OWNER).status, "canceled");
});

/* ── Ownership ──────────────────────────────────────────────────────────── */

test("the account is selected by server-written identifiers, never an email", async () => {
  const src = readFileSync(new URL("../lib/billing/service.js", import.meta.url), "utf8")
            + readFileSync(new URL("../lib/billing/stripe.js", import.meta.url), "utf8");
  assert.ok(!/object\.email|customer_email|\.email\b/.test(src),
    "no billing code path reads an email as an identifier");
  // And a subscription with no server-written identity is an orphan, not a guess.
  const store = memoryStore();
  const orphan = SUB({ metadata: {}, customer: "cus_stranger" });
  const result = await applyStripeEvent(subEvent("customer.subscription.created", orphan), store, { env: ENV });
  assert.equal(result.outcome, "orphan");
  assert.equal(store.entitlements.size, 0, "an unattributable event grants nothing to anyone");
});

test("checkout refuses a second live subscription for the same account", async () => {
  const store = memoryStore({ rows: { [OWNER]: {
    owner_id: OWNER, stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", status: "active",
  } } });
  await assert.rejects(
    beginCheckout({ ownerId: OWNER, interval: "month", origin: "http://localhost:3001", store, env: ENV }),
    (error) => error instanceof BillingError && error.code === "already_subscribed" && error.status === 409,
  );
});

test("checkout requires a signed-in account at the HTTP boundary", () => {
  const src = readFileSync(new URL("../lib/server/create-app.js", import.meta.url), "utf8");
  const block = src.slice(src.indexOf('route.startsWith("/api/billing/")'), src.indexOf('route.startsWith("/api/billing/")') + 400);
  assert.match(block, /requireAuth\(req, res, env\)/, "no session, no billing route");
  // The webhook, by contrast, reads RAW bytes — the exact bytes Stripe signed.
  const hook = src.slice(src.indexOf('route === "/api/stripe/webhook"'), src.indexOf('route === "/api/stripe/webhook"') + 500);
  assert.match(hook, /readBytes\(req/, "signature verification runs over raw bytes, not re-serialised JSON");
});

/* ── Entitlement behaviour ──────────────────────────────────────────────── */

test("Free keeps the product and Pro deepens it — spot checks against the matrix", () => {
  assert.equal(capability("free", "chart.saved.limit"), 1);
  assert.equal(capability(PAID_PLAN, "chart.saved.limit"), 10);
  assert.equal(capability("free", "chart.compatibility"), false);
  assert.equal(capability(PAID_PLAN, "chart.compatibility"), true);
  // What can never be sold stays true for everyone, forever.
  for (const plan of ["free", PAID_PLAN]) {
    assert.equal(capability(plan, "export.personal"), true);
    assert.equal(capability(plan, "account.deletion"), true);
  }
});

/* ── Configuration and transport ────────────────────────────────────────── */

test("prices are configuration, and a stranger's price id maps to nothing", () => {
  assert.equal(intervalForPrice("price_month_stub", ENV), "month");
  assert.equal(intervalForPrice("price_year_stub", ENV), "year");
  assert.equal(intervalForPrice("price_attacker", ENV), null);
  assert.equal(billingConfig({}).configured, false);
  assert.deepEqual(billingConfig({}).missing.length, 4);
});

test("the return origin is an allow-list, not an echo of the Host header", () => {
  assert.equal(billingOrigin({ headers: { host: "evil.example" } }, {}), null,
    "an attacker-controlled Host must not become a Stripe return URL");
  assert.equal(billingOrigin({ headers: { host: "localhost:3001" } }, {}), "http://localhost:3001");
  assert.equal(billingOrigin({ headers: { host: "evil.example" } },
    { ORBIT_BILLING_ORIGIN: "https://orbit-axis-omega.vercel.app/" }), "https://orbit-axis-omega.vercel.app");
});

test("form encoding produces Stripe's bracket syntax", () => {
  const encoded = formEncode({ line_items: [{ price: "p", quantity: 1 }], metadata: { orbit_user_id: "u" } }).toString();
  assert.ok(encoded.includes("line_items%5B0%5D%5Bprice%5D=p"));
  assert.ok(encoded.includes("metadata%5Borbit_user_id%5D=u"));
});

test("no Stripe secret can reach the client bundle", () => {
  for (const file of ["app.js", "pricing.html", "index.html", "storage.js"]) {
    const text = readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
    assert.ok(!/sk_(test|live)_|whsec_|STRIPE_SECRET/.test(text), `${file} must carry no secret material`);
  }
});

test("the subscription row records Stripe's vocabulary verbatim", () => {
  const row = subscriptionRow(OWNER, SUB(), 1_800_000_000, ENV);
  assert.equal(row.status, "active");
  assert.equal(row.stripe_customer_id, "cus_1");
  assert.equal(row.stripe_product_id, "prod_1");
  assert.equal(row.last_event_created, new Date(1_800_000_000 * 1000).toISOString());
});

test("a webhook with no store answers 503 so Stripe retries rather than loses the event", async () => {
  const body = JSON.stringify(subEvent("customer.subscription.created", SUB()));
  const signed = signPayloadForTest(body, "whsec_stub_secret");
  const res = await handleStripeWebhook(Buffer.from(body), signed, { env: ENV, admin: null });
  assert.equal(res.status, 503);
});

test("route handler: status reads the read model; unknown routes decline", async () => {
  const auth = { url: "https://stub.supabase.test", anonKey: "anon", accessToken: "tok", ownerId: OWNER };
  const fetchImpl = async () => ({ ok: true, json: async () => [{
    owner_id: OWNER, stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1",
    status: "active", billing_interval: "year",
    current_period_end: "2027-08-19T00:00:00Z", cancel_at_period_end: false,
  }] });
  const res = await handleBillingRoute("GET", "/api/billing/status", {}, auth, { env: ENV, fetchImpl });
  assert.equal(res.status, 200);
  assert.equal(res.body.billing.label, "Orbit Pro");
  assert.equal(res.body.billing.interval, "year");
  assert.ok(res.body.billing.renewsAt);
  assert.equal(await handleBillingRoute("GET", "/api/billing/nothing", {}, auth, { env: ENV }), null);
});
