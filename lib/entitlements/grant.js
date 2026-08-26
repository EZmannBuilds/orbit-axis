// Orbit Axis :: the entitlement writer (Dev Update 3.10).
//
// THE ONE PLACE THAT CHANGES WHAT SOMEBODY MAY DO.
//
// service.js is the only place that answers "is this person allowed?". This is
// the only place that changes the answer. Keeping them apart is the point: a
// module that both decides and grants is a module where a bug in the decision
// can write itself true.
//
// EVERYTHING HERE RUNS AS THE SERVICE ROLE, AND ONLY IN PRODUCTION
//
// account_entitlements grants no INSERT or UPDATE policy to anyone, deliberately
// (see 20260807230000_account_entitlements.sql). So the only way to write it is
// to bypass row-level security, and the only way to do that legitimately is
// lib/env/service-role.js, which requires "billing-webhook" to have been
// authorized by name, in production, against the pinned project.
//
// That means this module cannot grant anything locally, and that is correct
// rather than inconvenient: a local process holding a key that can promote any
// account is the thing the guard exists to prevent. Everything worth testing
// here is a pure function, and those are exported separately so the tests never
// need a key at all.
//
// THE ASYMMETRY IS THE SAME ONE AS EVERYWHERE ELSE
//
// A refusal to grant costs a support message. A wrong grant costs revenue and
// breaks a promise to the people who did pay. So every ambiguous input refuses,
// nothing is coerced, and an unrecognised value is never rounded to the nearest
// valid one.

import { CURRENT_MATRIX_VERSION, PLANS, isPlan } from "./plans.js";
import { serviceRoleVerdict } from "../env/service-role.js";

/** The purpose this module is authorized under. Must exist in SERVICE_ROLE_PURPOSES. */
export const GRANT_PURPOSE = "billing-webhook";

/**
 * Statuses the table accepts. Mirrored from the CHECK constraint rather than
 * imported, because the database and the application are meant to agree
 * independently — a single shared constant would let one drift silently.
 */
export const STATUSES = Object.freeze(["active", "grace", "expired", "cancelled"]);

/** Who says so. Same reasoning as STATUSES. */
export const SOURCES = Object.freeze(["manual", "stripe", "app_store", "play"]);

/** A UUID, loosely — enough to reject a customer id or an email posing as one. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Is this a complete, self-consistent instruction to change someone's plan?
 *
 * PURE. No network, no key, no environment. This is where the rules live and
 * where the tests point, so that the untestable part below stays as thin as it
 * can be.
 *
 * Returns a reason rather than a boolean so a refusal can say which field was
 * wrong — a webhook that silently drops a valid purchase is indistinguishable
 * from one that never arrived.
 *
 * @param {object} intent
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function validateIntent(intent) {
  const bad = (reason) => ({ ok: false, reason });

  if (!intent || typeof intent !== "object") return bad("intent is not an object");

  if (typeof intent.ownerId !== "string" || !UUID.test(intent.ownerId)) {
    // Deliberately does not echo the value: this runs on data from an external
    // provider, and a rejected identifier is exactly the kind of thing that
    // should not be copied into a log line.
    return bad("ownerId is not a uuid");
  }
  if (!isPlan(intent.plan)) {
    return bad(`plan must be one of ${PLANS.join(", ")}`);
  }
  if (!STATUSES.includes(intent.status)) {
    return bad(`status must be one of ${STATUSES.join(", ")}`);
  }
  if (!SOURCES.includes(intent.source)) {
    return bad(`source must be one of ${SOURCES.join(", ")}`);
  }

  // A period end is optional — a manual grant may have none — but if one is
  // present it has to be a real instant. An unparseable date written to a
  // timestamptz column is how "expires never" gets stored by accident.
  if (intent.currentPeriodEnd != null) {
    const ms = Date.parse(intent.currentPeriodEnd);
    if (!Number.isFinite(ms)) return bad("currentPeriodEnd is not a date");
  }

  return { ok: true, reason: null };
}

/**
 * The row this intent becomes.
 *
 * PURE, and separate from the write so that what gets stored can be asserted
 * without a database.
 *
 * `matrix_version` is stamped from the matrix in force RIGHT NOW, which is the
 * entire reason that column exists: somebody who buys today buys today's
 * capabilities, and a later matrix that moves a feature between plans must not
 * quietly take it from them. See plans.js.
 *
 * @param {object} intent  already passed validateIntent()
 */
export function rowFor(intent) {
  return {
    owner_id: intent.ownerId,
    plan: intent.plan,
    status: intent.status,
    source: intent.source,
    matrix_version: CURRENT_MATRIX_VERSION,
    current_period_end: intent.currentPeriodEnd
      ? new Date(intent.currentPeriodEnd).toISOString()
      : null,
  };
}

/**
 * May this process write entitlements at all?
 *
 * Wraps serviceRoleVerdict so callers ask one question and get one answer, and
 * so the purpose string is written in exactly one place.
 *
 * @param {object} env
 * @param {object} context  { environment, isVercel, vercelEnv, isDeployed }
 */
export function grantAllowance(env = process.env, context = {}) {
  return serviceRoleVerdict(GRANT_PURPOSE, env, context);
}

/**
 * Write the entitlement.
 *
 * Upserts on owner_id, which is the primary key: a person has one plan, and a
 * renewal replaces the row rather than accumulating history. History lives in
 * billing_events, where it belongs.
 *
 * Never throws for an expected failure — returns { ok, reason } so the webhook
 * can decide what status code the provider should see, which governs whether it
 * retries. Throwing here would turn a refusal into a 500 and an infinite retry.
 *
 * @param {object} intent
 * @param {{ env?: object, context?: object, fetchImpl?: Function }} deps
 */
export async function grantEntitlement(intent, deps = {}) {
  const env = deps.env || process.env;
  const context = deps.context || {};
  const doFetch = deps.fetchImpl || fetch;

  const valid = validateIntent(intent);
  if (!valid.ok) return { ok: false, reason: `invalid intent: ${valid.reason}`, retryable: false };

  const allowance = grantAllowance(env, context);
  if (!allowance.authorized) {
    // Not retryable: a misconfigured deployment will refuse identically on
    // every redelivery, and telling the provider to keep trying would turn a
    // configuration mistake into an unbounded retry storm.
    return { ok: false, reason: `service-role refused: ${allowance.reason}`, retryable: false };
  }

  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  // grantAllowance already established both are present; this is the belt to
  // its braces, and it is cheap.
  if (!url || !key) return { ok: false, reason: "supabase not configured", retryable: false };

  let res;
  try {
    res = await doFetch(`${url}/rest/v1/account_entitlements`, {
      method: "POST",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        // Upsert. Without merge-duplicates a renewal is a primary-key conflict
        // and every subsequent payment fails for an existing subscriber.
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([rowFor(intent)]),
    });
  } catch {
    // The network, not the request. This one IS worth retrying.
    return { ok: false, reason: "supabase unreachable", retryable: true };
  }

  if (!res.ok) {
    // 5xx is Supabase having a bad moment and is worth another delivery. 4xx is
    // this request being wrong, and will be just as wrong next time.
    const retryable = res.status >= 500;
    // The status, never the body: a PostgREST error can echo the row, and the
    // row contains an account identifier.
    return { ok: false, reason: `supabase rejected the write (${res.status})`, retryable };
  }

  return { ok: true, reason: null, retryable: false };
}
