// Orbit X :: editorial scoring (Dev Update 5.0).
//
// AN EDITORIAL RANKING TOOL, NOT ASTRONOMICAL TRUTH — and it says so in the
// UI. Five dimensions, each 0–5, total out of 25, every number produced by
// rules a person can read below. No model is consulted: ranking topics is a
// deterministic editorial policy, and paying an API to shuffle a list would
// violate the cost rules besides.
//
// Novelty is the only history-aware dimension, kept deliberately simple: the
// same event key already covered → floor; the same TYPE covered recently →
// penalty scaled by how recently. No embeddings, no vector store — a count
// and a date are explainable, and V1's whole scoring promise is that the UI
// can show WHY something ranked where it did.

export const SCORE_MAX_PER_DIMENSION = 5;
export const SCORE_DIMENSIONS = Object.freeze([
  "significance", "beginnerValue", "visualPotential", "productConnection", "novelty",
]);

const BASE = Object.freeze({
  //                    sig  begin  visual product
  sun_ingress:        [  4,    4,     4,     4 ],
  full_moon:          [  4,    5,     5,     4 ],
  new_moon:           [  4,    5,     4,     4 ],
  mercury_rx:         [  5,    4,     3,     4 ],
  mercury_direct:     [  4,    4,     3,     4 ],
  daily_sky:          [  2,    4,     4,     5 ],
  educational:        [  3,    5,     3,     5 ],
});

const clamp = (n) => Math.max(0, Math.min(SCORE_MAX_PER_DIMENSION, Math.round(n)));

/**
 * Score one candidate against recent editorial history.
 *
 * @param {object} candidate
 * @param {Array}  history  rows with { event_key, event_type, created_at, status }
 * @param {string} todayIso YYYY-MM-DD — passed in, never read from a clock here,
 *                          so the same inputs always score identically.
 */
export function scoreCandidate(candidate, history = [], todayIso = "1970-01-01") {
  const base = BASE[candidate.eventType] || [1, 1, 1, 1];
  const reasons = [];

  const scores = {
    significance: clamp(base[0]),
    beginnerValue: clamp(base[1]),
    visualPotential: clamp(base[2]),
    productConnection: clamp(base[3]),
    novelty: SCORE_MAX_PER_DIMENSION,
  };

  // Approximate timing (the Mercury tables say so themselves) reads as less
  // significant than an engine-exact instant, and the reason says why.
  if (candidate.approximate) {
    scores.significance = clamp(scores.significance - 1);
    reasons.push("timing is approximate, per the source table");
  }

  const covered = history.filter((row) => row.event_key === candidate.eventKey
    && ["draft", "approved", "exported"].includes(row.status));
  const sameTypeRecent = history.filter((row) => row.event_type === candidate.eventType
    && row.created_at && daysBetween(row.created_at, todayIso) <= 14
    && ["draft", "approved", "exported"].includes(row.status));

  if (covered.length > 0) {
    scores.novelty = 0;
    reasons.push("this exact event already has a draft or post");
  } else if (sameTypeRecent.length >= 2) {
    scores.novelty = clamp(SCORE_MAX_PER_DIMENSION - 2 * sameTypeRecent.length);
    reasons.push(`${sameTypeRecent.length} recent posts of this type in 14 days`);
  } else if (sameTypeRecent.length === 1) {
    scores.novelty = clamp(SCORE_MAX_PER_DIMENSION - 2);
    reasons.push("this type was covered in the last 14 days");
  } else {
    reasons.push("not recently covered");
  }

  if (scores.significance >= 4) reasons.unshift("strong event");
  if (scores.beginnerValue >= 4) reasons.push("beginner-friendly");
  if (scores.visualPotential >= 4) reasons.push("visually clear");

  const totalScore = SCORE_DIMENSIONS.reduce((sum, key) => sum + scores[key], 0);
  return Object.freeze({
    scores: Object.freeze(scores),
    totalScore,
    maxScore: SCORE_MAX_PER_DIMENSION * SCORE_DIMENSIONS.length,
    duplicate: covered.length > 0,
    reasons: Object.freeze(reasons),
  });
}

function daysBetween(isoA, isoB) {
  const a = Date.parse(String(isoA).slice(0, 10));
  const b = Date.parse(String(isoB).slice(0, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.abs(b - a) / 86_400_000;
}

/** Highest score first; equal scores fall back to soonest event, then key. */
export function rankCandidates(scored) {
  return [...scored].sort((x, y) => y.score.totalScore - x.score.totalScore
    || String(x.candidate.timestamp || "9999").localeCompare(String(y.candidate.timestamp || "9999"))
    || x.candidate.eventKey.localeCompare(y.candidate.eventKey));
}
