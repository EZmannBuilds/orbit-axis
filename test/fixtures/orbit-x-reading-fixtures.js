export const READING_CONTEXT = Object.freeze({
  context_version: "test-context-v1",
  local_date: "2026-08-20",
  moon_phase_name: "First Quarter",
  illumination_percent: 52.4,
  is_waxing: true,
  moon: Object.freeze({ sign: "Scorpio" }),
  planets: Object.freeze({
    sun: Object.freeze({ name: "Sun", sign: "Leo", degrees: 27.1, retrograde: false }),
    moon: Object.freeze({ name: "Moon", sign: "Scorpio", degrees: 3.4, retrograde: false }),
    mercury: Object.freeze({ name: "Mercury", sign: "Leo", degrees: 12.8, retrograde: false }),
    venus: Object.freeze({ name: "Venus", sign: "Libra", degrees: 5.2, retrograde: false }),
    mars: Object.freeze({ name: "Mars", sign: "Cancer", degrees: 18.9, retrograde: false }),
    jupiter: Object.freeze({ name: "Jupiter", sign: "Leo", degrees: 8.6, retrograde: false }),
    saturn: Object.freeze({ name: "Saturn", sign: "Aries", degrees: 13.2, retrograde: true }),
    uranus: Object.freeze({ name: "Uranus", sign: "Gemini", degrees: 2.4, retrograde: false }),
    neptune: Object.freeze({ name: "Neptune", sign: "Aries", degrees: 1.7, retrograde: true }),
    pluto: Object.freeze({ name: "Pluto", sign: "Aquarius", degrees: 3.1, retrograde: true }),
  }),
});

export const READING_EVENTS = Object.freeze([
  Object.freeze({ date: "2026-08-22", instant_utc: "2026-08-22T18:02:00.000Z", kind: "sun_ingress", title: "Sun enters Virgo", detail: "Virgo season begins." }),
  Object.freeze({ date: "2026-08-28", instant_utc: "2026-08-28T04:18:33.000Z", kind: "full_moon", title: "Full Moon", detail: "Peak illumination.", source: "orbit-axis-engine" }),
  Object.freeze({ date: "2026-09-10", instant_utc: "2026-09-10T09:00:00.000Z", kind: "new_moon", title: "New Moon", detail: "Dark sky.", source: "orbit-axis-engine" }),
  Object.freeze({ date: "2026-09-22", kind: "sun_ingress", title: "Sun enters Libra", detail: "Libra season begins." }),
]);
