// Orbit Axis :: analytics HTTP surface (Dev Update 6.0).
//
//   POST /api/analytics/event    record a visit and/or one event   (open)
//   GET  /api/analytics/metrics  the beta metrics panel            (admin)
//
// The write route is OPEN because the visitors worth counting are the ones
// without an account. It answers 202 unconditionally — accepted, not
// necessarily stored. A beacon that reported validation failures would be a map
// of what to forge, and a beacon whose failure surfaced to the reader would let
// a counting table break a page.
//
// The read route is admin-only, through the same orbit_x_admins allowlist the
// editorial desk uses, and returns aggregates only.

import { recordEvent, recordSession, betaMetrics } from "./service.js";

/**
 * @param {string} method
 * @param {string} route
 * @param {object} body
 * @param {{ auth: object|null, isAdmin: boolean, now?: Date, fetchImpl?: function }} context
 * @returns {Promise<{status:number, body:object}|null>} null when unrouted
 */
export async function handleAnalyticsRoute(method, route, body = {}, context = {}) {
  const { auth = null, isAdmin = false, now = new Date(), fetchImpl = fetch, config = null } = context;

  if (route === "/api/analytics/event" && method === "POST") {
    // The owner id comes from the verified session or nowhere. A body claiming
    // to be an account is ignored rather than refused, because refusing would
    // tell a prober that the field is read at all.
    const ownerId = auth?.ownerId || null;

    // A landing beacon carries the session block; later events do not.
    if (body?.session) {
      await recordSession({ ...body.session, session_id: body.session_id, visitor_id: body.visitor_id },
        { fetchImpl, config });
    }
    if (body?.name) {
      await recordEvent(body, { ownerId, fetchImpl, config });
    }
    return { status: 202, body: { ok: true } };
  }

  if (route === "/api/analytics/metrics" && method === "GET") {
    // 404 rather than 403 for a non-admin, matching the Orbit X desk: an
    // internal surface should not confirm it exists to someone who cannot use it.
    if (!auth?.ownerId || !isAdmin) {
      return { status: 404, body: { ok: false, error: "Not found.", code: "not_found" } };
    }
    try {
      const metrics = await betaMetrics({ auth, now, fetchImpl });
      if (!metrics) {
        return { status: 503, body: { ok: false, error: "Metrics are unavailable.", code: "unavailable" } };
      }
      return { status: 200, body: { ok: true, metrics } };
    } catch {
      return { status: 502, body: { ok: false, error: "Metrics could not be read.", code: "unavailable" } };
    }
  }

  return null;
}
