// Orbit X :: collective reading periods and deterministic source packets
// (Dev Update 5.2).
//
// This module owns calendar semantics and editorial curation. Astronomy still
// comes from Orbit's engine/context surfaces; this code only establishes the
// period, projects verified facts, and selects a small narrative set.

import { DateTime, IANAZone } from "luxon";

export const DEFAULT_EDITORIAL_TIMEZONE = "America/Chicago";
export const READING_TYPES = Object.freeze(["daily", "weekly", "monthly"]);

export const READING_FORMATS = Object.freeze({
  daily: "daily_reading",
  weekly: "weekly_reading",
  monthly: "monthly_reading",
});

export const READING_ROLE_SEQUENCES = Object.freeze({
  daily_reading: Object.freeze([
    "cover", "one_sentence", "movements", "reading", "reflection", "evidence",
  ]),
  weekly_reading: Object.freeze([
    "cover", "one_sentence", "opening", "pivot", "landing", "reading", "reflection", "evidence",
  ]),
  monthly_reading: Object.freeze([
    "cover", "one_sentence", "opening", "movement", "pivot", "later", "reading", "reflection", "key_dates", "evidence",
  ]),
});

const PRIORITY = Object.freeze({
  full_moon: 100,
  new_moon: 98,
  mercury_rx: 92,
  mercury_direct: 90,
  sun_ingress: 82,
});

const LIMITS = Object.freeze({ daily: 3, weekly: 5, monthly: 8 });

function validType(type) {
  if (!READING_TYPES.includes(type)) throw new TypeError(`unknown reading type "${type}"`);
  return type;
}

export function editorialTimezone(value = DEFAULT_EDITORIAL_TIMEZONE) {
  const zone = String(value || DEFAULT_EDITORIAL_TIMEZONE);
  return IANAZone.isValidZone(zone) ? zone : DEFAULT_EDITORIAL_TIMEZONE;
}

/**
 * The desk's calendar is editorial, not browser-local and never UTC-derived.
 * Keeping this beside the period calculator gives buttons, candidate lists,
 * and saved period keys one definition of "today".
 */
export function editorialDate(anchor = new Date(), timezone = DEFAULT_EDITORIAL_TIMEZONE, days = 0) {
  const zone = editorialTimezone(timezone);
  const at = anchorDate(anchor, zone).plus({ days: Number.isFinite(Number(days)) ? Number(days) : 0 });
  return at.toISODate();
}

function anchorDate(value, zone) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const dt = DateTime.fromISO(value, { zone });
    if (dt.isValid) return dt;
  }
  const js = value instanceof Date ? value : new Date(value || Date.now());
  const dt = DateTime.fromJSDate(js, { zone });
  if (!dt.isValid) throw new TypeError("invalid reading anchor");
  return dt;
}

/**
 * The range is [start_utc, end_utc): end_utc is explicitly exclusive. This
 * avoids fractional-second ambiguity and makes dedupe keys stable.
 */
export function calculateReadingPeriod(type, anchor, timezone = DEFAULT_EDITORIAL_TIMEZONE) {
  validType(type);
  const zone = editorialTimezone(timezone);
  const at = anchorDate(anchor, zone);
  let start;
  let end;
  if (type === "daily") {
    start = at.startOf("day");
    end = start.plus({ days: 1 });
  } else if (type === "weekly") {
    start = at.startOf("week"); // Luxon weeks are ISO Monday-first.
    end = start.plus({ days: 7 });
  } else {
    start = at.startOf("month");
    end = start.plus({ months: 1 });
  }

  const startDate = start.toISODate();
  const endDate = end.minus({ milliseconds: 1 }).toISODate();
  const key = type === "daily" ? `daily:${startDate}`
    : type === "weekly" ? `weekly:${startDate}:${endDate}`
      : `monthly:${start.toFormat("yyyy-MM")}`;
  const label = type === "daily" ? start.toFormat("MMMM d, yyyy")
    : type === "weekly" ? `${start.toFormat("MMM d")}–${end.minus({ days: 1 }).toFormat("MMM d, yyyy")}`
      : start.toFormat("MMMM yyyy");

  return Object.freeze({
    type,
    key,
    label,
    timezone: zone,
    start_date: startDate,
    end_date: endDate,
    start_utc: start.toUTC().toISO(),
    end_utc: end.toUTC().toISO(),
    end_exclusive: true,
  });
}

export function eventInPeriod(event, period) {
  const date = String(event?.date || "");
  return Boolean(date && date >= period.start_date && date <= period.end_date);
}

/** Select, do not dump. Ties remain chronological and therefore stable. */
export function selectReadingEvents(type, events, period) {
  validType(type);
  return (events || [])
    .filter((event) => eventInPeriod(event, period) && PRIORITY[event.kind])
    .map((event, sourceIndex) => ({ ...event, sourceIndex, editorialPriority: PRIORITY[event.kind] }))
    .sort((a, b) => b.editorialPriority - a.editorialPriority
      || String(a.date).localeCompare(String(b.date)) || a.sourceIndex - b.sourceIndex)
    .slice(0, LIMITS[type])
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map(({ sourceIndex: _sourceIndex, ...event }) => Object.freeze(event));
}

export function periodForCandidate(candidate) {
  return candidate?.facts?.period || null;
}

export function buildReadingCandidate({ type, period, events = [], context, skyAt = null }) {
  validType(type);
  if (!period || period.type !== type) throw new TypeError("reading period does not match type");
  const selected = selectReadingEvents(type, events, period).map((event) => {
    let sky = null;
    if (event.instant_utc && typeof skyAt === "function" && ["full_moon", "new_moon"].includes(event.kind)) {
      try {
        const at = skyAt(event.instant_utc);
        sky = {
          moon_sign: at?.moon?.sign || null,
          sun_sign: at?.sun?.sign || null,
          moon_illumination_percent: Number.isFinite(at?.moon?.illumination_percent)
            ? at.moon.illumination_percent : null,
          moon_waxing: at?.moon?.waxing === true,
        };
      } catch { sky = null; }
    }
    return Object.freeze({
      key: `${event.kind}:${event.date}`,
      kind: event.kind,
      date: event.date,
      instant_utc: event.instant_utc || null,
      title: String(event.title || "").replace(/\s*[☀-➿\u{1F300}-\u{1FAFF}️]+\s*$/u, "").trim(),
      detail: event.detail || null,
      approximate: /\(approximate\)/.test(event.detail || ""),
      ...(sky ? { sky_at_event: Object.freeze(sky) } : {}),
    });
  });

  const planets = context?.planets && typeof context.planets === "object"
    ? Object.values(context.planets).filter((p) => p?.name && p?.sign).map((p) => Object.freeze({
      name: p.name,
      sign: p.sign,
      degrees: Number.isFinite(p.degrees) ? p.degrees : null,
      retrograde: p.retrograde === true,
    })) : [];

  return Object.freeze({
    eventKey: period.key,
    eventType: "collective_reading",
    readingType: type,
    title: `${type[0].toUpperCase()}${type.slice(1)} Reading · ${period.label}`,
    timestamp: period.start_utc,
    facts: Object.freeze({
      period,
      local_date: period.start_date,
      moon_phase_name: context?.moon_phase_name || null,
      illumination_percent: Number.isFinite(context?.illumination_percent) ? context.illumination_percent : null,
      is_waxing: context?.is_waxing === true,
      moon_sign: context?.moon?.sign || null,
      planets: Object.freeze(planets),
      selected_events: Object.freeze(selected),
      source_note: "Astronomical facts calculated by the Orbit Axis deterministic engine. Symbolic copy is editorial.",
    }),
    source: "orbit-engine",
    approximate: selected.some((event) => event.approximate),
  });
}

export function readingFormatFor(type) {
  validType(type);
  return READING_FORMATS[type];
}
