// Orbit X :: example posts for template review (Dev Update 6.2).
//
// Real engine facts for one FIXED example date, wrapped in clearly labelled
// example copy. Used by the sample-sheet script, the grid preview and the
// render tests, so a template can be judged on realistic content without
// waiting for a real post. The facts (positions, longitudes, Moon state,
// events) come from the Orbit engine; only the interpretive sentences are
// written here, and they are example copy that is never published.

import { currentSky } from "@ezmannbuilds/orbit-axis-engine";
import { createCurrentSkyContext } from "../astro/current-sky-context.js";
import { upcomingEvents } from "../sky.js";
import { candidatesForDate, readingForDate } from "./engine-facts.js";
import { stripPlanets } from "./candidates.js";
import { editorialTimezone } from "./readings.js";
import { evergreenCandidate, EVERGREEN_TOPICS } from "./channel-candidates.js";
import { samplePost } from "./post-types.js";

export const EXAMPLE_DATE = "2026-11-09";

const LINES = Object.freeze({
  moon: ["Astrologers associate a New Moon with starting points, and the sign it falls in colours the theme.",
    "Notice what you keep returning to without being asked."],
  transit: ["Traditionally, a sign change is read as a shift in emphasis rather than an event.",
    "What has been in the background that you could name now?"],
  retrograde: ["A station marks where a planet appears to pause before reversing its apparent motion.",
    "Where could a second look be more useful than a first push?"],
  fact: ["A position is a measurement: an angle along the ecliptic, calculated to the minute.",
    "What would change if you asked for the measurement first?"],
  monthly: ["Over a month the Moon visits every sign while slower planets hold their places.",
    "What deserves another look before the month moves on?"],
  daily: ["Today the Moon sits close to the Sun, a pairing astrologers read as a quiet reset.",
    "What feels easier to name now?"],
});

const THEMES = Object.freeze({
  daily_reading: { head: "A quiet reset under a New Moon", one: "The Moon meets the Sun in Scorpio, a pairing astrologers read as a clean start." },
  weekly_reading: { head: "A week that slows, then clears", one: "Mercury turns direct while the Moon moves toward its first quarter." },
  monthly_reading: { head: "A month of turning points", one: "A New Moon, a change of season and a Full Moon mark the month." },
});

function skyFor(dateIso, env) {
  const tz = editorialTimezone(env?.ORBIT_X_EDITORIAL_TIMEZONE);
  const at = new Date(`${dateIso}T12:00:00.000Z`);
  const ctx = createCurrentSkyContext({ at, timezoneName: tz, timezoneSource: "orbit-x-editorial" });
  return { ctx, planets: stripPlanets(ctx.planets) };
}

/**
 * One candidate per kind of post, from real engine facts for `dateIso`.
 * @returns {Record<string, { candidate: object, formatId: string, kind: string }>}
 */
export function exampleCandidates(dateIso = EXAMPLE_DATE, env = process.env) {
  const { ctx, planets } = skyFor(dateIso, env);
  const out = {};
  // Asked from the day before, as the channel does, so a lunation early on the example day is not skipped.
  const dayBefore = new Date(Date.parse(`${dateIso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const moons = candidatesForDate(dayBefore, null, env).candidates;
  const moon = moons.find((c) => c.eventType === "full_moon" || c.eventType === "new_moon");
  if (moon) out.moon = { candidate: moon, formatId: "something_changed", kind: "moon" };
  for (const type of ["daily", "weekly", "monthly"]) {
    const { candidate } = readingForDate(type, dateIso, env);
    out[type] = { candidate, formatId: `${type}_reading`, kind: type === "monthly" ? "monthly" : type === "weekly" ? "transit" : "moon" };
  }
  const events = upcomingEvents(new Date(`${ctx.local_date}T12:00:00.000Z`), 12, { currentSkyContext: ctx });
  const named = (kind) => events.find((e) => e.kind === kind);
  const synth = (event, eventType) => ({
    eventKey: `${eventType}:${event.date}`, eventType, title: String(event.title || "").replace(/\s*[^\x20-\x7E]+\s*$/u, "").trim(),
    timestamp: event.date, source: "orbit-sky-tables", approximate: /\(approximate\)/.test(event.detail || ""),
    facts: { date: event.date, detail: event.detail || null, approximate: /\(approximate\)/.test(event.detail || ""), planets },
  });
  const ingress = named("sun_ingress");
  if (ingress) out.transit = { candidate: synth(ingress, "sun_ingress"), formatId: "something_changed", kind: "transit" };
  const station = named("mercury_rx") || named("mercury_direct");
  if (station) out.retrograde = { candidate: synth(station, station.kind), formatId: "something_changed", kind: "retrograde" };
  const topic = EVERGREEN_TOPICS.find((t) => t.slug === "your-sky-vs-the-sky");
  out.fact = { candidate: evergreenCandidate(topic, { planets, local_date: ctx.local_date }), formatId: "your_sky", kind: "fact" };
  const method = EVERGREEN_TOPICS.find((t) => t.slug === "why-apps-disagree");
  out.method = { candidate: evergreenCandidate(method, { planets, local_date: ctx.local_date }), formatId: "calculated_not_invented", kind: "fact" };
  return out;
}

/** A complete, valid post for an example candidate, in a given design. */
export function examplePost(entry, design) {
  const lines = LINES[entry.kind === "moon" && entry.formatId === "daily_reading" ? "daily" : entry.kind] || LINES.fact;
  const post = samplePost(entry.candidate, entry.formatId, design);
  const reflect = new Set(["reflection", "takeaway"]);
  const theme = THEMES[entry.formatId];
  const slides = post.slides.map((s) => {
    if (s.role === "one_sentence" && theme) return { ...s, body: theme.one };
    if (reflect.has(s.role)) return { ...s, body: lines[1] };
    if (/^Sample copy\./.test(s.body)) return { ...s, body: lines[0] };
    return s;
  });
  // A reading's theme is its headline, and its one-sentence slide mirrors the
  // thesis; both are set together so the post still validates.
  const reading = theme && post.reading ? { ...post.reading, theme: theme.head, oneSentence: theme.one } : post.reading;
  return { ...post, ...(theme ? { headline: theme.head } : {}), ...(reading ? { reading } : {}), slides,
    caption: `Example post for template review. ${lines[0]}` };
}

/** The sky the example date was drawn from (for labels). */
export const EXAMPLE_NOTE = `Example data: real Orbit engine positions for ${EXAMPLE_DATE}; interpretive lines are example copy.`;

export { currentSky };

/* ── Rendering an example in a given template ─────────────────────────────── */

import { normalizeDesign, renderPost } from "./templates.js";

/**
 * Render one example post in a template.
 * @param {object} entry     one value of exampleCandidates()
 * @param {object} opts      { template, variant, aspect }
 */
export function renderExample(entry, { template, variant = 0, aspect = "portrait" }) {
  const design = normalizeDesign({ template, variant, aspect }, entry.candidate.eventType, entry.formatId);
  const post = examplePost(entry, design);
  const rendered = renderPost({ ...post, design }, {
    eventType: entry.candidate.eventType, title: entry.candidate.title, facts: entry.candidate.facts,
    sky: entry.candidate.facts?.planets || [], design,
  });
  return { post, design, rendered };
}
