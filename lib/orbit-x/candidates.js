// Orbit X :: deterministic candidate generation (Dev Update 5.0).
//
// THE ENGINE IS NEVER ASKED BY THE MODEL AND NEVER SECOND-GUESSED. Candidates
// are a pure transformation of what lib/sky.js and the CurrentSkyContext
// already computed. Nothing here calculates astronomy; nothing downstream may
// alter what arrives here. The `facts` object on each candidate is the
// verified packet — the AI receives it verbatim and its copy is checked
// against it, never the other way round.
//
// EVENT KEYS ARE THE DUPLICATE GUARD. `sun_ingress:2026-09-22` names one real
// event however many times it is looked at, which is what lets the store say
// "you already covered this" instead of silently minting a second draft.

import { FORMAT_IDS, suggestedFormat } from "./formats.js";

/** Candidate types the desk RECOMMENDS (owner decision, Dev Update 5.3).
 *
 * The desk recommends four things and nothing else: a Daily, Weekly, and
 * Monthly reading — built in readings.js from the period engine — and a Moon
 * reading, which is what these two event kinds are. Ingresses, Mercury
 * stations, and the evergreen education stock are no longer offered: a feed
 * that posts everything the sky does teaches an audience to scroll past it,
 * and the four surviving kinds are the ones with a rhythm a viewer can
 * actually follow.
 *
 * The FORMATS those retired topics used are deliberately still defined. A
 * post already saved under one must keep rendering and validating forever;
 * removing a format would break stored rows, which is a different and much
 * worse thing than removing a recommendation. */
export const CANDIDATE_TYPES = Object.freeze(["full_moon", "new_moon"]);

/** The moon readings shown at once: the NEXT of each kind. The engine knows
 *  about lunations months ahead, but a list offering four full moons is a
 *  backlog, not a recommendation. */
export const MOON_LOOKAHEAD_PER_KIND = 1;

function num(value) { return typeof value === "number" && Number.isFinite(value); }

/** Strip the engine's planet map to what a rendered Sky Strip needs. The
 *  values pass through untouched — this is projection, not calculation. */
export function stripPlanets(planets) {
  if (!planets || typeof planets !== "object") return [];
  return Object.values(planets)
    .filter((p) => p && p.name && p.sign)
    .map((p) => ({ name: p.name, sign: p.sign,
      degrees: num(p.degrees) ? p.degrees : null, retrograde: p.retrograde === true }));
}

/**
 * Turn engine events + the sky context into normalized candidates.
 *
 * @param {Array}  events   from lib/sky.js upcomingEvents()
 * @param {object} context  the canonical CurrentSkyContext
 * @param {object} [deps]   { skyAt(instantUtc) } — the engine's currentSky,
 *                          injected so lunation candidates can carry the
 *                          calculated sign and illumination AT THE EVENT
 *                          INSTANT. Still the engine speaking: same function,
 *                          different timestamp, recorded in the packet.
 * @returns {{ candidates: Array, skipped: Array, setAside: Array }}
 */
export function buildCandidates(events, context, { skyAt = null } = {}) {
  const candidates = [];
  const skipped = [];
  const setAside = [];

  // The synthetic "today's sky" candidate is gone with Dev Update 5.3: the
  // Daily Reading is that post now, and it is built by readings.js from the
  // period engine rather than assembled here. stripPlanets() stays because the
  // reading packets and the Sky Strip both still need it.

  const seenPerKind = new Map();

  for (const event of events || []) {
    if (!event || !event.date || !event.kind) {
      // Malformed is a category, not an error: named, counted, never invented
      // handling. See the failure-handling rules.
      skipped.push({ kind: event?.kind ?? "malformed", date: event?.date ?? null });
      continue;
    }
    if (!CANDIDATE_TYPES.includes(event.kind)) {
      // NOT the same thing as malformed. This event is real, calculated, and
      // perfectly renderable — the desk simply does not recommend its kind
      // any more. Counted separately so the UI can say "3 other sky events
      // this period" without implying the engine produced something broken.
      setAside.push({ kind: event.kind, date: event.date });
      continue;
    }
    // Only the NEXT full moon and the NEXT new moon are recommendations; the
    // ones after them are a backlog and push the readings down the list.
    const seen = seenPerKind.get(event.kind) || 0;
    if (seen >= MOON_LOOKAHEAD_PER_KIND) {
      setAside.push({ kind: event.kind, date: event.date });
      continue;
    }
    seenPerKind.set(event.kind, seen + 1);
    // The stray-glyph strip mirrors the events timeline: the emoji in `title`
    // is response-contract presentation, not a fact.
    const title = String(event.title || "").replace(/\s*[☀-➿\u{1F300}-\u{1FAFF}️]+\s*$/u, "").trim();

    // Sky at the event instant (Dev Update 5.1): for engine-exact lunations,
    // ask the SAME engine what the sky held at that moment — the Moon's sign,
    // the Sun's sign, the illumination the disc should render. Approximate
    // events (the Mercury tables) get nothing: precision that isn't there is
    // not manufactured here.
    let skyAtEvent = null;
    if (typeof skyAt === "function" && event.instant_utc
      && ["full_moon", "new_moon"].includes(event.kind)) {
      try {
        const sky = skyAt(event.instant_utc);
        skyAtEvent = Object.freeze({
          computed_at_utc: event.instant_utc,
          moon_sign: sky?.moon?.sign || null,
          sun_sign: sky?.sun?.sign || null,
          moon_illumination_percent: num(sky?.moon?.illumination_percent) ? sky.moon.illumination_percent : null,
          moon_waxing: sky?.moon?.waxing === true,
        });
      } catch { skyAtEvent = null; } // absence over invention, always
    }

    // The sign is already in the packet, so the recommendation says it: a row
    // reading "Full Moon in Pisces" is a post you can picture, where "Full
    // Moon" is a row you still have to open to understand.
    const titled = skyAtEvent?.moon_sign ? `${title} in ${skyAtEvent.moon_sign}` : title;

    candidates.push(Object.freeze({
      eventKey: `${event.kind}:${event.date}`,
      eventType: event.kind,
      title: titled,
      timestamp: event.instant_utc || event.date,
      facts: Object.freeze({
        date: event.date,
        instant_utc: event.instant_utc || null,
        detail: event.detail || null,
        // Mercury windows are documented approximations in lib/sky.js; the
        // packet says so, and the copy must too or omit timing precision.
        approximate: /\(approximate\)/.test(event.detail || ""),
        ...(skyAtEvent ? { sky_at_event: skyAtEvent } : {}),
      }),
      source: event.source === "orbit-axis-engine" ? "orbit-engine" : "orbit-sky-tables",
      approximate: /\(approximate\)/.test(event.detail || ""),
    }));
  }

  return { candidates, skipped, setAside };
}

/** A candidate's natural format, for the UI's suggestion column. */
export function formatFor(candidate) {
  // A reading candidate's period lives in `readingType`, not in `eventType` —
  // all three are "collective_reading". Asking by event type alone suggested
  // the Daily format for the weekly and monthly readings too.
  const id = candidate?.readingType
    ? `${candidate.readingType}_reading`
    : suggestedFormat(candidate.eventType);
  return FORMAT_IDS.includes(id) ? id : "something_changed";
}
