// Orbit X :: engine facts for a date (Dev Update 6.1, moved from api.js).
//
// The desk and the automatic channel build candidates through THESE two
// functions and no others, so a post the channel publishes and a draft the
// desk opens for the same day are made from the same engine call. They were
// private to api.js until the channel needed them; the bodies are unchanged.

import { currentSky } from "@ezmannbuilds/orbit-axis-engine";
import { createCurrentSkyContext } from "../astro/current-sky-context.js";
import { upcomingEvents } from "../sky.js";
import { buildCandidates } from "./candidates.js";
import { calculateReadingPeriod, buildReadingCandidate, editorialTimezone } from "./readings.js";

/** Moon candidates are built in the EDITORIAL timezone, never the caller's.
 *
 * A lunation is one instant, but its calendar date is not: the August 2026
 * full moon is the 27th in Chicago and the 28th in UTC, and `event.date` is
 * what the event KEY is made of. Keyed off the requester, the same real moon
 * became two different candidates depending on which browser asked — and the
 * key is the duplicate guard, so the desk would have happily minted a second
 * draft of a moon it had already covered. The readings have always used the
 * editorial timezone; from Dev Update 5.3 the moons do too, so all four
 * recommendations share one calendar. The default is America/Chicago, which
 * is the timezone the existing production draft was keyed in — so no stored
 * key moves. */
export function candidatesForDate(dateIso, tz, env = process.env) {
  const timezone = editorialTimezone(env?.ORBIT_X_EDITORIAL_TIMEZONE);
  const at = dateIso ? new Date(`${dateIso}T12:00:00.000Z`) : new Date();
  const context = createCurrentSkyContext({ at, timezoneName: timezone, timezoneSource: "orbit-x-editorial" });
  const events = upcomingEvents(new Date(`${context.local_date}T12:00:00.000Z`), 12, { currentSkyContext: context });
  // skyAt: the engine re-asked at an event's exact instant, so lunation
  // packets carry the calculated sign and illumination of their own moment.
  const { candidates, skipped, setAside } = buildCandidates(events, context, {
    skyAt: (instantUtc) => currentSky(new Date(instantUtc)),
  });
  return { context, candidates, skipped, setAside };
}

export function readingForDate(type, dateIso, env) {
  const timezone = editorialTimezone(env.ORBIT_X_EDITORIAL_TIMEZONE);
  const period = calculateReadingPeriod(type, dateIso || new Date(), timezone);
  const at = new Date(period.start_utc);
  const context = createCurrentSkyContext({ at, timezoneName: timezone, timezoneSource: "orbit-x-editorial" });
  const events = upcomingEvents(at, 64, { currentSkyContext: context });
  const candidate = buildReadingCandidate({
    type, period, events, context,
    skyAt: (instantUtc) => currentSky(new Date(instantUtc)),
  });
  return { context, candidate, period };
}
