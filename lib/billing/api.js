// Orbit Axis :: the billing webhook route handler.
//
// Three decisions, kept apart so each can be tested alone:
//
//   signature.js  — is this really from Stripe?
//   events.js     — what does it mean?
//   this file     — may we write it, and what do we tell Stripe?
//
// WHAT THIS FILE REFUSES TO DO
//
// It never trusts the event for anything but facts about Stripe's own objects.
// The plan comes from configured price ids, the owner from a UUID-shaped
// reference, and the write goes through the same purpose-gated service-role
// authorization that account deletion uses. A forged event that somehow passed
// verification still cannot name its own tier.

import { verifyStripeSignature } from "./signature.js";
import { entitlementFromEvent, shouldApply } from "./events.js";
import { CURRENT_MATRIX_VERSION } from "../entitlements/plans.js";
import { serviceRoleVerdict } from "../env/service-role.js";

/** The purpose this route holds the service-role key under. */
export const BILLING_PURPOSE = "billing-webhook";

const ok = (body) => ({ status: 200, body: { ok: true, ...body } });
const bad = (error) => ({ status: 400, body: { ok: false, error } });
const failed = (error) => ({ status: 500, body: { ok: false, error } });

/**
 * Read and write one entitlement row with the service-role key.
 *
 * Written here rather than reused from lib/fortune/store.js because that module
 * authenticates AS A USER — the whole point of this path is that there is no
 * user. Sharing it would mean giving a user-scoped helper a key that bypasses
 * row-level security.
 */
function serviceStore(env, fetchImpl = fetch) {
  const root = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  return {
    async read(ownerId) {
      const res = await fetchImpl(
        `${root}/rest/v1/account_entitlements?owner_id=eq.${ownerId}&select=plan,status,last_event_at&limit=1`,
        { headers },
      );
      if (!res.ok) return { ok: false, status: res.status };
      const rows = await res.json();
      return { ok: true, row: Array.isArray(rows) && rows.length ? rows[0] : null };
    },
    async write(row) {
      const res = await fetchImpl(`${root}/rest/v1/account_entitlements`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(row),
      });
      return { ok: res.ok, status: res.status };
    },
  };
}

/**
 * Handle one webhook delivery.
 *
 * @param {{ rawBody: Buffer, signatureHeader: string, env?: object,
 *           fetchImpl?: Function, nowSeconds?: number }} input
 */
export async function handleStripeWebhook(input) {
  const env = input.env || process.env;
  const secret = env.ORBIT_STRIPE_WEBHOOK_SECRET;

  const verdict = verifyStripeSignature(input.rawBody, input.signatureHeader, secret,
    { nowSeconds: input.nowSeconds });
  if (!verdict.ok) {
    // 400, never 500. Stripe does not retry a 400, and it should not: a request
    // that was not signed correctly will not be signed correctly later either.
    // The reason is returned because it is about OUR configuration or an
    // attacker's request, and contains no key material.
    return bad(`signature_${verdict.reason}`);
  }

  let event;
  try {
    event = JSON.parse(Buffer.isBuffer(input.rawBody) ? input.rawBody.toString("utf8") : String(input.rawBody));
  } catch {
    return bad("malformed_json");
  }

  const change = entitlementFromEvent(event, env);
  // Nothing to do is a SUCCESS. Orbit ignores most of Stripe's event stream by
  // design, and answering anything but 200 would make Stripe retry an event it
  // will be ignored again.
  if (!change) return ok({ applied: false, reason: "not_actionable" });

  // The same gate account deletion passes through. Checked AFTER the signature
  // so an unauthorized deployment does not become an oracle for whether a
  // signature was valid.
  const authorization = serviceRoleVerdict(BILLING_PURPOSE, env, {
    environment: env.ORBIT_ENVIRONMENT,
    isVercel: Boolean(env.VERCEL),
    vercelEnv: env.VERCEL_ENV,
  });
  if (!authorization.authorized) {
    // 500 so Stripe retries: the event was genuine and Orbit could not record
    // it. A 200 here would drop a real purchase on the floor silently.
    return failed("service_role_not_authorized");
  }

  const store = serviceStore(env, input.fetchImpl || fetch);

  const existing = await store.read(change.ownerId);
  if (!existing.ok) return failed("entitlement_read_failed");

  // The reordering guard. A retried older event must not undo a newer one.
  if (!shouldApply(change, existing.row)) {
    return ok({ applied: false, reason: "stale_event" });
  }

  const written = await store.write({
    owner_id: change.ownerId,
    plan: change.plan,
    status: change.status,
    source: change.source,
    matrix_version: CURRENT_MATRIX_VERSION,
    current_period_end: change.currentPeriodEnd,
    last_event_at: change.occurredAt,
  });
  if (!written.ok) return failed("entitlement_write_failed");

  return ok({ applied: true, plan: change.plan, status: change.status });
}
