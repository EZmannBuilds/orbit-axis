// Orbit Axis :: the entitlement evaluator (Dev Update 3.0).
//
// THE ONE PLACE THAT ANSWERS "IS THIS PERSON ALLOWED?"
//
// Handlers ask; they never compute. A second implementation of this question is
// how two different answers to it start existing, and an authorization system
// with two answers is not an authorization system.
//
// DENY BY DEFAULT, EVERYWHERE
//
// No entitlement row, an unreadable row, a Supabase outage, an unknown plan
// name, a capability the matrix does not define: all of them resolve to FREE.
// The asymmetry is deliberate and matches lib/features.js — the cost of being
// wrongly restricted is a support message, and the cost of being wrongly
// granted is revenue and a promise broken to people who did pay.
//
// This means an outage degrades paying customers to free. That is the correct
// direction to fail, but it is a real cost, which is why plans are cached for
// the life of a request rather than re-fetched per capability check.
//
// THE CLIENT IS NEVER BELIEVED
//
// describeForClient() exists so the interface can render honestly — showing a
// lock instead of a button that will 403. Nothing the client sends about its
// own plan is read anywhere in this module.

import { supabaseConfig } from "../local-llm/config.js";
import {
  CURRENT_MATRIX_VERSION,
  DEFAULT_PLAN,
  capabilities,
  capability,
  isPlan,
} from "./plans.js";

/** Statuses that entitle someone to the plan they name. */
const ENTITLING = new Set(["active", "grace"]);

/**
 * What a caller holds, when nothing says otherwise.
 * `reason` is for logs and tests — never for the client.
 */
function freeHolding(reason) {
  return Object.freeze({
    plan: DEFAULT_PLAN,
    status: "active",
    matrixVersion: CURRENT_MATRIX_VERSION,
    reason,
  });
}

/**
 * Read the entitlement row for the signed-in owner.
 *
 * Owner-scoped through the caller's own access token, so RLS answers the
 * question a second time at the database. The owner id is never taken from a
 * client-supplied value.
 *
 * @param {object} auth  the authContext(): { url, anonKey, accessToken, ownerId }
 */
async function fetchEntitlement(auth) {
  const config = supabaseConfig();
  const url = auth?.url || config.url;
  const anonKey = auth?.anonKey || config.anonKey;
  const accessToken = auth?.accessToken || config.accessToken;
  const ownerId = auth?.ownerId || config.ownerId;
  if (!url || !anonKey || !accessToken || !ownerId) return null;

  const root = url.replace(/\/+$/, "");
  const query = `account_entitlements?owner_id=eq.${encodeURIComponent(ownerId)}`
    + "&select=plan,status,matrix_version,current_period_end&limit=1";

  const res = await fetch(`${root}/rest/v1/${query}`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/**
 * The plan this caller actually holds.
 *
 * Never throws. Every failure path returns free, because a handler asking
 * "what may this person do?" must always get an answer it can act on.
 *
 * @param {object} auth
 * @returns {Promise<{plan: string, status: string, matrixVersion: number, reason: string}>}
 */
export async function holdingFor(auth) {
  if (!auth?.ownerId) return freeHolding("not_signed_in");

  let row;
  try {
    row = await fetchEntitlement(auth);
  } catch {
    // An outage must not become an authorization decision in the generous
    // direction. It degrades to free, loudly enough to be visible in a test.
    return freeHolding("lookup_failed");
  }

  if (!row) return freeHolding("no_row");
  if (!isPlan(row.plan)) return freeHolding("unknown_plan");
  if (!ENTITLING.has(row.status)) return freeHolding(`status_${row.status}`);

  // A period that ended is expired whatever the status column still says. The
  // column is written by a webhook that may not have fired yet; the clock is
  // not.
  if (row.current_period_end && Date.parse(row.current_period_end) < Date.now()) {
    return freeHolding("period_ended");
  }

  return Object.freeze({
    plan: row.plan,
    status: row.status,
    matrixVersion: Number(row.matrix_version) || CURRENT_MATRIX_VERSION,
    reason: "entitled",
  });
}

/**
 * Resolve the plan ONCE per request and hang it on the auth context.
 *
 * Without this, a handler that checks three capabilities makes three round
 * trips to Supabase to learn the same fact — and worse, could get two different
 * answers within one request if a webhook lands in between.
 *
 * @param {object} auth
 */
export async function withHolding(auth) {
  if (!auth) return auth;
  if (auth.holding) return auth;                 // already resolved this request
  return { ...auth, holding: await holdingFor(auth) };
}

/** The resolved holding, resolving it if a caller forgot to. */
async function holding(auth) {
  return auth?.holding || await holdingFor(auth);
}

/**
 * The value of one capability for this caller.
 *
 * @param {object} auth
 * @param {string} name
 */
export async function capabilityFor(auth, name) {
  const held = await holding(auth);
  return capability(held.plan, name, held.matrixVersion);
}

/**
 * Boolean form. Only meaningful for capabilities whose value IS a boolean —
 * asking can(auth, "chart.saved.limit") would answer true for a limit of 1,
 * which is nonsense, so numeric and string capabilities are refused outright
 * rather than silently coerced.
 */
export async function can(auth, name) {
  const value = await capabilityFor(auth, name);
  if (typeof value !== "boolean") {
    throw new TypeError(
      `can() is for boolean capabilities; "${name}" is ${typeof value}. `
      + "Use capabilityFor() and compare explicitly.");
  }
  return value;
}

/**
 * Everything this caller may do, shaped for the client.
 *
 * The interface uses this to render a lock instead of a button that will fail.
 * It is a COPY of a server-side decision, not the decision itself: every route
 * re-checks, because a response body is not an authorization boundary.
 */
export async function describeForClient(auth) {
  const held = await holding(auth);
  return {
    plan: held.plan,
    status: held.status,
    capabilities: capabilities(held.plan, held.matrixVersion),
  };
}
