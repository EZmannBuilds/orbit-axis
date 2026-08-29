// Orbit Axis :: the first-party event vocabulary (Dev Update 6.0).
//
// Deliberately small. The temptation with analytics is to instrument
// everything and decide later; the cost of that is a table nobody can read and
// a privacy posture nobody can describe in a sentence. These are the events
// that answer the four questions the beta actually has:
//
//   did content bring someone here      session_started + the utm fields
//   did they sign up                    signup_completed
//   did they use it                     chart_created, *_opened, tarot_saved
//   did they come back                  returning_session
//
// Names match what the product calls these surfaces: Today is #home, Sky is
// #transits, Atlas is #symbol-atlas. There is no scroll, hover, focus or click
// event and there should not be one — this is for product learning, not
// surveillance.
//
// The same list is a CHECK constraint in the database, because the events table
// is insertable by anonymous visitors and the database has to be the thing that
// refuses an invented name.

export const EVENT_NAMES = Object.freeze([
  "session_started",
  "signup_completed",
  "chart_created",
  "today_opened",
  "sky_opened",
  "atlas_opened",
  "tarot_opened",
  "tarot_saved",
  "compatibility_opened",
  "returning_session",
]);

const EVENTS = new Set(EVENT_NAMES);

/** Attribution fields Orbit will store. Anything else in the URL is discarded. */
export const ATTRIBUTION_FIELDS = Object.freeze([
  "utm_source", "utm_medium", "utm_campaign", "utm_content",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isEventName(value) {
  return typeof value === "string" && EVENTS.has(value);
}

export function isIdentifier(value) {
  return typeof value === "string" && UUID.test(value);
}

/**
 * Normalise one attribution value.
 *
 * Bounded and stripped rather than stored as sent: these arrive in a URL that
 * anyone can write, and an unbounded string from a query parameter is how a
 * counting table becomes a storage endpoint for someone else's content.
 */
export function cleanAttribution(value, max = 64) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  // Campaign values are labels, not prose. Anything outside this shape is a
  // sign the parameter is being used for something it should not be.
  const safe = trimmed.replace(/[^a-z0-9._:-]/g, "");
  if (!safe) return null;
  return safe.slice(0, max);
}

/**
 * The host that referred the visit — never the full referring URL.
 *
 * A full URL can carry a path, a query, and occasionally somebody's search
 * terms. The host answers "did this come from Instagram" and carries none of
 * that. Mobile apps strip the referrer entirely, which is exactly why the utm
 * fields exist alongside it rather than instead of it.
 */
export function cleanReferrerHost(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.hostname.toLowerCase().slice(0, 128) || null;
  } catch {
    return null;
  }
}

/**
 * The landing path, without its query string.
 *
 * Orbit is hash-routed, so this is nearly always "/" — but it is recorded from
 * the server's view of the path rather than assumed, and the query is dropped
 * because that is where the utm values (already captured separately) and any
 * accidental personal data would be.
 */
export function cleanLandingPath(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const path = value.trim().split("?")[0].split("#")[0];
  if (!path.startsWith("/")) return null;
  return path.slice(0, 128);
}

/**
 * Validate an inbound event.
 *
 * Returns the row to write, or null. Never throws and never explains itself to
 * the caller in detail: this endpoint answers a fire-and-forget beacon, and a
 * validation essay would be a map of what to forge.
 */
export function validateEvent(body) {
  if (!body || typeof body !== "object") return null;
  if (!isEventName(body.name)) return null;
  if (!isIdentifier(body.session_id) || !isIdentifier(body.visitor_id)) return null;
  return { name: body.name, session_id: body.session_id, visitor_id: body.visitor_id };
}

/** Validate the session block that accompanies a first event. */
export function validateSession(body) {
  if (!body || typeof body !== "object") return null;
  if (!isIdentifier(body.session_id) || !isIdentifier(body.visitor_id)) return null;
  return {
    id: body.session_id,
    visitor_id: body.visitor_id,
    landing_path: cleanLandingPath(body.landing_path),
    referrer_host: cleanReferrerHost(body.referrer),
    utm_source: cleanAttribution(body.utm_source),
    utm_medium: cleanAttribution(body.utm_medium),
    utm_campaign: cleanAttribution(body.utm_campaign),
    utm_content: cleanAttribution(body.utm_content),
    campaign_key: cleanAttribution(body.campaign_key, 96),
  };
}
