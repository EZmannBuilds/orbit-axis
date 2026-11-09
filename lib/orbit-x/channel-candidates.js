// Orbit X :: what the channel could post on a given day (Dev Update 6.1).
//
// THREE SOURCES, ALL ENGINE OR CODE, NONE INVENTED.
//
//   Readings   the Daily reading every day; the Weekly on the first two days
//              of its ISO week; the Monthly on the first two days of its
//              month. Built by engine-facts.js, the desk's own code path.
//   Events     Full and New Moons, on their editorial-timezone day only, and
//              only when the engine supplied the exact instant.
//   Evergreen  the methodology stock retired from the desk in Dev Update 5.3,
//              revived for the channel with one change: every number in a
//              "ground" fact is read from code at runtime. The old stock said
//              "seven house systems" as a literal; the literal is gone, so the
//              sentence cannot drift away from what the app actually offers.
//
// Each option names its format, its autonomy level, its urgency, and the key
// the duplicate guard uses. Policy (what may post) and rotation (what should
// post) are decided elsewhere; this file only says what exists.

import { HOUSE_SYSTEMS } from "../charts/service.js";
import { candidatesForDate, readingForDate } from "./engine-facts.js";
import { calculateReadingPeriod, READING_FORMATS } from "./readings.js";
import { autonomyFor } from "./policy.js";
import { CHANNEL_EVENT_KINDS } from "./channel-config.js";

const HOUSE_NAMES = Object.freeze({
  placidus: "Placidus", whole: "Whole Sign", equal: "Equal", koch: "Koch",
  campanus: "Campanus", regiomontanus: "Regiomontanus", porphyry: "Porphyry",
});

function houseList() {
  const names = HOUSE_SYSTEMS.map((id) => HOUSE_NAMES[id] || id);
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The evergreen stock. `ground` is a function so its numbers are always
 *  today's code, never a remembered literal. */
export const EVERGREEN_TOPICS = Object.freeze([
  Object.freeze({
    slug: "what-an-ephemeris-does", format: "calculated_not_invented", title: "What an ephemeris does",
    ground: () => "Orbit calculates planetary positions with Swiss Ephemeris on its own server. Language models never supply a position, a date, or a sign.",
  }),
  Object.freeze({
    slug: "why-apps-disagree", format: "calculated_not_invented", title: "Why astrology apps can disagree",
    ground: () => `Two charts built from the same ephemeris can still differ because of the house system. Orbit offers ${HOUSE_SYSTEMS.length}: ${houseList()}.`,
  }),
  Object.freeze({
    slug: "what-is-a-house-system", format: "without_the_fog", title: "What is a house system?",
    ground: () => `A house system divides the sky around a birth place and time into twelve sectors. Orbit offers ${HOUSE_SYSTEMS.length} of them. A planet's sign and its house are separate facts.`,
  }),
  Object.freeze({
    slug: "what-does-retrograde-mean", format: "without_the_fog", title: "What does retrograde actually mean?",
    ground: () => "Retrograde is apparent backwards motion: seen from a moving Earth, a planet seems to reverse for a while. No planet ever reverses its orbit.",
  }),
  Object.freeze({
    slug: "your-sky-vs-the-sky", format: "your_sky", title: "The sky everyone shares is not your chart",
    ground: () => "The current sky is one set of positions shared by everyone on Earth. A personal chart is a separate calculation from a birth date, time and place.",
  }),
]);

/** @param {object} [sky] { planets, local_date } from the engine, for the
 *  topic that draws the shared sky (your_sky). Never invented: absent sky
 *  means an absent strip. */
export function evergreenCandidate(topic, sky = null) {
  const planets = topic.format === "your_sky" && Array.isArray(sky?.planets) && sky.planets.length ? sky.planets : null;
  return Object.freeze({
    eventKey: `educational:${topic.slug}`,
    eventType: "educational",
    title: topic.title,
    timestamp: null,
    facts: Object.freeze({ topic: topic.slug, ground: topic.ground(),
      ...(planets ? { planets, local_date: sky.local_date } : {}) }),
    source: "orbit-editorial",
    approximate: false,
  });
}

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The day's options.
 *
 * @param {string} slotDate YYYY-MM-DD in the editorial timezone
 * @param {object} env
 * @param {object} [deps] { readingFor, moonsFor } — injectable for tests
 * @returns {{ options: Array, notes: Array<string> }}
 */
export function channelOptions(slotDate, env = process.env, {
  readingFor = (type) => readingForDate(type, slotDate, env),
  // Asked from the PREVIOUS day: candidatesForDate() anchors at 12:00 UTC and
  // reports the NEXT lunation after that instant, so a Full Moon early on the
  // slot day itself (before 12:00 UTC) would otherwise be reported as next
  // month's. From the day before, the next one is the slot day's if it has one.
  moonsFor = () => candidatesForDate(addDays(slotDate, -1), null, env),
} = {}) {
  const options = [];
  const notes = [];
  const timezone = env.ORBIT_X_EDITORIAL_TIMEZONE;
  let sky = null;

  for (const type of ["daily", "weekly", "monthly"]) {
    if (type !== "daily") {
      const period = calculateReadingPeriod(type, slotDate, timezone);
      // A weekly or monthly reading belongs at the start of its period. Past
      // the second day it is late, and the channel lets it go.
      if (slotDate !== period.start_date && slotDate !== addDays(period.start_date, 1)) continue;
    }
    try {
      const { candidate, period } = readingFor(type);
      if (type === "daily") sky = { planets: candidate.facts?.planets || [], local_date: candidate.facts?.local_date || slotDate };
      const formatId = READING_FORMATS[type];
      options.push({
        candidate, formatId, kind: "reading", autonomy: autonomyFor(formatId),
        urgency: type !== "daily" && slotDate === period.start_date ? "period_start" : "standing",
        periodKey: period.key, eventKey: candidate.eventKey,
      });
    } catch {
      notes.push(`${type} reading could not be calculated for ${slotDate}`);
    }
  }

  try {
    const { candidates } = moonsFor();
    for (const c of candidates) {
      if (!CHANNEL_EVENT_KINDS.includes(c.eventType)) continue;
      if (c.facts?.date !== slotDate) continue;
      if (c.source !== "orbit-engine" || c.approximate || !c.facts?.instant_utc) {
        notes.push(`${c.eventKey} is not engine-exact; not eligible for the channel`);
        continue;
      }
      options.push({
        candidate: c, formatId: "something_changed", kind: "event", autonomy: autonomyFor("something_changed"),
        urgency: "event_today", periodKey: c.eventKey, eventKey: c.eventKey,
      });
    }
  } catch {
    notes.push(`moon events could not be calculated for ${slotDate}`);
  }

  for (const topic of EVERGREEN_TOPICS) {
    const candidate = evergreenCandidate(topic, sky);
    options.push({
      candidate, formatId: topic.format, kind: "evergreen", autonomy: autonomyFor(topic.format),
      urgency: "standing", topicKey: topic.slug,
      // Evergreen posts are keyed per day: the topic window in rotation.js is
      // what stops a topic repeating, not the period index.
      periodKey: `${candidate.eventKey}:${slotDate}`, eventKey: candidate.eventKey,
    });
  }

  return { options, notes };
}
