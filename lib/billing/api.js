// Orbit Axis :: billing HTTP boundary (Dev Update 3.10).
//
// Three authenticated routes and one webhook. The routes never touch Stripe
// state directly — they call lib/billing/service.js, which is where every
// business rule lives and is tested. This file owns exactly what an HTTP
// boundary owns: who is asking, what shape the answer takes, and which
// credentials each database access uses.
//
// TWO CREDENTIAL LANES, NEVER MIXED:
//   reads for the signed-in user   -> their own access token; RLS answers
//                                     ownership a second time at the database
//   webhook writes                 -> service-role, under the purpose-named
//                                     "stripe-billing" authorization; no
//                                     client role can ever write billing state

import { supabaseConfig } from "../local-llm/config.js";
import { resolveEnvironment } from "../env/environment.js";
import { serviceRoleVerdict } from "../env/service-role.js";
import { PLAN_LABELS, billingConfig, billingOrigin } from "./config.js";
import { BillingError, verifyWebhookSignature } from "./stripe.js";
import { applyStripeEvent, beginCheckout, beginPortal, describeBilling } from "./service.js";

/* ── The write side ─────────────────────────────────────────────────────── */

/**
 * Service-role credentials for webhook writes, or null with a logged reason.
 *
 * Mirrors lib/account/deletion.js exactly: local and test run against the
 * database on this machine, where the hosted-project authorization is neither
 * required nor meaningful (the startup guard stops them pointing at the hosted
 * project); production additionally requires the purpose-named allowance.
 */
export function billingAdminConfig(env = process.env) {
  const config = supabaseConfig();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!config.url || !serviceKey) return null;

  const environment = resolveEnvironment({ env, loadEnvFiles: false });
  if (environment.isProduction) {
    const allowance = serviceRoleVerdict("stripe-billing", env, {
      environment: environment.environment,
      isVercel: environment.isVercel,
      vercelEnv: environment.vercelEnv,
      isDeployed: environment.isDeployed,
    });
    if (!allowance.authorized) {
      console.error(`[billing] service-role use refused: ${allowance.reason} (no key material is logged)`);
      return null;
    }
  }
  return { url: config.url, serviceKey };
}

/** The store applyStripeEvent() and checkout write through. */
export function billingStore(admin, { fetchImpl = fetch } = {}) {
  const root = admin.url.replace(/\/+$/, "");
  const headers = {
    apikey: admin.serviceKey,
    authorization: `Bearer ${admin.serviceKey}`,
    "content-type": "application/json",
    accept: "application/json",
  };
  const rest = (path) => `${root}/rest/v1/${path}`;

  async function selectOne(path) {
    const res = await fetchImpl(rest(path), { headers });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  async function upsertRow(table, row, conflict) {
    const res = await fetchImpl(rest(`${table}?on_conflict=${conflict}`), {
      method: "POST",
      headers: { ...headers, prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new BillingError("Billing state could not be recorded.", { code: "store_write_failed" });
  }

  return {
    read: (ownerId) =>
      selectOne(`billing_subscriptions?owner_id=eq.${encodeURIComponent(ownerId)}&select=*&limit=1`),
    ownerForCustomer: async (customerId) => {
      const row = await selectOne(
        `billing_subscriptions?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=owner_id&limit=1`);
      return row?.owner_id || null;
    },
    linkCustomer: (ownerId, customerId, eventCreatedSeconds) =>
      upsertRow("billing_subscriptions", {
        owner_id: ownerId,
        stripe_customer_id: customerId,
        last_event_created: new Date(eventCreatedSeconds * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }, "owner_id"),
    upsert: (row) => upsertRow("billing_subscriptions", row, "owner_id"),
    entitle: (ownerId, fields) =>
      upsertRow("account_entitlements", { owner_id: ownerId, ...fields }, "owner_id"),
    /**
     * Insert-first idempotency. A duplicate key answers 409, which is the
     * signal "already processed" — an acknowledgement, not an error.
     */
    recordEvent: async (id, type) => {
      const res = await fetchImpl(rest("stripe_events"), {
        method: "POST",
        headers: { ...headers, prefer: "return=minimal" },
        body: JSON.stringify({ id, event_type: type }),
      });
      if (res.status === 409) return "replay";
      if (!res.ok) throw new BillingError("Event ledger write failed.", { code: "ledger_write_failed" });
      return "new";
    },
  };
}

/* ── The signed-in read side ────────────────────────────────────────────── */

async function readOwnBillingRow(auth, { fetchImpl = fetch } = {}) {
  const root = String(auth.url).replace(/\/+$/, "");
  const res = await fetchImpl(
    `${root}/rest/v1/billing_subscriptions?owner_id=eq.${encodeURIComponent(auth.ownerId)}&select=*&limit=1`,
    { headers: { apikey: auth.anonKey, authorization: `Bearer ${auth.accessToken}`, accept: "application/json" } },
  );
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/* ── Routes ─────────────────────────────────────────────────────────────── */

/**
 * @param {string} method
 * @param {string} route
 * @param {object} body      parsed JSON body (routes; the webhook never comes here)
 * @param {object} auth      authContext() — REQUIRED, enforced by the caller
 * @param {object} deps      { req, env, fetchImpl, admin } — injectable for tests
 * @returns {Promise<{status:number, body:object}|null>} null = not a billing route
 */
export async function handleBillingRoute(method, route, body, auth, deps = {}) {
  const env = deps.env || process.env;
  const fetchImpl = deps.fetchImpl || fetch;
  const origin = billingOrigin(deps.req, env);

  const fail = (error) => ({
    status: error instanceof BillingError ? error.status : 502,
    body: { ok: false, error: error instanceof BillingError ? error.message : "Billing request failed." },
  });

  if (route === "/api/billing/status" && method === "GET") {
    const row = await readOwnBillingRow(auth, { fetchImpl });
    return { status: 200, body: { ok: true, billing: describeBilling(row, { labels: PLAN_LABELS }),
      available: billingConfig(env).configured } };
  }

  if (route === "/api/billing/checkout" && method === "POST") {
    const admin = deps.admin ?? billingAdminConfig(env);
    if (!admin) return { status: 503, body: { ok: false, error: "Billing is not available on this instance." } };
    const interval = body?.interval === "year" ? "year" : body?.interval === "month" ? "month" : null;
    if (!interval) return { status: 400, body: { ok: false, error: "Choose monthly or annual." } };
    try {
      const { url } = await beginCheckout({
        ownerId: auth.ownerId, interval, origin,
        store: deps.store || billingStore(admin, { fetchImpl }), env, fetchImpl,
      });
      return { status: 200, body: { ok: true, url } };
    } catch (error) { return fail(error); }
  }

  if (route === "/api/billing/portal" && method === "POST") {
    const admin = deps.admin ?? billingAdminConfig(env);
    if (!admin) return { status: 503, body: { ok: false, error: "Billing is not available on this instance." } };
    try {
      const { url } = await beginPortal({
        ownerId: auth.ownerId, origin,
        store: deps.store || billingStore(admin, { fetchImpl }), env, fetchImpl,
      });
      return { status: 200, body: { ok: true, url } };
    } catch (error) { return fail(error); }
  }

  return null;
}

/**
 * The webhook. UNAUTHENTICATED BY DESIGN — Stripe is not a signed-in user —
 * and therefore trusts nothing but the signature over the raw bytes.
 *
 * Response codes are chosen for Stripe's retry behaviour:
 *   400  signature failed — retrying an unsigned delivery cannot help
 *   503  our store is unavailable — Stripe SHOULD retry; the event is not lost
 *   200  processed, replayed, stale, or ignored — all acknowledged, because
 *        each of those is this endpoint working as designed
 */
export async function handleStripeWebhook(rawBody, signatureHeader, deps = {}) {
  const env = deps.env || process.env;
  const cfg = billingConfig(env);
  if (!cfg.webhookSecret) return { status: 503, body: { ok: false, error: "Webhook is not configured." } };

  const verdict = verifyWebhookSignature(rawBody, signatureHeader, cfg.webhookSecret,
    deps.nowSeconds ? { nowSeconds: deps.nowSeconds } : {});
  if (!verdict.ok) {
    // The reason goes to the log, never the response: an attacker probing the
    // endpoint learns "no", not which part of the forgery failed.
    console.error(`[billing] webhook signature refused: ${verdict.reason}`);
    return { status: 400, body: { ok: false, error: "Signature verification failed." } };
  }

  let event;
  try { event = JSON.parse(rawBody.toString("utf8")); }
  catch { return { status: 400, body: { ok: false, error: "Malformed event." } }; }
  if (!event?.id || !event?.type) return { status: 400, body: { ok: false, error: "Malformed event." } };

  const admin = deps.admin ?? billingAdminConfig(env);
  if (!admin) return { status: 503, body: { ok: false, error: "Billing store unavailable." } };

  try {
    const result = await applyStripeEvent(event, deps.store || billingStore(admin, { fetchImpl: deps.fetchImpl || fetch }), { env });
    console.log(`[billing] ${event.type}: ${result.outcome}`);
    return { status: 200, body: { ok: true, received: true, outcome: result.outcome } };
  } catch (error) {
    console.error(`[billing] event ${event.id} failed: ${error?.code || error?.message}`);
    return { status: 503, body: { ok: false, error: "Event could not be applied." } };
  }
}
