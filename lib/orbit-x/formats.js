// Orbit X :: the five editorial formats (Dev Update 5.0).
//
// FORMATS ARE CODE, NOT PROMPT PROSE. Every rule here — slide counts, copy
// limits, which candidate types fit, which CTAs are allowed, how autonomous a
// format could ever safely become — is inspectable by ordinary application
// code and asserted by tests. The AI prompt QUOTES these definitions; it does
// not own them, because a rule that lives only inside a prompt is a rule
// nobody can test.
//
// The autonomy risk category is documentation for a future that must not
// erase it: green could one day auto-publish, yellow always needs a human,
// red never runs autonomously without an explicit future policy. Nothing in
// V1 publishes anything.

/** CTAs Orbit is allowed to make. Nothing here promises an unbuilt feature,
 *  and none mention Orbit Pro — that offer is not live. */
export const APPROVED_CTAS = Object.freeze([
  "Explore today's sky in Orbit Axis.",
  "See your sky in Orbit Axis.",
  "Calculate your chart in Orbit Axis.",
  "Explore the current sky.",
  "See how this relates to your chart.",
  "", // an educational post may carry no CTA at all
]);

/** Editorial CTAs (Dev Update 5.1, §43): save/follow energy without begging.
 *  No "comment MOON", no "tag three friends" — ever. */
export const EDITORIAL_CTAS = Object.freeze([
  "Save this for the next Full Moon.",
  "Keep this for later.",
  "Follow the sky with Orbit Axis.",
]);

export const FORMATS = Object.freeze({
  daily_reading: Object.freeze({
    id: "daily_reading",
    name: "Daily Reading",
    purpose: "A concise collective reading for one editorial calendar day.",
    candidateTypes: Object.freeze(["collective_reading"]),
    readingType: "daily",
    requiresEvent: true,
    slides: Object.freeze({ min: 5, max: 6 }),
    limits: Object.freeze({ headline: 72, slideBody: 300, caption: 700 }),
    autonomyRisk: "yellow",
  }),
  weekly_reading: Object.freeze({
    id: "weekly_reading",
    name: "Weekly Reading",
    purpose: "A collective symbolic arc across a Monday–Sunday editorial week.",
    candidateTypes: Object.freeze(["collective_reading"]),
    readingType: "weekly",
    requiresEvent: true,
    slides: Object.freeze({ min: 7, max: 8 }),
    limits: Object.freeze({ headline: 72, slideBody: 320, caption: 800 }),
    autonomyRisk: "yellow",
  }),
  monthly_reading: Object.freeze({
    id: "monthly_reading",
    name: "Monthly Reading",
    purpose: "A curated collective reading for a named calendar month.",
    candidateTypes: Object.freeze(["collective_reading"]),
    readingType: "monthly",
    requiresEvent: true,
    slides: Object.freeze({ min: 8, max: 10 }),
    limits: Object.freeze({ headline: 76, slideBody: 340, caption: 900 }),
    autonomyRisk: "yellow",
  }),
  daily_signal: Object.freeze({
    id: "daily_signal",
    name: "Daily Signal",
    purpose: "An accessible overview of what stands out in the current sky.",
    candidateTypes: Object.freeze(["daily_sky"]),
    requiresEvent: true,
    slides: Object.freeze({ min: 1, max: 1 }),
    limits: Object.freeze({ headline: 60, slideBody: 220, caption: 500 }),
    autonomyRisk: "yellow",
  }),
  something_changed: Object.freeze({
    id: "something_changed",
    name: "Something Changed",
    purpose: "Explain one specific transition the engine calculated.",
    candidateTypes: Object.freeze(["sun_ingress", "full_moon", "new_moon", "mercury_rx", "mercury_direct"]),
    requiresEvent: true,
    // The five-slide carousel: what changed / the verified fact / what
    // astrologers associate / a notice prompt / CTA.
    slides: Object.freeze({ min: 4, max: 5 }),
    limits: Object.freeze({ headline: 60, slideBody: 240, caption: 600 }),
    autonomyRisk: "green",
  }),
  without_the_fog: Object.freeze({
    id: "without_the_fog",
    name: "Astrology Without the Fog",
    purpose: "Evergreen beginner education, no current event required.",
    candidateTypes: Object.freeze(["educational"]),
    requiresEvent: false,
    // Max raised to 8 in Dev Update 5.1: the Deep Explainer depth mode —
    // retrogrades, house systems, and methodology refuse to fit four slides.
    slides: Object.freeze({ min: 3, max: 8 }),
    limits: Object.freeze({ headline: 70, slideBody: 260, caption: 600 }),
    autonomyRisk: "yellow",
  }),
  your_sky: Object.freeze({
    id: "your_sky",
    name: "Your Sky ≠ The Sky",
    purpose: "The difference between the shared sky and a personal chart, with no personal predictive claims.",
    candidateTypes: Object.freeze(["educational", "daily_sky"]),
    requiresEvent: false,
    slides: Object.freeze({ min: 3, max: 4 }),
    limits: Object.freeze({ headline: 70, slideBody: 240, caption: 500 }),
    autonomyRisk: "yellow",
  }),
  calculated_not_invented: Object.freeze({
    id: "calculated_not_invented",
    name: "Calculated, Not Invented",
    purpose: "Orbit's methodological credibility: ephemeris first, language last. Never attacks other products.",
    candidateTypes: Object.freeze(["educational"]),
    requiresEvent: false,
    slides: Object.freeze({ min: 3, max: 6 }),
    limits: Object.freeze({ headline: 70, slideBody: 260, caption: 500 }),
    autonomyRisk: "green",
  }),
});

/** Slide-role sequences (Dev Update 5.1): the editorial arc each format
 *  renders and scaffolds. Extra slides in variable-depth formats repeat the
 *  sequence's expandable role (`explain`/`method`). */
export const ROLE_SEQUENCES = Object.freeze({
  daily_reading: Object.freeze(["cover", "one_sentence", "movements", "reading", "reflection", "evidence"]),
  weekly_reading: Object.freeze(["cover", "one_sentence", "opening", "pivot", "landing", "reading", "reflection", "evidence"]),
  monthly_reading: Object.freeze(["cover", "one_sentence", "opening", "movement", "pivot", "later", "reading", "reflection", "key_dates", "evidence"]),
  daily_signal: Object.freeze(["signal"]),
  something_changed: Object.freeze(["hero", "fact", "symbolic", "reflection", "cta"]),
  without_the_fog: Object.freeze(["hero", "explain", "explain", "takeaway"]),
  your_sky: Object.freeze(["hero", "the_sky", "your_sky", "takeaway"]),
  calculated_not_invented: Object.freeze(["hero", "method", "method", "takeaway"]),
});

/** The role added when the editor deepens a variable-depth format. */
export const EXPANDABLE_ROLE = Object.freeze({
  without_the_fog: "explain",
  calculated_not_invented: "method",
});

export const FORMAT_IDS = Object.freeze(Object.keys(FORMATS));

/** The format a candidate type most naturally becomes. */
export function suggestedFormat(candidateType) {
  if (candidateType === "collective_reading") return "daily_reading";
  if (candidateType === "daily_sky") return "daily_signal";
  if (candidateType === "educational") return "without_the_fog";
  return "something_changed";
}

/** Template geometry lives in configuration, not scattered magic numbers. */
export const TEMPLATE = Object.freeze({
  width: 1080,
  height: 1080,
  filePrefix: "orbit-axis",
});
