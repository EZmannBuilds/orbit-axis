// Orbit Axis :: turning sky events into scheduled notifications.
//
// Pure. Nothing here touches Capacitor, a permission prompt, or a device — it
// takes events and settings and returns a plan. The plan is what the client
// hands to the notification plugin, and it is what the tests assert on, so the
// hard part is testable without a phone.
//
// WHEN A NOTIFICATION FIRES
//
// Not at the event instant. A full moon at 04:18 would wake someone up to tell
// them about a moon they cannot see from bed, and a station at 14:22 is not a
// moment anybody needs interrupting for.
//
// Instead: the morning of the event, or the evening before if the event lands
// before that morning. That is what produces the three shapes the product
// asked for —
//
//   event at 23:04  -> delivered 09:00 same day  -> "Full moon tonight at 23:04"
//   event at 14:00  -> delivered 09:00 same day  -> "Mercury stations direct today"
//   event at 06:30  -> delivered 20:00 the night before -> "Venus enters Libra tomorrow morning"
//
// — from one rule rather than three special cases.

import { notificationCopy } from "./copy.js";
import { filterEnabled } from "./events.js";

/** Bumped when the plan's shape changes in a way a client would notice. */
export const SCHEDULE_VERSION = "sky-schedule-v1";

/** Local hour a notification is delivered on the day of the event. */
export const MORNING_HOUR = 9;

/** Local hour used the evening before, for events earlier than MORNING_HOUR. */
export const EVENING_BEFORE_HOUR = 20;

/**
 * The channel every sky notification belongs to.
 *
 * One channel: they are all the same kind of thing, and splitting them would
 * let a reader silence full moons while keeping stations without Orbit knowing
 * — which would make the in-app settings a lie.
 */
export const CHANNEL_ID = "sky-events";

/**
 * A stable 32-bit integer id from an event id.
 *
 * The notification plugin keys on integers, and the id has to be the same for
 * the same event on every recomputation — that is what makes rescheduling
 * idempotent rather than duplicating every pending notification each time the
 * app opens. FNV-1a, masked positive, because the plugin rejects zero and
 * negatives on some platforms.
 */
export function notificationId(eventId) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < eventId.length; i += 1) {
    hash ^= eventId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 1) || 1;
}

/**
 * When to deliver a notification about an event.
 *
 * Returned as a UTC instant, because that is what the scheduler wants, but
 * derived entirely from the reader's LOCAL clock — the hour has to mean nine
 * in the morning where they are, not nine somewhere else.
 */
export function deliveryInstant(instantUtc, { timeZone, locale = "en-GB" }) {
  const event = new Date(instantUtc);
  const local = localFields(event, timeZone, locale);

  // Early enough that the morning-of delivery would come after it? Then the
  // evening before is the last useful moment to say anything.
  const useEveningBefore = local.hour < MORNING_HOUR;
  const targetHour = useEveningBefore ? EVENING_BEFORE_HOUR : MORNING_HOUR;
  const dayShift = useEveningBefore ? -1 : 0;

  return instantForLocalHour(event, { timeZone, locale, targetHour, dayShift });
}

/**
 * Build the whole plan.
 *
 * @param {object} options
 * @param {object[]} options.events        from skyEventsInWindow
 * @param {object} options.settings        { enabled, kinds: [], advanced }
 * @param {string} options.timeZone
 * @param {string} [options.locale]
 * @param {Date}   [options.now]           anything already past is not scheduled
 * @param {number[]} [options.houseCusps]  for Advanced; null is fine
 * @returns {{ version, channel, notifications: object[], skipped: object }}
 */
export function buildSchedule({
  events = [],
  settings = {},
  timeZone,
  locale = "en-GB",
  now = new Date(),
  houseCusps = null,
} = {}) {
  if (!timeZone) throw new TypeError("buildSchedule: a timeZone is required");

  const skipped = { disabled: 0, past: 0, kind_off: 0 };

  // OFF MEANS NOTHING IS SCHEDULED. Not "no new ones" — an empty plan, so the
  // caller cancels everything and there is nothing pending afterwards.
  if (!settings.enabled) {
    return { version: SCHEDULE_VERSION, channel: CHANNEL_ID, notifications: [], skipped: { ...skipped, disabled: events.length } };
  }

  const chosen = filterEnabled(events, settings.kinds ?? []);
  skipped.kind_off = events.length - chosen.length;

  const nowMs = new Date(now).getTime();
  const notifications = [];

  for (const event of chosen) {
    const deliverAt = deliveryInstant(event.instant_utc, { timeZone, locale });
    // A delivery time already gone is not scheduled. Scheduling it would
    // either fire immediately — announcing a full moon that happened this
    // morning — or be silently dropped by the platform.
    if (deliverAt.getTime() <= nowMs) { skipped.past += 1; continue; }

    const { title, body } = notificationCopy(event, {
      now: deliverAt,                 // the day word is relative to DELIVERY
      timeZone, locale,
      advanced: settings.advanced === true,
      houseCusps,
    });

    notifications.push({
      id: notificationId(event.id),
      event_id: event.id,
      kind: event.kind,
      title,
      body,
      schedule_at_utc: deliverAt.toISOString(),
      event_at_utc: event.instant_utc,
    });
  }

  notifications.sort((a, b) => Date.parse(a.schedule_at_utc) - Date.parse(b.schedule_at_utc));
  return { version: SCHEDULE_VERSION, channel: CHANNEL_ID, notifications, skipped };
}

/* ── Local-clock arithmetic ───────────────────────────────────────────────── */

function localFields(date, timeZone, locale) {
  const fmt = new Intl.DateTimeFormat(locale, {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const got = {};
  for (const part of fmt.formatToParts(date)) got[part.type] = part.value;
  return {
    year: Number(got.year), month: Number(got.month), day: Number(got.day),
    hour: Number(got.hour) % 24, minute: Number(got.minute), second: Number(got.second),
  };
}

/**
 * The UTC instant at which a given local wall-clock hour occurs.
 *
 * There is no direct way to ask "what UTC instant is 09:00 in Chicago on this
 * date", so this converges on it: guess, read back what local time the guess
 * actually lands on, and correct by the difference. Two passes settle it
 * including across a DST boundary, where the first correction can itself shift
 * the offset.
 */
function instantForLocalHour(nearDate, { timeZone, locale, targetHour, dayShift }) {
  const local = localFields(nearDate, timeZone, locale);
  const targetLocal = Date.UTC(local.year, local.month - 1, local.day + dayShift, targetHour, 0, 0);

  let guess = new Date(targetLocal);
  for (let pass = 0; pass < 2; pass += 1) {
    const got = localFields(guess, timeZone, locale);
    const gotAsUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second);
    const drift = gotAsUtc - targetLocal;
    if (drift === 0) break;
    guess = new Date(guess.getTime() - drift);
  }
  return guess;
}

// NOTE: there is deliberately no reconcile() here.
//
// The client cancels every pending sky notification and schedules the plan
// fresh on each app open. A diffing reconciler would avoid a little churn, but
// it would have to exist twice — once here for the tests and once in the
// browser, which cannot import this module — and two implementations of "which
// ones are already pending" is exactly the kind of pair that drifts. Six
// notifications rescheduled to identical instants costs nothing.
