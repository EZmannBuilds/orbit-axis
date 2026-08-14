// Orbit Axis :: compatibility HTTP dispatch (transport-agnostic).
//
// Returns { status, body } so create-app.js stays thin, exactly like
// lib/charts/api.js. Ownership comes from the authenticated server identity,
// never from the client — the request supplies two ids and nothing else that
// matters.
//
// Routes:
//   GET /api/compatibility/options            which charts can be compared
//   GET /api/compatibility/compare?a=&b=      the comparison itself
//
// The legacy GET /api/compatibility (sun-sign distance) is a different,
// unauthenticated endpoint and is untouched by this module. Both exist; only
// this one is reachable from the interface.

import { createChartService, ChartError } from "../charts/service.js";
import {
  createSupabaseChartStore, supabaseChartStore, currentOwnerId, isConfigured,
} from "../charts/store.js";
import { compareCharts, comparisonOptions, CompatibilityError, statusForCode } from "./service.js";
import { refuseUnless } from "../entitlements/enforce.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function err(status, error, extra = {}) { return { status, body: { ok: false, error, ...extra } }; }
function ok(body) { return { status: 200, body: { ok: true, ...body } }; }

/**
 * Refusals become answers with a code; anything else becomes a bare 500.
 *
 * `not_found` covers both "no such chart" and "not yours" — deliberately the
 * same response, because distinguishing them tells an attacker which ids exist
 * on the account. This mirrors lib/charts/api.js rather than inventing a
 * second convention.
 */
function mapError(e) {
  if (e instanceof CompatibilityError) {
    return err(statusForCode(e.code), e.message, { code: e.code, ...e.details });
  }
  if (e instanceof ChartError) {
    const status = { not_found: 404, invalid_input: 400 }[e.code] || 400;
    return err(status, e.message, { code: e.code });
  }
  return err(500, "Compatibility comparison failed");
}

function serviceFor(auth = null) {
  return createChartService(auth ? createSupabaseChartStore(auth) : supabaseChartStore);
}

function requireOwner(auth = null) {
  if (auth?.ownerId && auth?.accessToken && auth?.anonKey && auth?.url) {
    return { owner: auth.ownerId, guard: null };
  }
  const owner = currentOwnerId();
  if (!owner || !isConfigured()) {
    return { owner: null, guard: err(401, "Sign-in required.") };
  }
  return { owner, guard: null };
}

/** Returns null when this module does not own the route. */
export async function handleCompatibilityRoute(method, route, query, body, auth = null) {
  if (route !== "/api/compatibility/options" && route !== "/api/compatibility/compare") {
    return null;
  }
  if (method !== "GET") {
    return err(405, "Compatibility is read-only.");
  }

  const { owner, guard } = requireOwner(auth);
  if (guard) return guard;
  const svc = serviceFor(auth);

  if (route === "/api/compatibility/options") {
    const subject = query?.get?.("subject") || null;
    // A malformed subject hint is ignored rather than refused: it is an
    // optional preference, and the endpoint's job is to describe what is
    // available, not to police a query string.
    const hint = subject && UUID_RE.test(subject) ? subject : null;
    try {
      return ok({ options: await comparisonOptions(svc, owner, hint) });
    } catch (e) {
      return mapError(e);
    }
  }

  // ── Entitlement (Dev Update 3.0) ──────────────────────────────────────────
  // Compatibility is the clearest upgrade trigger in the product: it needs a
  // second chart, which is the moment somebody has outgrown the free tier.
  //
  // Gated here rather than at /options, deliberately. Someone on free should
  // still SEE which of their charts could be compared — a locked door you can
  // read the sign on is honest; an empty room is a bug report.
  //
  // Returns null while enforcement is dark, so today this changes nothing.
  const refusal = await refuseUnless(
    auth, "chart.compatibility",
    "Comparing two charts is part of a paid plan.");
  if (refusal) return refusal;

  const a = query?.get?.("a") || null;
  const b = query?.get?.("b") || null;
  // Shape is checked before anything touches the database, so a malformed id
  // never becomes a query. Same gate as lib/charts/api.js.
  if (!a || !b || !UUID_RE.test(a) || !UUID_RE.test(b)) {
    return err(400, "Pass two saved chart ids as a and b.", { code: "invalid_input" });
  }

  try {
    return ok({ comparison: await compareCharts(svc, owner, a, b) });
  } catch (e) {
    return mapError(e);
  }
}
