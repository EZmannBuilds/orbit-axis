// Orbit Axis Engine :: transits — moving sky against a fixed natal chart.
//
// Extracted verbatim (behaviour-preserving) from the Orbit Axis application's
// fortune engine, where this pure geometry sat mixed in with reading
// composition. Transits are a calculation, not a reading: the same sky against
// the same chart must always give the same aspects, orbs, and applying state,
// whatever the caller intends to say about them afterwards.
//
// Applying vs separating is derived from the transiting body's own speed —
// advance it one day and see whether the orb tightens. That makes the
// classification a property of the ephemeris, not an opinion.
//
// This module is pure: no I/O, no clock, no randomness. It is given a sky
// snapshot and a chart, and returns an array.

export const TRANSIT_VERSION = "transit-v1";

/**
 * Angular separation between two ecliptic longitudes, folded to 0–180°.
 * @param {number} a degrees
 * @param {number} b degrees
 * @returns {number} degrees, 0–180
 */
function separation(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Major aspects Orbit reports, with plain-language labels for presentation. */
export const TRANSIT_ASPECTS = Object.freeze([
  { name: "conjunction", angle: 0, plain: "meeting" },
  { name: "sextile", angle: 60, plain: "gently supporting" },
  { name: "square", angle: 90, plain: "pushing against" },
  { name: "trine", angle: 120, plain: "flowing with" },
  { name: "opposition", angle: 180, plain: "pulling against" },
]);

const SOFT = new Set(["trine", "sextile"]);
const HARD = new Set(["square", "opposition"]);

/** Bodies fast enough for day-scale transits to be meaningful. */
/**
 * What moves, and what it can move onto.
 *
 * Both lists originally stopped at Saturn, which silently excluded the slowest
 * and most consequential transits — a Pluto conjunction to the Sun could not be
 * reported at all — and excluded the angles and nodes, so "Saturn to natal
 * North Node" or anything touching the Ascendant was uncomputable rather than
 * merely absent.
 *
 * Chiron transits are included because the Chiron return and Chiron to the
 * Ascendant are among the most-tracked contacts it makes.
 *
 * Lilith is deliberately NOT a default target: the mean and osculating apogees
 * disagree by degrees, so which one a chart means is the caller's decision.
 * Pass it through `targets` to include it.
 */
export const TRANSITING_BODIES = Object.freeze([
  "Moon", "Sun", "Mercury", "Venus", "Mars", "Jupiter", "Saturn",
  "Uranus", "Neptune", "Pluto", "Chiron",
]);
export const NATAL_TARGETS = Object.freeze([
  "Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn",
  "Uranus", "Neptune", "Pluto", "Chiron",
  "North Node", "South Node", "Ascendant", "MC",
]);

/**
 * @typedef {object} Transit
 * @property {string} transiting  Moving body.
 * @property {string} natal       Fixed natal body it aspects.
 * @property {string} aspect      conjunction | sextile | square | trine | opposition
 * @property {string} plain       Plain-language label for the aspect.
 * @property {number} orb         Degrees from exact, rounded to 2dp.
 * @property {boolean} applying   True when the orb tightens over the next day.
 * @property {boolean} soft       Trine or sextile.
 * @property {boolean} hard       Square or opposition.
 * @property {number} t_lon       Transiting longitude.
 * @property {number} n_lon       Natal longitude.
 */

/**
 * Major aspects from currently moving planets to fixed natal planets.
 *
 * Only the tightest aspect per body pair is returned — a pair cannot
 * meaningfully be both square and trine, and reporting several would
 * double-count the same geometry as separate evidence.
 *
 * @param {{ planets?: Record<string, object>, points?: Record<string, object>,
 *           nodes?: object, angles?: object }} sky
 * @param {{ planets?: Record<string, object>, points?: Record<string, object>,
 *           nodes?: object, angles?: object }} chart
 * @param {number} [orbLimit=3] Maximum degrees from exact.
 * @param {{ bodies?: readonly string[], targets?: readonly string[] }} [scope]
 * @returns {Transit[]} sorted tightest orb first
 */
/**
 * Flatten a chart or sky into one name → body lookup.
 *
 * Planets, points, nodes, and angles arrive in four differently shaped places;
 * a transit does not care which. Reading through this keeps the caller free to
 * pass a bare `{ planets }` object, which is all this function required before
 * points and angles became targets.
 *
 * @param {object} source
 * @returns {Record<string, {longitude:number, speed?:number}>}
 */
function bodyIndex(source) {
  const index = { ...(source?.planets ?? {}), ...(source?.points ?? {}) };
  const nodes = source?.nodes ?? {};
  if (nodes.north) index["North Node"] = nodes.north;
  if (nodes.south) index["South Node"] = nodes.south;
  if (nodes.trueNorth) index["True Node"] = nodes.trueNorth;
  const angles = source?.angles ?? {};
  if (angles.ascendant) index.Ascendant = angles.ascendant;
  if (angles.midheaven) index.MC = angles.midheaven;
  // currentSky reports angles only when it was given a location.
  if (source?.ascendant) index.Ascendant = source.ascendant;
  if (source?.midheaven) index.MC = source.midheaven;
  return index;
}

export function personalTransits(sky, chart, orbLimit = 3, scope = {}) {
  const bodies = scope.bodies ?? TRANSITING_BODIES;
  const targets = scope.targets ?? NATAL_TARGETS;
  const moving = bodyIndex(sky);
  const fixed = bodyIndex(chart);

  const out = [];
  for (const t of bodies) {
    const tp = moving[t];
    if (!tp) continue;
    for (const n of targets) {
      const np = fixed[n];
      if (!np) continue;
      const s = separation(tp.longitude, np.longitude);
      for (const asp of TRANSIT_ASPECTS) {
        const orb = Math.abs(s - asp.angle);
        if (orb > orbLimit) continue;
        // Advance the transiting body one day; the natal body does not move.
        const future = ((tp.longitude + (tp.speed || 0)) % 360 + 360) % 360;
        const orbFuture = Math.abs(separation(future, np.longitude) - asp.angle);
        out.push({
          transiting: t, natal: n, aspect: asp.name, plain: asp.plain,
          orb: Math.round(orb * 100) / 100, applying: orbFuture < orb,
          soft: SOFT.has(asp.name), hard: HARD.has(asp.name),
          t_lon: tp.longitude, n_lon: np.longitude,
        });
        break; // tightest aspect for this pair only
      }
    }
  }
  return out.sort((a, b) => a.orb - b.orb);
}
