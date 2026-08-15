// Orbit Axis :: the sky events worth telling someone about.
//
// WHAT COUNTS AS AN EVENT
//
// Something the sky actually does, at a time that can be stated. A full moon
// happens at an instant. Mercury stations at an instant. Venus crosses into
// Libra at an instant. Those are facts with timestamps, and a notification
// about one is useful even if it is never tapped — which is the test this
// whole feature has to pass.
//
// Deliberately NOT here: anything derived from whether the reader has opened
// the app, anything phrased to provoke a reply, and anything that is only
// interesting because it has been a while. Those are engagement mechanics
// wearing an astronomy costume.
//
// THE MOON'S SIGN CHANGES ARE NOT INCLUDED.
//
// The Moon crosses a sign boundary every 2.3 days — thirteen a month, on top
// of everything else. That is not the sky doing something notable, it is the
// Moon doing what it does constantly, and a phone that says so thirteen times
// a month has stopped being informative. The Moon's actual moments are its
// phases, which are covered.

import { nextLunarEvents } from "../../vendor/orbit-axis-engine/src/domain/current-sky.js";
import { nextStations, nextIngresses } from "../../vendor/orbit-axis-engine/src/domain/upcoming-events.js";

/** Bumped when the SHAPE of an event changes in a way a scheduler would notice. */
export const SKY_EVENTS_VERSION = "sky-events-v1";

/** The rolling window. Long enough to be useful, short enough to stay accurate. */
export const DEFAULT_WINDOW_DAYS = 30;

/**
 * The event kinds a reader can switch on, and the setting each belongs to.
 *
 * One id per kind, used by the settings, the copy, and the scheduler alike, so
 * a kind cannot be enabled in one place and unknown in another.
 */
export const EVENT_KINDS = Object.freeze({
  full_moon: { id: "full_moon", setting: "moon", label: "Full moon" },
  new_moon: { id: "new_moon", setting: "moon", label: "New moon" },
  station_retrograde: { id: "station_retrograde", setting: "stations", label: "Retrograde stations" },
  station_direct: { id: "station_direct", setting: "stations", label: "Direct stations" },
  ingress: { id: "ingress", setting: "ingresses", label: "Sign changes" },
});

/** The settings a reader can tick. Each governs one or more kinds. */
export const EVENT_SETTINGS = Object.freeze(["moon", "stations", "ingresses"]);

/**
 * Bodies whose sign changes are worth a notification.
 *
 * The Moon is absent on purpose — see the note at the top. The Sun is included
 * because its ingress is the start of an astrological month and happens once.
 */
export const INGRESS_NOTIFY_BODIES = Object.freeze([
  "Sun", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto",
]);

const DAY_MS = 86_400_000;

/**
 * Every notifiable event in a window, oldest first.
 *
 * Returns ONE shape regardless of where the event came from, because the
 * scheduler and the copy should not need to know which engine function
 * produced it:
 *
 *   { id, kind, setting, body, instant_utc, longitude, sign, from_sign, to_sign }
 *
 * `id` is stable across recomputation — same event, same id, every time the
 * app opens. That is what lets the scheduler replace a window without
 * duplicating a notification the reader already has pending.
 *
 * @param {object} [options]
 * @param {Date}   [options.from]        window start (default: now)
 * @param {number} [options.windowDays]
 * @param {object} [options.engine]      injectable, for tests
 */
export function skyEventsInWindow({
  from = new Date(),
  windowDays = DEFAULT_WINDOW_DAYS,
  engine = { nextLunarEvents, nextStations, nextIngresses },
} = {}) {
  const start = from instanceof Date ? from : new Date(from);
  if (Number.isNaN(start.getTime())) {
    throw new TypeError(`skyEventsInWindow: invalid start date ${JSON.stringify(from)}`);
  }
  const endMs = start.getTime() + windowDays * DAY_MS;
  const events = [];
  // The lunation walk asks "next full and next new" repeatedly, and those two
  // are rarely the same distance away — so a pass that steps past the full
  // moon finds the SAME new moon again. Stable ids make the duplicate exact,
  // and therefore exactly removable.
  const seen = new Set();
  const add = (event) => {
    if (seen.has(event.id)) return;
    seen.add(event.id);
    events.push(event);
  };

  // ── Lunations ────────────────────────────────────────────────────────────
  // nextLunarEvents answers "the next one of each" rather than "all in a
  // window", so the window is walked: take the next pair, step past the later
  // of them, ask again. A 30-day window holds one or two of each.
  let cursor = start;
  for (let guard = 0; guard < 8; guard += 1) {
    const lunar = engine.nextLunarEvents(cursor);
    const found = [lunar?.full_moon, lunar?.new_moon].filter(Boolean);
    if (!found.length) break;

    for (const event of found) {
      const ms = Date.parse(event.instant_utc);
      if (!Number.isFinite(ms) || ms > endMs) continue;
      add(normalize({
        kind: event.kind === "new_moon" ? "new_moon" : "full_moon",
        body: "Moon",
        instant_utc: event.instant_utc,
      }));
    }
    // Step past the EARLIER of the two, so the later one is still found on the
    // next pass. Stepping past the later one skips events.
    const earliest = Math.min(...found.map((e) => Date.parse(e.instant_utc)).filter(Number.isFinite));
    if (!Number.isFinite(earliest) || earliest > endMs) break;
    cursor = new Date(earliest + 60_000);
  }

  // ── Stations ─────────────────────────────────────────────────────────────
  const stations = engine.nextStations(start, { horizonDays: windowDays })?.stations ?? [];
  for (const station of stations) {
    const ms = Date.parse(station.instant_utc);
    if (!Number.isFinite(ms) || ms > endMs) continue;
    add(normalize({
      kind: station.kind,
      body: station.body,
      instant_utc: station.instant_utc,
      sign: station.sign,
      longitude: station.longitude,
    }));
  }

  // ── Ingresses ────────────────────────────────────────────────────────────
  const ingresses = engine.nextIngresses(start, { horizonDays: windowDays })?.ingresses ?? [];
  for (const ingress of ingresses) {
    if (!INGRESS_NOTIFY_BODIES.includes(ingress.body)) continue;
    const ms = Date.parse(ingress.instant_utc);
    if (!Number.isFinite(ms) || ms > endMs) continue;
    add(normalize({
      kind: "ingress",
      body: ingress.body,
      instant_utc: ingress.instant_utc,
      from_sign: ingress.from_sign,
      to_sign: ingress.to_sign,
      sign: ingress.to_sign,
    }));
  }

  events.sort((a, b) => Date.parse(a.instant_utc) - Date.parse(b.instant_utc));
  return { events_version: SKY_EVENTS_VERSION, window_days: windowDays, from_utc: start.toISOString(), events };
}

/**
 * One event, one shape, one stable id.
 *
 * The id is built from kind, body and the instant to the MINUTE. Not the
 * second: recomputing an event from a slightly later start can move a bisected
 * instant by a second or two, and an id that moved with it would make the same
 * full moon look like a new event on every app open — scheduling a duplicate
 * and leaving the old one pending.
 */
function normalize({ kind, body, instant_utc, sign = null, from_sign = null, to_sign = null, longitude = null }) {
  const minute = String(instant_utc).slice(0, 16);   // YYYY-MM-DDTHH:MM
  return Object.freeze({
    id: `${kind}:${body}:${minute}Z`,
    kind,
    setting: EVENT_KINDS[kind]?.setting ?? null,
    body,
    instant_utc,
    sign,
    from_sign,
    to_sign,
    longitude,
  });
}

/** Only the events whose setting the reader has switched on. */
export function filterEnabled(events, enabledSettings = []) {
  const on = new Set(enabledSettings);
  return events.filter((event) => on.has(event.setting));
}
