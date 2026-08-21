// Orbit Axis :: first-party usage measurement (Dev Update 6.0).
//
// Orbit shipped with no analytics at all, and the privacy page said so
// truthfully. This adds the smallest thing that can answer four questions —
// did content bring someone here, did they sign up, did they use it, did they
// come back — and nothing beyond them.
//
// WHAT IT DOES NOT DO, by construction rather than by policy:
//
//   - no third-party script, no SDK, no pixel, no external request of any
//     kind:
//     every beacon goes to Orbit's own origin
//   - no fingerprinting: the two identifiers are random values this browser
//     generated for itself, not anything derived from the device
//   - no cross-site anything: both live in this origin's own storage
//   - no content: an event is a NAME and a TIME. Never a chart, a card, a
//     reading, a question, or a word the reader wrote
//   - no IP address is stored. Abuse protection hashes the peer address in
//     memory and writes nothing, which is deliberately a separate concern
//
// It stays silent for anyone sending Do Not Track or Global Privacy Control,
// and for any browser where storage is unavailable — a private window measures
// nothing rather than failing.

const VISITOR_KEY = "orbit.analytics.visitor";
const SESSION_KEY = "orbit.analytics.session";
const LAST_DAY_KEY = "orbit.analytics.lastDay";

/**
 * Honouring the browser's own signal, not just Orbit's promises about itself.
 * Global Privacy Control is the one with legal weight; Do Not Track is largely
 * vestigial but costs one line to respect, and refusing to read it would be a
 * choice nobody could justify on a page that claims this posture.
 */
function privacySignalled() {
  try {
    if (navigator.globalPrivacyControl === true) return true;
    const dnt = navigator.doNotTrack ?? window.doNotTrack;
    return dnt === "1" || dnt === "yes";
  } catch { return false; }
}

function uuid() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  // A v4-shaped fallback for older WebViews. Randomness quality does not matter
  // here: this is a counting key, never a secret and never a security boundary.
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
}

function store(area, key, value) {
  try { area.setItem(key, value); return true; } catch { return false; }
}
function read(area, key) {
  try { return area.getItem(key); } catch { return null; }
}

const state = { enabled: false, visitorId: null, sessionId: null };

/** Fire and forget. A counting beacon must never delay or break a page. */
function send(payload) {
  if (!state.enabled) return;
  try {
    fetch("/api/analytics/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, session_id: state.sessionId, visitor_id: state.visitorId }),
      // Survives the page being closed mid-navigation, which is exactly when a
      // landing beacon would otherwise be lost.
      keepalive: true,
    }).catch(() => { /* a lost count is not an error the reader should meet */ });
  } catch { /* ignore */ }
}

/**
 * Record one product event.
 *
 * Exposed globally rather than imported because app.js is a single classic
 * script rather than a module graph, and this file must stay optional: if it
 * fails to load, every call site is a no-op instead of a crash.
 *
 * @param {string} name one of the closed vocabulary the server accepts
 */
function track(name) {
  if (!state.enabled || !name) return;
  send({ name });
}

/**
 * The attribution fields, read once from the landing URL.
 *
 * Only these five are read; the rest of the query string is ignored rather than
 * stored, and they are removed from the address bar afterwards so a shared link
 * does not carry someone else's campaign tag around.
 */
function readAttribution() {
  let params;
  try { params = new URLSearchParams(location.search); } catch { return {}; }
  const get = (k) => params.get(k) || null;
  const attribution = {
    utm_source: get("utm_source"),
    utm_medium: get("utm_medium"),
    utm_campaign: get("utm_campaign"),
    utm_content: get("utm_content"),
    // Orbit's own content key, so an exported Orbit X post can be tied to the
    // visits its link produced without any social platform being involved.
    campaign_key: get("oxc"),
  };

  const carried = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "oxc"];
  if (carried.some((k) => params.has(k))) {
    try {
      for (const k of carried) params.delete(k);
      const query = params.toString();
      history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
    } catch { /* the address bar keeping the tag is cosmetic, not a failure */ }
  }
  return attribution;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function start() {
  if (privacySignalled()) return;

  const visitorId = read(localStorage, VISITOR_KEY) || uuid();
  if (!store(localStorage, VISITOR_KEY, visitorId)) return;  // no storage, no counting

  state.visitorId = visitorId;
  state.enabled = true;

  const existing = read(sessionStorage, SESSION_KEY);
  state.sessionId = existing || uuid();

  if (existing) return;   // same visit continuing; the landing was already recorded
  store(sessionStorage, SESSION_KEY, state.sessionId);

  const attribution = readAttribution();
  send({
    name: "session_started",
    session: {
      ...attribution,
      landing_path: location.pathname,
      referrer: document.referrer || null,
    },
  });

  // "Came back" means a different DAY, not a different tab. Two windows in one
  // sitting is not a return, and counting it as one would make the number
  // flattering and useless.
  const lastDay = read(localStorage, LAST_DAY_KEY);
  const day = today();
  if (lastDay && lastDay !== day) track("returning_session");
  store(localStorage, LAST_DAY_KEY, day);
}

window.orbitTrack = track;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
