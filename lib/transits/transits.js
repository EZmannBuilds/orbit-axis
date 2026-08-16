// Orbit Axis :: how the current sky meets one person's chart.
//
// Positions owns the shared sky. My Chart owns the natal chart. This module
// owns the intersection — and nothing else. It calculates no positions of its
// own: the sky arrives from the canonical current-sky source and the natal
// placements from the authenticated active chart.
//
// Everything here is pure and deterministic. Same sky, same chart, same output.

import { PLANETS } from "../interpretation/planets.js";

/**
 * Bodies that transit, and natal points they may contact.
 *
 * The fortune engine's `personalTransits` covers seven bodies each way and
 * stops at Saturn. That is right for a daily fortune — Uranus, Neptune and
 * Pluto do not change what today feels like — but a transits workspace that
 * omits them cannot show background influences at all, which is half of what
 * this page is for. So the set is deliberately widened to all ten, and the orb
 * rules below are what stop that from flooding the page.
 */
export const TRANSITING_BODIES = Object.freeze([
  "Moon", "Sun", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto",
]);
export const NATAL_BODIES = TRANSITING_BODIES;

/** The five majors the engine already supports. Nothing is added. */
export const ASPECTS = Object.freeze([
  { name: "Conjunction", angle: 0, weight: 5 },
  { name: "Opposition", angle: 180, weight: 4 },
  { name: "Square", angle: 90, weight: 4 },
  { name: "Trine", angle: 120, weight: 2 },
  { name: "Sextile", angle: 60, weight: 2 },
]);

/**
 * Orb limits, in degrees, by transiting body speed class.
 *
 * WHY THESE DIFFER. The fortune engine uses a flat 3°, which is correct for the
 * seven fast bodies it covers. Applied to the outer planets it is not a limit
 * at all: Pluto moves about 0.018° a day, so a 3° orb keeps a single Pluto
 * aspect "active" for roughly a year, and every outer-planet contact a chart
 * has would sit on the page permanently. The Moon crosses the same 3° in about
 * five hours.
 *
 * So the orb narrows as the body slows. A background influence still qualifies
 * as background — it just has to be genuinely close before it earns a card.
 */
export const ORB_LIMITS = Object.freeze({
  Moon: 3, Sun: 3, Mercury: 3, Venus: 3, Mars: 3,      // fast: unchanged from the engine
  Jupiter: 2, Saturn: 2,                                // social
  Uranus: 1, Neptune: 1, Pluto: 1,                      // outer: tight, or they never leave
});

/** Speed classes drive both the orb above and the grouping below. */
export const SPEED_CLASS = Object.freeze({
  Moon: "fast", Sun: "fast", Mercury: "fast", Venus: "fast", Mars: "fast",
  Jupiter: "social", Saturn: "social",
  Uranus: "background", Neptune: "background", Pluto: "background",
});

/** How long an influence tends to last. Categories only — never a date. */
export const DURATION = Object.freeze({
  fast: "A fast-moving influence",
  social: "A developing influence",
  background: "A slower background influence",
});

const RELEVANCE = Object.freeze({
  Sun: 3, Moon: 3, Mercury: 2, Venus: 2, Mars: 2, Jupiter: 1, Saturn: 1,
  Uranus: 0, Neptune: 0, Pluto: 0,
});

/** Angular separation, 0–180. */
function separation(a, b) {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * Applying or separating.
 *
 * Reliable here for one specific reason: only ONE body is moving. The natal
 * point is fixed, so projecting the transiting body forward by its own daily
 * speed and re-measuring the orb is a real comparison, not a guess. This is
 * the method the fortune engine already uses, kept deliberately identical so
 * the two cannot disagree.
 *
 * Returns null when speed is missing, and the caller then shows nothing rather
 * than a placeholder.
 */
export function motionState(transitingLongitude, speed, natalLongitude, aspectAngle) {
  if (!Number.isFinite(speed) || !Number.isFinite(transitingLongitude)) return null;
  const now = Math.abs(separation(transitingLongitude, natalLongitude) - aspectAngle);
  const future = Math.abs(separation(transitingLongitude + speed, natalLongitude) - aspectAngle);
  if (future === now) return null;
  return future < now ? "Applying" : "Separating";
}

export function orbLimitFor(body) {
  return ORB_LIMITS[body] ?? 1;
}

/** Every supported transit-to-natal contact currently within orb. */
export function findTransits(sky, chart) {
  const skyPlanets = sky?.planets;
  const natal = chart?.planets;
  if (!skyPlanets || !natal) return [];
  const out = [];
  for (const t of TRANSITING_BODIES) {
    const tp = skyPlanets[t];
    if (!tp || !Number.isFinite(tp.longitude)) continue;
    const limit = orbLimitFor(t);
    for (const n of NATAL_BODIES) {
      const np = natal[n];
      if (!np || !Number.isFinite(np.longitude)) continue;
      const sep = separation(tp.longitude, np.longitude);
      for (const asp of ASPECTS) {
        const orb = Math.abs(sep - asp.angle);
        if (orb > limit) continue;
        out.push(Object.freeze({
          id: `${t}-${asp.name}-${n}`.toLowerCase(),
          transiting: t, natal: n, aspect: asp.name,
          orb: Math.round(orb * 100) / 100,
          orbLabel: formatOrb(orb),
          transitingLongitude: tp.longitude,
          natalLongitude: np.longitude,
          transitingPosition: formatPosition(tp),
          natalPosition: formatPosition(np),
          retrograde: tp.retrograde === true,
          motion: motionState(tp.longitude, tp.speed, np.longitude, asp.angle),
          speedClass: SPEED_CLASS[t],
          duration: DURATION[SPEED_CLASS[t]],
          background: SPEED_CLASS[t] === "background",
          aspectWeight: asp.weight,
        }));
        break;   // one aspect per pair — the closest match wins
      }
    }
  }
  return out;
}

export function formatOrb(orb) {
  const d = Math.floor(orb);
  const m = Math.round((orb - d) * 60);
  return m === 60 ? `${d + 1}°00′` : `${d}°${String(m).padStart(2, "0")}′`;
}

export function formatPosition(body) {
  if (!body || !body.sign) return "";
  const d = Number.isFinite(body.degrees) ? body.degrees : 0;
  const m = Number.isFinite(body.minutes) ? String(body.minutes).padStart(2, "0") : "00";
  return `${d}° ${m}′ ${body.sign}`;
}

/**
 * Ranking, read top to bottom. Each field only breaks ties above it.
 *
 * Relevance leads for the same reason it does on Home: sorting on orb alone
 * lets a permanently-close outer planet outrank a Moon conjunction that is
 * exact today. Orb still matters — it is just not the first question.
 */
export function transitRank(t) {
  return {
    relevance: -((RELEVANCE[t.transiting] ?? 0) + (RELEVANCE[t.natal] ?? 0)),
    weight: -t.aspectWeight,
    orb: t.orb,
    pair: t.id,                                   // deterministic final tie-break
  };
}

const ORDER = ["relevance", "weight", "orb", "pair"];

export function rankTransits(list) {
  return [...list].sort((x, y) => {
    const a = transitRank(x), b = transitRank(y);
    for (const f of ORDER) {
      if (a[f] < b[f]) return -1;
      if (a[f] > b[f]) return 1;
    }
    return 0;
  });
}

/**
 * One natal point can collect several contacts from the same transiting body
 * at once. Showing all of them says the same thing repeatedly, so only the
 * strongest survives per transiting/natal pair — the technical list keeps the
 * rest.
 */
export function suppressDuplicates(ranked) {
  const seen = new Set();
  return ranked.filter((t) => {
    const key = `${t.transiting}|${t.natal}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const IMMEDIATE_LIMIT = 6;
export const BACKGROUND_LIMIT = 4;

export function groupTransits(list) {
  const ranked = suppressDuplicates(rankTransits(list));
  const immediate = ranked.filter((t) => !t.background);
  const background = ranked.filter((t) => t.background);
  return {
    immediate: immediate.slice(0, IMMEDIATE_LIMIT),
    background: background.slice(0, BACKGROUND_LIMIT),
    // Counts BEFORE the display caps. The summary must describe the sky, not
    // the page: reporting `immediate.length` after slicing makes it say "6
    // active contacts" while the technical table on the same screen lists 8.
    immediateTotal: immediate.length,
    backgroundTotal: background.length,
    all: rankTransits(list),
  };
}

/**
 * A summary reproducible from the ranked set — never a mood invented beside it.
 *
 * Every number here is a real count of what is in orb. Where the page shows
 * fewer cards than exist, the summary says so rather than quietly reporting
 * the smaller number as the truth.
 */
export function summarise(groups) {
  const { immediate, background } = groups;
  const immediateTotal = groups.immediateTotal ?? immediate.length;
  const backgroundTotal = groups.backgroundTotal ?? background.length;
  if (!immediateTotal && !backgroundTotal) return null;
  const counts = {};
  for (const t of [...immediate, ...background]) counts[t.natal] = (counts[t.natal] || 0) + 1;
  const busiest = Object.entries(counts).sort((a, b) =>
    b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const tightest = immediate[0] || background[0];
  // Plain register, same numbers. "Active contacts to your chart" is precise
  // and it is four terms of vocabulary; "things in the sky lining up with your
  // chart" is the same fact, and someone who has never read an ephemeris can
  // picture it. The one sentence that still names planets is the one about the
  // closest contact, because those names are the titles of the cards below it
  // and the reader needs to be able to find the card being pointed at.
  const parts = [];
  parts.push(immediateTotal
    ? `${immediateTotal} thing${immediateTotal === 1 ? " in the sky is" : "s in the sky are"} lining up with your chart right now.`
    : "Nothing fast-moving is lining up with your chart right now.");
  if (immediateTotal > immediate.length) {
    parts.push(`The ${immediate.length} closest are shown below.`);
  }
  if (busiest && busiest[1] > 1) {
    const area = PLANETS[busiest[0]]?.plain;
    parts.push(area
      ? `Most of it is landing on ${area} — ${busiest[1]} of them.`
      : `Your ${busiest[0]} is taking most of it, with ${busiest[1]} contacts.`);
  }
  if (tightest) {
    parts.push(`The closest is ${tightest.transiting} with your ${tightest.natal}, ${tightest.orbLabel} from exact.`);
  }
  if (backgroundTotal && !immediateTotal) {
    parts.push("What is there is slow, long-running movement rather than anything happening today.");
  }
  return Object.freeze({
    text: parts.join(" "),
    immediateCount: immediateTotal,
    backgroundCount: backgroundTotal,
    immediateShown: immediate.length,
    backgroundShown: background.length,
    busiestNatal: busiest ? busiest[0] : null,
  });
}

/**
 * NOT OFFERED, deliberately.
 *
 * No exact-hit timestamp and no end date. Producing either would mean
 * integrating a body's motion forward until the orb closes, which the sky
 * payload does not support and a straight-line estimate gets wrong for exactly
 * the bodies people ask about — anything slowing toward a station never
 * arrives when the projection says it will.
 */
export const EXACT_TIMING_SUPPORTED = false;

/** Natal targets that need a birth time. Withheld when there isn't one. */
export const TIME_SENSITIVE_TARGETS = Object.freeze(["Ascendant", "Midheaven", "houses"]);

export function birthTimeNotice(chart) {
  if (chart?.time_known === false) {
    return Object.freeze({
      title: "Calculated without a birth time",
      body: "Transits to your planets are shown normally — they do not depend on the time of day. "
          + "Contacts to your Rising sign, Midheaven, and houses need a birth time, so Orbit Axis leaves them out.",
    });
  }
  if (chart?.time_accuracy === "approximate") {
    return Object.freeze({
      title: "Calculated from an approximate birth time",
      body: "Transits to your planets are barely affected by a small timing error. "
          + "Anything involving your Rising sign, Midheaven, or houses would be, so those are not shown.",
    });
  }
  return null;
}

/** Role text reused from the Dev Update 1.5 corpus — never a second version. */
export function planetRole(name) {
  return PLANETS[name]?.function_ || null;
}
