// Orbit Axis :: the sky-notification plan endpoint.
//
//   GET /api/sky/notifications?tz=…&kinds=moon,stations&advanced=on
//
// Returns a PLAN — what to say and when to deliver it — which the device then
// schedules locally. There is no push token, no APNs, no device registration,
// and no record kept of who asked: this route reads the sky and returns text.
//
// WHY THE SERVER BUILDS THE PLAN
//
// The event times come from swetest, which is a native binary the server runs.
// A WebView cannot execute it, so the phone could never derive the instants on
// its own. Given the times have to come from here anyway, the copy is built
// here too — one implementation of the wording rules rather than a second copy
// in the browser that drifts from it.
//
// WHAT DOES NOT LEAVE THE PHONE
//
// The request carries a timezone, a locale, and which kinds are switched on.
// Nothing else. Advanced house context is computed from the reader's OWN chart,
// which the server already stores — no new exposure, and no birth data crosses
// the wire to produce it. Once the plan is returned, delivery is entirely
// on-device.

import { skyEventsInWindow, DEFAULT_WINDOW_DAYS, EVENT_SETTINGS } from "./events.js";
import { buildSchedule } from "./schedule.js";

/** A timezone this server recognises, or UTC. Never the server's own zone. */
function safeTimeZone(value) {
  if (!value || typeof value !== "string") return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

/** A locale Intl accepts, or en-GB. Decides 24h vs 12h and month names. */
function safeLocale(value) {
  if (!value || typeof value !== "string") return "en-GB";
  try {
    new Intl.DateTimeFormat(value);
    return value;
  } catch {
    return "en-GB";
  }
}

/**
 * @param {string} method
 * @param {string} route
 * @param {URLSearchParams} params
 * @param {object} context  { now, houseCusps, engine }
 */
export async function handleSkyNotificationsRoute(method, route, params, context = {}) {
  if (route !== "/api/sky/notifications" || method !== "GET") return null;

  const timeZone = safeTimeZone(params?.get("tz"));
  const locale = safeLocale(params?.get("locale"));
  const advanced = params?.get("advanced") === "on";

  // Unknown kinds are dropped rather than refused. A client from an older
  // release asking for a kind this one does not have should get the kinds it
  // asked for that do exist, not an error.
  const requested = (params?.get("kinds") || "").split(",").map((k) => k.trim()).filter(Boolean);
  const kinds = requested.filter((kind) => EVENT_SETTINGS.includes(kind));

  const now = context.now ?? new Date();
  const windowDays = Number(params?.get("window_days")) || DEFAULT_WINDOW_DAYS;

  // Nothing switched on: an empty plan, and no ephemeris work at all. The
  // device reads this as "cancel everything", which is what off has to mean.
  if (kinds.length === 0) {
    return {
      status: 200,
      body: {
        ok: true,
        plan: { version: "sky-schedule-v1", channel: "sky-events", notifications: [], skipped: { disabled: 0, past: 0, kind_off: 0 } },
        window_days: windowDays,
        timezone: timeZone,
      },
    };
  }

  const { events } = skyEventsInWindow({
    from: now,
    windowDays: Math.max(1, Math.min(windowDays, 90)),
    ...(context.engine ? { engine: context.engine } : {}),
  });

  const plan = buildSchedule({
    events,
    settings: { enabled: true, kinds, advanced },
    timeZone,
    locale,
    now,
    houseCusps: context.houseCusps ?? null,
  });

  return {
    status: 200,
    body: { ok: true, plan, window_days: windowDays, timezone: timeZone },
  };
}
