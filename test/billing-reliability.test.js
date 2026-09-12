import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beginCheckout, cancelBillingForDeletion, applyStripeEvent, subscriptionRow, entitlementForSubscription } from "../lib/billing/service.js";
import { billingStore, handleStripeWebhook } from "../lib/billing/api.js";
import { signPayloadForTest } from "../lib/billing/stripe.js";

const ENV = { STRIPE_SECRET_KEY: "sk_test_synthetic", STRIPE_WEBHOOK_SECRET: "whsec_synthetic",
  STRIPE_PRICE_MONTHLY_ID: "price_month", STRIPE_PRICE_ANNUAL_ID: "price_year" };
const OWNER = "22222222-2222-4222-8222-222222222222";

function checkoutFixture() {
  let attempt = null;
  let deleting = false;
  let lostResponse = false;
  const sessions = new Map();
  const subscriptions = [];
  const calls = [];
  const store = {
    read: async () => ({ stripe_customer_id: "cus_test", status: "none" }),
    reserveCheckout: async (_owner, interval, params, previousId) => {
      if (deleting) return { deleting: true };
      if (!attempt || previousId === attempt.id) {
        attempt = { id: randomUUID(), interval, params: { ...params, expiresAt: Math.floor(Date.now() / 1000) + 3600 } };
      }
      return structuredClone(attempt);
    },
    saveCheckout: async (_owner, id, sessionId) => {
      assert.equal(id, attempt.id);
      if (deleting) return { deleting: true };
      attempt.session_id = sessionId;
      return { deleting: false };
    },
    beginDeletion: async () => { deleting = true; return { attempt: structuredClone(attempt) }; },
  };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const params = new URLSearchParams(init.body);
    const json = (body) => new Response(JSON.stringify(body));
    if (path === "/v1/subscriptions") return json({ data: subscriptions, has_more: false });
    if (path === "/v1/checkout/sessions" && init.method === "GET") return json({ data: [...sessions.values()], has_more: false });
    if (path === "/v1/checkout/sessions") {
      const key = init.headers["idempotency-key"];
      assert.ok(key && !key.endsWith("undefined"));
      let session = sessions.get(key);
      if (!session) {
        session = { id: `cs_${sessions.size}`, url: `https://checkout.example/${sessions.size}`, status: "open",
          metadata: { orbit_checkout_attempt: params.get("metadata[orbit_checkout_attempt]") } };
        sessions.set(key, session);
      }
      if (lostResponse) { lostResponse = false; throw new Error("response lost after Stripe created the session"); }
      return json(session);
    }
    const session = [...sessions.values()].find((s) => path.includes(s.id));
    if (session) {
      if (path.endsWith("/expire")) session.status = "expired";
      return json(session);
    }
    const sub = subscriptions.find((s) => path.endsWith(s.id));
    if (sub && init.method === "DELETE") { sub.status = "canceled"; return json(sub); }
    throw new Error(`Unexpected fake Stripe request ${path}`);
  };
  const checkout = (interval = "month") => beginCheckout({ ownerId: OWNER, interval, origin: "https://example.test", store, env: ENV, fetchImpl });
  return { store, fetchImpl, sessions, subscriptions, calls, checkout, loseResponse: () => { lostResponse = true; } };
}

test("concurrent checkout and later retries reuse a single Stripe session", async () => {
  const f = checkoutFixture();
  const urls = await Promise.all([f.checkout(), f.checkout(), f.checkout()]);
  assert.equal(new Set(urls.map((s) => s.url)).size, 1);
  assert.equal(f.sessions.size, 1);
  assert.equal((await f.checkout()).url, urls[0].url);
  await assert.rejects(f.checkout("year"), /Another plan/);
  assert.equal(f.sessions.size, 1, "switching intervals cannot open a second session");
});

test("a lost checkout response is recovered using the original idempotency key", async () => {
  const f = checkoutFixture();
  f.loseResponse();
  await assert.rejects(f.checkout(), /could not be reached/);
  assert.ok((await f.checkout()).url);
  assert.equal(f.sessions.size, 1);
  const posts = f.calls.filter((c) => c.init.method === "POST");
  assert.equal(posts[0].init.body, posts[1].init.body);
  assert.equal(posts[0].init.headers["idempotency-key"], posts[1].init.headers["idempotency-key"]);
});

test("a completed payment blocks new checkout before its webhook arrives", async () => {
  const f = checkoutFixture();
  await f.checkout();
  [...f.sessions.values()][0].status = "complete";
  await assert.rejects(f.checkout(), (e) => e.code === "already_subscribed");
  assert.equal(f.sessions.size, 1);
});

test("an ended subscription can be bought again without reusing its completed checkout", async () => {
  const f = checkoutFixture();
  await f.checkout();
  Object.assign([...f.sessions.values()][0], { status: "complete", subscription: "sub_ended" });
  f.subscriptions.push({ id: "sub_ended", status: "canceled" });
  assert.ok((await f.checkout()).url);
  assert.equal(f.sessions.size, 2);
});

test("deletion recovers a lost checkout, expires it and cancels all subscriptions", async () => {
  const f = checkoutFixture();
  f.loseResponse();
  await assert.rejects(f.checkout());
  f.subscriptions.push({ id: "sub_one", status: "active" }, { id: "sub_two", status: "past_due" });
  const options = { ownerId: OWNER, store: f.store, env: ENV, fetchImpl: f.fetchImpl };
  await cancelBillingForDeletion(options);
  assert.equal([...f.sessions.values()][0].status, "expired");
  assert.ok(f.subscriptions.every((s) => s.status === "canceled"));
  await cancelBillingForDeletion(options);
  await assert.rejects(f.checkout(), /deletion is in progress/);
});

test("deletion refuses to finish if Stripe cancellation fails", async () => {
  const f = checkoutFixture();
  f.subscriptions.push({ id: "sub_one", status: "active" });
  await assert.rejects(cancelBillingForDeletion({ ownerId: OWNER, store: f.store, env: ENV,
    fetchImpl: (url, init) => init.method === "DELETE" ? Promise.reject(new Error("offline")) : f.fetchImpl(url, init) }));
  assert.equal(f.subscriptions[0].status, "active");
});

test("webhook HTTP retries call the atomic operation again after a failed transaction", async () => {
  let committed = false;
  let calls = 0;
  const store = { applyEvent: async () => {
    calls += 1;
    if (calls === 1) throw new Error("transaction rolled back");
    if (committed) return { outcome: "replay" };
    committed = true; return { outcome: "applied" };
  } };
  const body = Buffer.from(JSON.stringify({ id: "evt_test", type: "customer.subscription.created", created: Math.floor(Date.now() / 1000),
    data: { object: { id: "sub_test", customer: "cus_test", status: "active", metadata: { orbit_user_id: OWNER },
      items: { data: [{ price: { id: "price_month" }, current_period_end: 1900000000 }] } } } }));
  const signature = signPayloadForTest(body, ENV.STRIPE_WEBHOOK_SECRET);
  const deps = { env: ENV, admin: {}, store };
  assert.equal((await handleStripeWebhook(body, signature, deps)).status, 503);
  assert.equal((await handleStripeWebhook(body, signature, deps)).body.outcome, "applied");
  assert.equal((await handleStripeWebhook(body, signature, deps)).body.outcome, "replay");
});

test("new item-level periods persist and missing active periods cannot grant indefinitely", async () => {
  const sub = { status: "active", customer: "cus_test", items: { data: [{ current_period_end: 1900000000 }, { current_period_end: 1800000000 }] } };
  const expected = new Date(1800000000 * 1000).toISOString();
  assert.equal(entitlementForSubscription(sub).currentPeriodEnd, expected);
  assert.equal(subscriptionRow(OWNER, sub, 1700000000, ENV).current_period_end, expected);
  assert.throws(() => entitlementForSubscription({ status: "active" }), /period is missing/);
  let written = false;
  await assert.rejects(applyStripeEvent({ id: "evt_missing", type: "customer.subscription.created", created: 1700000000,
    data: { object: { status: "active", metadata: { orbit_user_id: OWNER } } } }, { applyEvent: async () => { written = true; } }, { env: ENV }));
  assert.equal(written, false);
});

test("a database read outage cannot masquerade as an unsubscribed account", async () => {
  const store = billingStore({ url: "https://example.test", serviceKey: "synthetic" }, { fetchImpl: async () => new Response("", { status: 503 }) });
  await assert.rejects(store.read(OWNER), (e) => e.code === "store_read_failed");
});
