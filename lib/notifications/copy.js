// Orbit Axis :: what a sky notification says.
//
// THE TEST EVERY LINE HAS TO PASS
//
// It has to be useful without being tapped. "Full moon tonight at 11:04" tells
// you something even if you never open the app; "The sky has a message for
// you" tells you nothing and exists only to be tapped. If a line is useless
// unopened, it is bait and it does not ship.
//
// That rules out, permanently: questions phrased to provoke a reply, anything
// that "calls" or "awaits" or "beckons", counts of what is waiting, and any
// mention of how long it has been since the app was opened. None of those
// describe the sky.
//
// TWO LEVELS, ONE SYSTEM
//
// Default states the event and the time. Advanced adds the reader's own chart
// context to the SAME event at the SAME moment — one more clause, not a
// different notification. Only Advanced may mention houses, aspects to natal
// placements, or orbs; default never does.

/** Bumped when wording changes in a way worth noticing across a release. */
export const NOTIFICATION_COPY_VERSION = "sky-copy-v1";

/**
 * How far ahead a day word still makes sense.
 *
 * Beyond this a date is clearer: "on 14 September" is precise, where "in about
 * three weeks" is a shrug. Roughly a day and a half, which covers "tonight",
 * "today", and every part of tomorrow.
 */
export const DAY_WORD_HORIZON_HOURS = 36;

/** Evening starts here, so an 11pm full moon is "tonight" rather than "today". */
const EVENING_HOUR = 18;

/** Events with a moment you could actually witness, which earn a clock time. */
const KINDS_WITH_A_VISIBLE_MOMENT = new Set(["full_moon", "new_moon"]);

const ORDINAL_HOUSES = Object.freeze([
  null, "first", "second", "third", "fourth", "fifth", "sixth",
  "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth",
]);

/* ── Time and day words ───────────────────────────────────────────────────── */

/** The parts of a UTC instant as they read on the reader's own clock. */
export function localParts(instantUtc, timeZone, locale = "en-GB") {
  const date = new Date(instantUtc);
  if (Number.isNaN(date.getTime())) throw new TypeError(`localParts: invalid instant ${instantUtc}`);
  const fmt = new Intl.DateTimeFormat(locale, {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const got = {};
  for (const part of fmt.formatToParts(date)) got[part.type] = part.value;
  return {
    date: `${got.year}-${got.month}-${got.day}`,
    hour: Number(got.hour) % 24,
    minute: Number(got.minute),
  };
}

/**
 * The clock time, in the reader's own format.
 *
 * Their locale decides 24-hour or 12-hour, and a 12-hour locale keeps its
 * meridiem. "at 11:04" without one would be ambiguous beside a word like
 * "today", and a reader whose phone shows 12-hour time expects to read it that
 * way — the point is their clock, not ours.
 */
export function clockTime(instantUtc, timeZone, locale = "en-GB") {
  return new Intl.DateTimeFormat(locale, {
    timeZone, hour: "numeric", minute: "2-digit",
  }).format(new Date(instantUtc));
}

/**
 * "tonight", "today", "tomorrow morning" — or a date when it is further off.
 *
 * Measured in LOCAL CALENDAR DAYS between the moment the notification is
 * delivered and the moment the event happens, not in elapsed hours. Twenty
 * hours can be either the same day or the next one, and a reader who is told
 * "today" about something happening after they go to bed has been told the
 * wrong thing.
 */
export function dayWord(instantUtc, { now, timeZone, locale = "en-GB" }) {
  const event = localParts(instantUtc, timeZone, locale);
  const today = localParts(now, timeZone, locale);
  const dayGap = calendarDayGap(today.date, event.date);
  const hoursAway = (new Date(instantUtc).getTime() - new Date(now).getTime()) / 3_600_000;

  // Beyond the horizon a date is honest; a day word would be a guess dressed
  // as familiarity.
  if (hoursAway > DAY_WORD_HORIZON_HOURS || dayGap > 1 || dayGap < 0) {
    return { word: onDate(instantUtc, timeZone, locale), kind: "date" };
  }

  if (dayGap === 0) {
    return event.hour >= EVENING_HOUR
      ? { word: "tonight", kind: "today" }
      : { word: "today", kind: "today" };
  }

  // Tomorrow, with the part of day attached — "tomorrow morning" is a more
  // useful thing to know at a glance than "tomorrow at 06:12".
  //
  // The small hours are the exception. partOfDay calls 03:06 "night", and
  // "tomorrow night" is heard as about nine in the evening — roughly eighteen
  // hours away from what was meant. "early tomorrow" cannot be misread.
  const part = partOfDay(event.hour);
  return {
    word: part === "night" && event.hour < 5 ? "early tomorrow" : `tomorrow ${part}`,
    kind: "tomorrow",
  };
}

/** Whole local calendar days between two YYYY-MM-DD strings. */
function calendarDayGap(fromDate, toDate) {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.NaN;
  return Math.round((to - from) / 86_400_000);
}

function partOfDay(hour) {
  if (hour < 5) return "night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 22) return "evening";
  return "night";
}

function onDate(instantUtc, timeZone, locale) {
  return `on ${new Intl.DateTimeFormat(locale, {
    timeZone, day: "numeric", month: "long",
  }).format(new Date(instantUtc))}`;
}

/* ── The event clause ─────────────────────────────────────────────────────── */

/**
 * What the sky is doing, in words, with no time attached.
 *
 * Present tense and plain. No adjectives about significance — "a powerful full
 * moon" is a claim about the reader's life rather than a description of the
 * sky, and the moment one line carries one, every line has to compete.
 */
export function eventClause(event) {
  switch (event.kind) {
    case "full_moon": return "Full moon";
    case "new_moon": return "New moon";
    case "station_retrograde": return `${event.body} stations retrograde`;
    case "station_direct": return `${event.body} stations direct`;
    case "ingress": return `${event.body} enters ${event.to_sign ?? event.sign}`;
    default: throw new RangeError(`eventClause: unknown event kind ${JSON.stringify(event.kind)}`);
  }
}

/* ── Advanced context ─────────────────────────────────────────────────────── */

/**
 * Which of the reader's houses an event falls in.
 *
 * Computed from house cusps the app already holds, so nothing about the chart
 * has to travel anywhere to produce this. Returns null when there is no chart,
 * no cusps, or no longitude — Advanced then simply adds nothing, and the
 * notification is the default one rather than a broken one.
 */
export function houseForLongitude(longitude, houseCusps) {
  // The engine returns houses as objects ({ house, longitude, sign, ... });
  // a caller with a plain list of cusp longitudes is equally valid. Accepting
  // both means no caller has to reshape the chart it already holds.
  const cusps = Array.isArray(houseCusps)
    ? houseCusps.map((cusp) => (typeof cusp === "number" ? cusp : cusp?.longitude))
    : null;
  if (!Number.isFinite(longitude) || !cusps || cusps.length !== 12
    || !cusps.every(Number.isFinite)) return null;
  const normalized = ((longitude % 360) + 360) % 360;
  for (let house = 1; house <= 12; house += 1) {
    const start = ((cusps[house - 1] % 360) + 360) % 360;
    const end = ((cusps[house % 12] % 360) + 360) % 360;
    // A house that wraps past 0° Aries is still one arc.
    const inside = start <= end
      ? normalized >= start && normalized < end
      : normalized >= start || normalized < end;
    if (inside) return house;
  }
  return null;
}

/** "in your seventh house", or nothing at all. */
export function houseClause(house) {
  const ordinal = ORDINAL_HOUSES[house];
  return ordinal ? `in your ${ordinal} house` : null;
}

/* ── The whole line ───────────────────────────────────────────────────────── */

/**
 * The notification text for one event.
 *
 * @param {object} event        from lib/notifications/events.js
 * @param {object} options
 * @param {Date|string} options.now        when the notification is DELIVERED
 * @param {string} options.timeZone        the reader's IANA zone
 * @param {string} [options.locale]        decides 24h vs 12h and month names
 * @param {boolean} [options.advanced]     add the reader's own chart context
 * @param {number[]} [options.houseCusps]  twelve cusp longitudes, if known
 * @returns {{ title: string, body: string|null }}
 */
export function notificationCopy(event, {
  now, timeZone, locale = "en-GB", advanced = false, houseCusps = null,
} = {}) {
  if (!event?.kind) throw new TypeError("notificationCopy: an event is required");
  if (!timeZone) throw new TypeError("notificationCopy: a timeZone is required");

  const when = dayWord(event.instant_utc, { now, timeZone, locale });
  const clause = eventClause(event);

  // A CLOCK TIME IS STATED ONLY FOR THINGS YOU CAN GO AND LOOK AT.
  //
  // A full moon is at an instant you could step outside for, so the minute is
  // useful. A station is a change of direction resolved by bisection, and an
  // ingress is a longitude crossing — neither looks like anything at 14:22,
  // and printing the minute claims a precision the event does not have for the
  // reader. The day word is the precision those events carry.
  const time = KINDS_WITH_A_VISIBLE_MOMENT.has(event.kind) && when.kind !== "date"
    ? ` at ${clockTime(event.instant_utc, timeZone, locale)}`
    : "";
  let title = `${clause} ${when.word}${time}`;

  if (advanced) {
    const house = houseForLongitude(event.longitude, houseCusps);
    const extra = houseClause(house);
    // Advanced is one more clause on the same line, not a second notification
    // and not a different schedule. With no chart it adds nothing and the
    // reader gets the default line.
    if (extra) title = `${title}, ${extra}`;
  }

  return { title, body: null };
}

/**
 * Language that must never appear in a notification.
 *
 * Exported so the test can run it over generated copy rather than over a list
 * somebody remembered to update. Every entry is a way of saying "open the app"
 * without saying anything about the sky.
 */
export const FORBIDDEN_NOTIFICATION_PATTERNS = Object.freeze([
  { pattern: /\b(?:awaits?|calls? to you|beckons?|is calling)\b/i, why: "bait" },
  { pattern: /\b(?:don'?t miss|last chance|hurry|act now)\b/i, why: "urgency" },
  { pattern: /\b(?:streak|day streak|keep it going|come back)\b/i, why: "engagement mechanic" },
  { pattern: /\byou haven'?t\b/i, why: "absence guilt" },
  { pattern: /\b(?:tap|open the app) to (?:see|find out|discover)\b/i, why: "useless unopened" },
  { pattern: /\?\s*$/, why: "phrased as a question to bait a reply" },
  { pattern: /\b(?:powerful|intense|life-changing|major|huge)\b/i, why: "claims significance" },
  { pattern: /\b(?:will|going to) (?:bring|change|transform)\b/i, why: "predicts an outcome" },
]);

/** Findings for one line; empty means it is publishable. */
export function auditNotificationCopy(text) {
  const findings = [];
  for (const { pattern, why } of FORBIDDEN_NOTIFICATION_PATTERNS) {
    if (pattern.test(text)) findings.push(`${why}: ${pattern}`);
  }
  return findings;
}
