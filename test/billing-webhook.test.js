// Orbit Axis :: the billing webhook's two halves.
//
// Everything here runs on plain objects and node:crypto — no Stripe account, no
// network, no database. That is deliberate: the failure modes worth testing are
// forgery and reordering, and both are reproducible offline.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  verifyStripeSignature, parseSignatureHeader, signPayload, DEFAULT_TOLERANCE_SECONDS,
} from "../lib/billing/signature.js";
import { entitlementFromEvent, shouldApply, pricePlanMap, HANDLED_TYPES } from "../lib/billing/events.js";

const SECRET = "whsec_test_2f7a1c9e4b6d8a03";
const NOW = 1_787_000_000;
const OWNER = "3f1b9c22-7d84-4a51-9e30-2c6b8a4d1f77";

const ENV = {
  ORBIT_STRIPE_PRICE_CONSUMER_MONTHLY: "price_consumer_m",
  ORBIT_STRIPE_PRICE_CONSUMER_ANNUAL: "price_consumer_y",
  ORBIT_STRIPE_PRICE_RESEARCHER_MONTHLY: "price_researcher_m",
};

const body = (o) => JSON.stringify(o);

/* ── Signature ──────────────────────────────────────────────────────────── */

test("a genuine Stripe signature verifies", () => {
  const raw = body({ id: "evt_1", type: "customer.subscription.updated" });
  const header = signPayload(raw, SECRET, NOW);
  assert.deepEqual(verifyStripeSignature(raw, header, SECRET, { nowSeconds: NOW }),
    { ok: true, reason: null, timestamp: NOW });
});

test("a body altered after signing is rejected", () => {
  // The whole point of the scheme: the attacker keeps a real signature and
  // swaps the plan underneath it.
  const raw = body({ id: "evt_1", plan: "consumer" });
  const header = signPayload(raw, SECRET, NOW);
  const tampered = body({ id: "evt_1", plan: "researcher" });
  assert.equal(verifyStripeSignature(tampered, header, SECRET, { nowSeconds: NOW }).reason, "signature_mismatch");
});

test("re-serialised JSON fails, which is why the route must use raw bytes", () => {
  // Semantically identical, textually different. If the route ever parses the
  // body and re-stringifies it before verifying, every genuine webhook fails.
  const raw = '{"id":"evt_1","type":"customer.subscription.updated"}';
  const header = signPayload(raw, SECRET, NOW);
  const reserialised = JSON.stringify(JSON.parse(raw).id === "evt_1"
    ? { type: "customer.subscription.updated", id: "evt_1" } : {});
  assert.notEqual(reserialised, raw, "the fixture must actually differ");
  assert.equal(verifyStripeSignature(reserialised, header, SECRET, { nowSeconds: NOW }).ok, false);
});

test("a signature made with the wrong secret is rejected", () => {
  const raw = body({ id: "evt_1" });
  assert.equal(
    verifyStripeSignature(raw, signPayload(raw, "whsec_someone_elses", NOW), SECRET, { nowSeconds: NOW }).reason,
    "signature_mismatch",
  );
});

test("a captured webhook cannot be replayed later", () => {
  // Without the timestamp check, a valid "subscription active" event stays
  // valid forever and can be resent after the customer stops paying.
  const raw = body({ id: "evt_1" });
  const header = signPayload(raw, SECRET, NOW);
  const later = NOW + DEFAULT_TOLERANCE_SECONDS + 1;
  assert.equal(verifyStripeSignature(raw, header, SECRET, { nowSeconds: later }).reason,
    "timestamp_outside_tolerance");
  // Just inside the window still works.
  assert.equal(verifyStripeSignature(raw, header, SECRET,
    { nowSeconds: NOW + DEFAULT_TOLERANCE_SECONDS }).ok, true);
});

test("a future timestamp is refused too, not just an old one", () => {
  const raw = body({ id: "evt_1" });
  const header = signPayload(raw, SECRET, NOW + 10_000);
  assert.equal(verifyStripeSignature(raw, header, SECRET, { nowSeconds: NOW }).reason,
    "timestamp_outside_tolerance");
});

test("several v1 signatures are accepted, so secret rotation works", () => {
  const raw = body({ id: "evt_1" });
  const good = createHmac("sha256", SECRET).update(`${NOW}.${raw}`).digest("hex");
  const stale = "a".repeat(64);
  // Old secret first: an implementation that only reads the first v1 fails here.
  const header = `t=${NOW},v1=${stale},v1=${good}`;
  assert.equal(verifyStripeSignature(raw, header, SECRET, { nowSeconds: NOW }).ok, true);
});

test("malformed headers are refused by name, never by throwing", () => {
  const raw = body({ id: "evt_1" });
  const cases = [
    [undefined, "no_timestamp"], ["", "no_timestamp"], ["garbage", "no_timestamp"],
    [`v1=${"a".repeat(64)}`, "no_timestamp"], [`t=${NOW}`, "no_signature"],
    [`t=abc,v1=${"a".repeat(64)}`, "no_timestamp"],
    [`t=${NOW},v1=nothex!!`, "no_signature"],
  ];
  for (const [header, reason] of cases) {
    assert.equal(verifyStripeSignature(raw, header, SECRET, { nowSeconds: NOW }).reason, reason, `header: ${header}`);
  }
  assert.equal(verifyStripeSignature(raw, `t=${NOW},v1=abcd`, SECRET, { nowSeconds: NOW }).reason, "signature_mismatch");
});

test("a missing signing secret refuses rather than verifying nothing", () => {
  const raw = body({ id: "evt_1" });
  const header = signPayload(raw, SECRET, NOW);
  for (const secret of [undefined, "", null]) {
    assert.equal(verifyStripeSignature(raw, header, secret, { nowSeconds: NOW }).reason, "no_signing_secret");
  }
});

test("unknown signature schemes are ignored, not fatal", () => {
  // Stripe adds schemes over time; a v2 appearing must not break v1 handling.
  const raw = body({ id: "evt_1" });
  const good = createHmac("sha256", SECRET).update(`${NOW}.${raw}`).digest("hex");
  const parsed = parseSignatureHeader(`t=${NOW},v0=deadbeef,v1=${good},v2=cafe`);
  assert.deepEqual(parsed.signatures, [good]);
  assert.equal(verifyStripeSignature(raw, `t=${NOW},v0=deadbeef,v1=${good}`, SECRET, { nowSeconds: NOW }).ok, true);
});

test("verification works on a Buffer, which is what the route actually has", () => {
  const raw = body({ id: "evt_1", note: "ünïcode ✦" });
  const header = signPayload(raw, SECRET, NOW);
  assert.equal(verifyStripeSignature(Buffer.from(raw, "utf8"), header, SECRET, { nowSeconds: NOW }).ok, true);
});

/* ── Event → entitlement ────────────────────────────────────────────────── */

const subscription = (over = {}) => ({
  id: "evt_x", type: "customer.subscription.updated", created: NOW,
  data: { object: {
    status: "active",
    metadata: { orbit_owner_id: OWNER },
    current_period_end: NOW + 2_592_000,
    items: { data: [{ price: { id: "price_consumer_m" } }] },
    ...over,
  } },
});

test("an active subscription maps to the plan its price sells", () => {
  const out = entitlementFromEvent(subscription(), ENV);
  assert.equal(out.ownerId, OWNER);
  assert.equal(out.plan, "consumer");
  assert.equal(out.status, "active");
  assert.equal(out.source, "stripe");
  assert.equal(out.occurredAt, NOW);
  assert.match(out.currentPeriodEnd, /^\d{4}-\d{2}-\d{2}T/);
});

test("the plan is never read from the event, only from configured prices", () => {
  // Someone who could set metadata must not be able to name their own tier.
  const forged = subscription({ metadata: { orbit_owner_id: OWNER, plan: "researcher" } });
  assert.equal(entitlementFromEvent(forged, ENV).plan, "consumer");
  // And a price this deployment does not sell yields nothing at all.
  const unknown = subscription({ items: { data: [{ price: { id: "price_not_ours" } }] } });
  assert.equal(entitlementFromEvent(unknown, ENV), null);
});

test("a failed card becomes grace, not expired", () => {
  // account_entitlements defines 'grace' precisely so one failed charge does
  // not lock somebody out while Stripe is still retrying.
  for (const status of ["past_due", "unpaid", "paused"]) {
    assert.equal(entitlementFromEvent(subscription({ status }), ENV).status, "grace");
  }
  assert.equal(entitlementFromEvent(subscription({ status: "trialing" }), ENV).status, "active");
  assert.equal(entitlementFromEvent(subscription({ status: "canceled" }), ENV).status, "cancelled");
  // A subscription whose first payment never completed bought nothing.
  assert.equal(entitlementFromEvent(subscription({ status: "incomplete" }), ENV).status, "expired");
});

test("deletion drops to free and expired without consulting prices", () => {
  const out = entitlementFromEvent({
    id: "evt_d", type: "customer.subscription.deleted", created: NOW,
    data: { object: { metadata: { orbit_owner_id: OWNER } } },
  }, ENV);
  assert.deepEqual(
    { plan: out.plan, status: out.status, end: out.currentPeriodEnd },
    { plan: "free", status: "expired", end: null },
  );
});

test("an unpaid checkout session entitles nothing", () => {
  const session = (payment_status) => ({
    id: "evt_c", type: "checkout.session.completed", created: NOW,
    data: { object: {
      payment_status, client_reference_id: OWNER,
      items: { data: [{ price: { id: "price_consumer_m" } }] },
    } },
  });
  assert.equal(entitlementFromEvent(session("unpaid"), ENV), null);
  assert.equal(entitlementFromEvent(session("no_payment_required"), ENV), null);
  assert.equal(entitlementFromEvent(session("paid"), ENV).plan, "consumer");
});

test("events with no account, no date, or no interest are ignored", () => {
  assert.equal(entitlementFromEvent({ type: "invoice.paid", created: NOW, data: { object: {} } }, ENV), null);
  assert.equal(entitlementFromEvent(subscription({ metadata: {} }), ENV), null);
  // A malformed owner id must never reach a database query.
  assert.equal(entitlementFromEvent(subscription({ metadata: { orbit_owner_id: "'; drop table" } }), ENV), null);
  assert.equal(entitlementFromEvent({ ...subscription(), created: undefined }, ENV), null);
  assert.equal(entitlementFromEvent(null, ENV), null);
});

test("a mixed cart resolves to the strongest plan, whatever the item order", () => {
  const items = [{ price: { id: "price_consumer_m" } }, { price: { id: "price_researcher_m" } }];
  assert.equal(entitlementFromEvent(subscription({ items: { data: items } }), ENV).plan, "researcher");
  assert.equal(entitlementFromEvent(subscription({ items: { data: [...items].reverse() } }), ENV).plan, "researcher");
});

test("an unconfigured environment maps no prices rather than guessing", () => {
  assert.equal(pricePlanMap({}).size, 0);
  assert.equal(entitlementFromEvent(subscription(), {}), null);
});

/* ── Ordering ───────────────────────────────────────────────────────────── */

test("a stale event cannot undo a newer one", () => {
  // The failure this guards: a 09:00 cancellation retried after the 09:05
  // renewal, silently downgrading somebody who is paying.
  const newer = { occurredAt: NOW + 300 };
  assert.equal(shouldApply({ occurredAt: NOW }, { last_event_at: newer.occurredAt }), false);
  assert.equal(shouldApply(newer, { last_event_at: NOW }), true);
});

test("ties apply, and a row with no recorded event always applies", () => {
  // Stripe can emit two events in the same second; refusing ties drops one.
  assert.equal(shouldApply({ occurredAt: NOW }, { last_event_at: NOW }), true);
  assert.equal(shouldApply({ occurredAt: NOW }, null), true);
  assert.equal(shouldApply({ occurredAt: NOW }, { last_event_at: null }), true);
  assert.equal(shouldApply(null, null), false);
});

test("the handled set is exactly the four events that change entitlement", () => {
  assert.deepEqual([...HANDLED_TYPES].sort(), [
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.deleted",
    "customer.subscription.updated",
  ]);
});

/* ── The handler: status codes are a contract with Stripe's retry logic ──── */

import { handleStripeWebhook } from "../lib/billing/api.js";

const PROD_ENV = (over = {}) => ({
  ...ENV,
  ORBIT_STRIPE_WEBHOOK_SECRET: SECRET,
  ORBIT_ENVIRONMENT: "production",
  ORBIT_PRODUCTION_SERVICE_ROLE_PURPOSE: "billing-webhook",
  ORBIT_PRODUCTION_SERVICE_ROLE_PROJECT_REF: "mtdrazdastcgiweauwoj",
  SUPABASE_URL: "https://mtdrazdastcgiweauwoj.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-value-never-logged",
  ...over,
});

/** A fake Supabase that records what it was asked to write. */
function fakeSupabase({ row = null, readOk = true, writeOk = true } = {}) {
  const writes = [];
  const impl = async (url, init = {}) => {
    if ((init.method || "GET") === "GET") {
      return readOk
        ? { ok: true, json: async () => (row ? [row] : []) }
        : { ok: false, status: 503, json: async () => ({}) };
    }
    writes.push(JSON.parse(init.body));
    return { ok: writeOk, status: writeOk ? 201 : 500 };
  };
  return { impl, writes };
}

const delivery = (event, env, extra = {}) => {
  const raw = Buffer.from(JSON.stringify(event), "utf8");
  return {
    rawBody: raw,
    signatureHeader: signPayload(raw, SECRET, NOW),
    env, nowSeconds: NOW, ...extra,
  };
};

test("a genuine subscription event writes the entitlement", async () => {
  const db = fakeSupabase();
  const out = await handleStripeWebhook(delivery(subscription(), PROD_ENV(), { fetchImpl: db.impl }));
  assert.equal(out.status, 200);
  assert.equal(out.body.applied, true);
  assert.equal(db.writes.length, 1);
  assert.deepEqual(
    { owner: db.writes[0].owner_id, plan: db.writes[0].plan, source: db.writes[0].source,
      status: db.writes[0].status, at: db.writes[0].last_event_at },
    { owner: OWNER, plan: "consumer", source: "stripe", status: "active", at: NOW },
  );
});

test("a forged request is 400 and writes nothing", async () => {
  const db = fakeSupabase();
  const raw = Buffer.from(JSON.stringify(subscription()), "utf8");
  const out = await handleStripeWebhook({
    rawBody: raw,
    signatureHeader: signPayload(raw, "whsec_attacker", NOW),
    env: PROD_ENV(), nowSeconds: NOW, fetchImpl: db.impl,
  });
  // 400, not 500: Stripe must NOT retry something that was never from Stripe.
  assert.equal(out.status, 400);
  assert.match(out.body.error, /^signature_/);
  assert.equal(db.writes.length, 0);
});

test("an event Orbit ignores is 200, so Stripe stops sending it", async () => {
  const db = fakeSupabase();
  const out = await handleStripeWebhook(delivery(
    { id: "evt_i", type: "invoice.paid", created: NOW, data: { object: {} } },
    PROD_ENV(), { fetchImpl: db.impl },
  ));
  assert.equal(out.status, 200);
  assert.equal(out.body.applied, false);
  assert.equal(db.writes.length, 0);
});

test("a stale event is accepted but not applied", async () => {
  // The reordering case: a cancellation retried after a renewal.
  const db = fakeSupabase({ row: { plan: "consumer", status: "active", last_event_at: NOW + 500 } });
  const stale = { ...subscription(), type: "customer.subscription.deleted", created: NOW };
  const out = await handleStripeWebhook(delivery(stale, PROD_ENV(), { fetchImpl: db.impl }));
  assert.equal(out.status, 200);
  assert.equal(out.body.reason, "stale_event");
  assert.equal(db.writes.length, 0, "a paying customer must not be downgraded by a retry");
});

test("a database failure is 500 so Stripe retries a real purchase", async () => {
  for (const broken of [{ readOk: false }, { writeOk: false }]) {
    const db = fakeSupabase(broken);
    const out = await handleStripeWebhook(delivery(subscription(), PROD_ENV(), { fetchImpl: db.impl }));
    assert.equal(out.status, 500, "a 200 here would silently drop a purchase");
  }
});

test("an unauthorized service role is 500, never a silent success", async () => {
  const db = fakeSupabase();
  const out = await handleStripeWebhook(delivery(subscription(),
    PROD_ENV({ ORBIT_PRODUCTION_SERVICE_ROLE_PURPOSE: "account-deletion" }), { fetchImpl: db.impl }));
  assert.equal(out.status, 500);
  assert.equal(out.body.error, "service_role_not_authorized");
  assert.equal(db.writes.length, 0);
});

test("no response ever contains the service-role key or signing secret", async () => {
  const db = fakeSupabase({ readOk: false });
  const cases = [
    delivery(subscription(), PROD_ENV(), { fetchImpl: db.impl }),
    { rawBody: Buffer.from("{}"), signatureHeader: "garbage", env: PROD_ENV(), nowSeconds: NOW },
    { rawBody: Buffer.from("not json"), signatureHeader: signPayload("not json", SECRET, NOW),
      env: PROD_ENV(), nowSeconds: NOW, fetchImpl: db.impl },
  ];
  for (const input of cases) {
    const text = JSON.stringify(await handleStripeWebhook(input));
    assert.ok(!text.includes("service-role-value-never-logged"), "leaked the service-role key");
    assert.ok(!text.includes(SECRET), "leaked the signing secret");
  }
});

test("a body that is not JSON is 400 rather than throwing", async () => {
  const raw = Buffer.from("<html>not stripe</html>", "utf8");
  const out = await handleStripeWebhook({
    rawBody: raw, signatureHeader: signPayload(raw, SECRET, NOW),
    env: PROD_ENV(), nowSeconds: NOW, fetchImpl: fakeSupabase().impl,
  });
  assert.equal(out.status, 400);
  assert.equal(out.body.error, "malformed_json");
});

test("the route reads raw bytes and never authenticates a session", () => {
  const app = readFileSync(new URL("../lib/server/create-app.js", import.meta.url), "utf8");
  const start = app.indexOf('route === "/api/billing/webhook"');
  assert.ok(start > -1, "the webhook route should be mounted");
  const block = app.slice(start, start + 1400);
  assert.match(block, /readBytes\(req/, "must use readBytes — parsing JSON first breaks the signature");
  assert.ok(!/readBody\(req/.test(block), "readBody would re-serialise and invalidate every signature");
  assert.ok(!/authenticateRequest/.test(block), "there is no session on a webhook; the signature is the auth");
});
