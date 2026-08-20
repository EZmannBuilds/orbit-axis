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

/** Candidate types V1 understands. Anything else is skipped, visibly. */
export const CANDIDATE_TYPES = Object.freeze([
  "sun_ingress", "full_moon", "new_moon", "mercury_rx", "mercury_direct",
  "daily_sky", "educational",
]);

/** Evergreen topics: real editorial stock, not placeholders. Each cites the
 *  calculation ground it stands on, honouring calculate-first even where no
 *  event is involved. */
export const EDUCATIONAL_TOPICS = Object.freeze([
  { slug: "what-is-a-house-system", title: "What is a house system?",
    ground: "Orbit computes seven house systems; a planet's sign and its house are different facts." },
  { slug: "why-apps-disagree", title: "Why do astrology apps disagree?",
    ground: "Same ephemeris, different house systems and zodiacs — a settings difference, not an error." },
  { slug: "what-does-retrograde-mean", title: "What does retrograde actually mean?",
    ground: "Apparent backwards motion from Earth's frame; the engine reports station instants." },
  { slug: "what-is-a-transit", title: "What is a transit?",
    ground: "A moving body forming a measured angle to a fixed natal position." },
  { slug: "why-birth-time-matters", title: "Why does birth time matter?",
    ground: "Houses and the Ascendant are time-derived; Orbit withholds them rather than guessing." },
  { slug: "what-an-ephemeris-does", title: "What an ephemeris does",
    ground: "Positions come from Swiss Ephemeris data, not from language models." },
  { slug: "your-sky-vs-the-sky", title: "The sky everyone shares isn't your chart",
    ground: "Collective conditions versus personal transits — different calculations, different questions." },
]);

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
 * @returns {{ candidates: Array, skipped: Array }}
 */
export function buildCandidates(events, context, { skyAt = null } = {}) {
  const candidates = [];
  const skipped = [];

  // Today's sky as a candidate in its own right — the Daily Signal's ground.
  // Dev Update 5.1: the packet now carries the full position table, because
  // the Sky Grid template renders it and a saved draft must be able to
  // re-render its strip from its own verified facts forever.
  if (context?.moon_phase_name && context?.local_date) {
    candidates.push(Object.freeze({
      eventKey: `daily_sky:${context.local_date}`,
      eventType: "daily_sky",
      title: `Today's sky — ${context.moon_phase_name}`,
      timestamp: context.local_date,
      facts: Object.freeze({
        local_date: context.local_date,
        moon_phase_name: context.moon_phase_name,
        illumination_percent: num(context.illumination_percent) ? context.illumination_percent : null,
        is_waxing: context.is_waxing === true,
        moon_sign: context.moon?.sign || null,
        next_full_moon: context.next_full_moon?.local_date || null,
        next_new_moon: context.next_new_moon?.local_date || null,
        planets: Object.freeze(stripPlanets(context.planets)),
      }),
      source: "orbit-engine",
      approximate: false,
    }));
  }

  for (const event of events || []) {
    if (!event || !CANDIDATE_TYPES.includes(event.kind) || !event.date) {
      // Unsupported is a category, not an error: named, counted, never
      // invented handling. See the failure-handling rules.
      skipped.push({ kind: event?.kind ?? "malformed", date: event?.date ?? null });
      continue;
    }
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

    candidates.push(Object.freeze({
      eventKey: `${event.kind}:${event.date}`,
      eventType: event.kind,
      title,
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

  // Evergreen stock rides along so the desk is never empty on a quiet sky.
  for (const topic of EDUCATIONAL_TOPICS) {
    candidates.push(Object.freeze({
      eventKey: `educational:${topic.slug}`,
      eventType: "educational",
      title: topic.title,
      timestamp: null,
      facts: Object.freeze({ ground: topic.ground }),
      source: "orbit-editorial",
      approximate: false,
    }));
  }

  return { candidates, skipped };
}

/** A candidate's natural format, for the UI's suggestion column. */
export function formatFor(candidate) {
  const id = suggestedFormat(candidate.eventType);
  return FORMAT_IDS.includes(id) ? id : "something_changed";
}
