// Orbit X :: the diversity engine (Dev Update 6.1).
//
// ONE POST A DAY, CHOSEN SO THE FEED DOES NOT REPEAT ITSELF. Given the day's
// options (the readings, the sky events that happen today, the evergreen
// methodology stock), the approved post types, and what the channel recently
// posted, choosePlan() picks one option, one type, one hook style and one
// caption structure, and says why. Every rule is a number in DEFAULT_ROTATION
// that the environment can override (ORBIT_X_CHANNEL_ROTATION, JSON), and
// docs/orbit-x.md prints the defaults.
//
// The rules, in the order they apply:
//
//   1. Weekly cap per format (rolling 7 days). A daily reading every day is
//      the repetitive streak the founder asked to break; the cap makes room.
//   2. Evergreen topic window: one methodology topic is not repeated inside
//      `evergreenTopicDays`.
//   3. Family no-repeat: the last `familyNoRepeat` posts' visual families are
//      unavailable, so the same look never runs twice in a row.
//   4. Type no-repeat: the last `typeNoRepeat` post types are unavailable.
//   5. Score = format weight x urgency (an event on its day, a period on its
//      first day) x freshness (days since the format last ran).
//   6. Hook style and caption structure rotate inside what the type allows,
//      skipping the most recent `hookNoRepeat` / `captionNoRepeat`.
//   7. After generation, nearDuplicate() compares the copy to recent posts and
//      the job regenerates once, then skips the day, rather than post a rerun.
//
// DETERMINISTIC. Ties break on a hash of the slot date, never Math.random, so
// a dry run and its tests see the same choice for the same inputs. Nothing
// here reads a clock, a network, or engagement numbers.

import { READING_TEMPLATE_DEFAULTS } from "./templates.js";
import { CHANNEL_FORMATS } from "./post-types.js";

export const DEFAULT_ROTATION = Object.freeze({
  weights: Object.freeze({
    something_changed: 1.0,
    daily_reading: 1.0,
    weekly_reading: 1.2,
    monthly_reading: 1.2,
    calculated_not_invented: 0.8,
    without_the_fog: 0.8,
    your_sky: 0.6,
  }),
  weeklyCaps: Object.freeze({
    something_changed: 4,
    daily_reading: 3,
    weekly_reading: 1,
    monthly_reading: 1,
    calculated_not_invented: 2,
    without_the_fog: 2,
    your_sky: 1,
  }),
  urgency: Object.freeze({ event_today: 3, period_start: 2, standing: 1 }),
  familyNoRepeat: 1,
  typeNoRepeat: 2,
  hookNoRepeat: 2,
  captionNoRepeat: 1,
  evergreenTopicDays: 45,
  founderDefaultBonus: 1.1,
  nearDuplicateThreshold: 0.6,
  nearDuplicateLookback: 30,
});

const finite = (n, lo, hi) => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;

/**
 * Merge an override (parsed JSON) over the defaults. Unknown keys and
 * out-of-range values are dropped and reported, never guessed at.
 *
 * @returns {{ rotation: object, ignored: string[] }}
 */
export function resolveRotation(override = null) {
  const ignored = [];
  const out = {
    ...DEFAULT_ROTATION,
    weights: { ...DEFAULT_ROTATION.weights },
    weeklyCaps: { ...DEFAULT_ROTATION.weeklyCaps },
    urgency: { ...DEFAULT_ROTATION.urgency },
  };
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    if (override != null) ignored.push("rotation override is not an object");
    return { rotation: Object.freeze(out), ignored };
  }
  for (const [key, value] of Object.entries(override)) {
    if (key === "weights" || key === "weeklyCaps") {
      if (!value || typeof value !== "object") { ignored.push(key); continue; }
      for (const [format, n] of Object.entries(value)) {
        const ok = CHANNEL_FORMATS.includes(format)
          && (key === "weights" ? finite(n, 0, 10) : Number.isInteger(n) && n >= 0 && n <= 7);
        if (ok) out[key][format] = n; else ignored.push(`${key}.${format}`);
      }
    } else if (key === "urgency") {
      for (const [k, n] of Object.entries(value || {})) {
        if (k in out.urgency && finite(n, 0, 10)) out.urgency[k] = n; else ignored.push(`urgency.${k}`);
      }
    } else if (["familyNoRepeat", "typeNoRepeat", "hookNoRepeat", "captionNoRepeat"].includes(key)) {
      if (Number.isInteger(value) && value >= 0 && value <= 4) out[key] = value; else ignored.push(key);
    } else if (key === "evergreenTopicDays" || key === "nearDuplicateLookback") {
      if (Number.isInteger(value) && value >= 0 && value <= 365) out[key] = value; else ignored.push(key);
    } else if (key === "founderDefaultBonus") {
      if (finite(value, 1, 3)) out[key] = value; else ignored.push(key);
    } else if (key === "nearDuplicateThreshold") {
      if (finite(value, 0.2, 1)) out[key] = value; else ignored.push(key);
    } else {
      ignored.push(key);
    }
  }
  out.weights = Object.freeze(out.weights);
  out.weeklyCaps = Object.freeze(out.weeklyCaps);
  out.urgency = Object.freeze(out.urgency);
  return { rotation: Object.freeze(out), ignored };
}

/** Deterministic index into a list from a seed string. */
export function seeded(list, seed) {
  if (!list.length) return undefined;
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return list[h % list.length];
}

function daysBetween(a, b) {
  const x = Date.parse(String(a).slice(0, 10));
  const y = Date.parse(String(b).slice(0, 10));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Infinity;
  return Math.round((y - x) / 86_400_000);
}

/**
 * History entries (most recent first) look like:
 *   { slot_date, format, family, post_type_label, hook_style, caption_structure,
 *     topic_key, headline, hook, caption }
 * Only runs that actually produced a post belong in history.
 */
function lastN(history, n, field) {
  return history.slice(0, n).map((h) => h[field]).filter(Boolean);
}

/**
 * Pick today's post.
 *
 * @param {object} input
 * @param {Array}  input.options  [{ candidate, formatId, autonomy, kind, topicKey?, urgency }]
 * @param {Array}  input.types    usable approved types: [{ id, label, spec }]
 * @param {Array}  input.history  recent channel posts, most recent first
 * @param {string} input.slotDate YYYY-MM-DD
 * @param {object} [input.rotation]
 * @returns {{ plan: object|null, considered: Array<{ key:string, format:string, outcome:string, reason:string, score?:number }> }}
 */
export function choosePlan({ options = [], types = [], history = [], slotDate, rotation = DEFAULT_ROTATION }) {
  const considered = [];
  const recentWeek = history.filter((h) => daysBetween(h.slot_date, slotDate) >= 0 && daysBetween(h.slot_date, slotDate) < 7);
  const blockedFamilies = new Set(lastN(history, rotation.familyNoRepeat, "family"));
  const blockedTypes = new Set(lastN(history, rotation.typeNoRepeat, "post_type_label"));
  const scored = [];

  for (const option of options) {
    const key = option.candidate?.eventKey || "?";
    const format = option.formatId;
    const used = recentWeek.filter((h) => h.format === format).length;
    const cap = rotation.weeklyCaps[format] ?? 0;
    if (used >= cap) {
      considered.push({ key, format, outcome: "skip", reason: `weekly cap reached (${used}/${cap} in 7 days)` });
      continue;
    }
    if (option.kind === "evergreen" && option.topicKey) {
      const last = history.find((h) => h.topic_key === option.topicKey);
      if (last && daysBetween(last.slot_date, slotDate) < rotation.evergreenTopicDays) {
        considered.push({ key, format, outcome: "skip",
          reason: `topic ran ${daysBetween(last.slot_date, slotDate)} days ago (window ${rotation.evergreenTopicDays})` });
        continue;
      }
    }
    const fitting = types.filter((t) => t.spec.formats.includes(format));
    if (!fitting.length) {
      considered.push({ key, format, outcome: "skip", reason: "no approved post type carries this format" });
      continue;
    }
    const open = fitting.filter((t) => !blockedFamilies.has(t.spec.family) && !blockedTypes.has(t.label));
    if (!open.length) {
      considered.push({ key, format, outcome: "skip",
        reason: `every approved type for this format repeats a recent family (${[...blockedFamilies].join(", ") || "none"}) or type` });
      continue;
    }

    // The type: the family rested longest wins; the founder's default family
    // for this format gets a small, configurable nudge, never a lock.
    const typeScore = (t) => {
      const lastUse = history.findIndex((h) => h.family === t.spec.family);
      const rest = lastUse < 0 ? history.length + 5 : lastUse;
      const founder = READING_TEMPLATE_DEFAULTS[format] === t.spec.family
        || (format === "something_changed" && READING_TEMPLATE_DEFAULTS.special_reading === t.spec.family);
      return rest * (founder ? rotation.founderDefaultBonus : 1);
    };
    const best = Math.max(...open.map(typeScore));
    const type = seeded(open.filter((t) => typeScore(t) === best)
      .sort((a, b) => a.label.localeCompare(b.label)), `${slotDate}:${format}:type`);

    const lastFormat = history.findIndex((h) => h.format === format);
    const freshness = lastFormat < 0 ? 2 : Math.min(2, 1 + daysBetween(history[lastFormat].slot_date, slotDate) / 7);
    const urgency = rotation.urgency[option.urgency] ?? rotation.urgency.standing;
    const score = Number(((rotation.weights[format] ?? 0) * urgency * freshness).toFixed(4));
    if (score <= 0) {
      considered.push({ key, format, outcome: "skip", reason: "format weight is zero" });
      continue;
    }
    scored.push({ option, type, score });
    considered.push({ key, format, outcome: "eligible", reason: `score ${score} via ${type.label}`, score });
  }

  if (!scored.length) return { plan: null, considered };
  const top = Math.max(...scored.map((s) => s.score));
  const winner = seeded(scored.filter((s) => s.score === top)
    .sort((a, b) => a.option.candidate.eventKey.localeCompare(b.option.candidate.eventKey)), `${slotDate}:option`);

  const pickVoice = (allowed, field, noRepeat, salt) => {
    const recent = new Set(lastN(history, noRepeat, field));
    const fresh = allowed.filter((v) => !recent.has(v));
    const pool = fresh.length ? fresh : allowed;
    return seeded([...pool].sort(), `${slotDate}:${salt}`);
  };
  const hookStyle = pickVoice(winner.type.spec.voice.hookStyles, "hook_style", rotation.hookNoRepeat, "hook");
  const captionStructure = pickVoice(winner.type.spec.voice.captionStructures, "caption_structure",
    rotation.captionNoRepeat, "caption");

  const chosen = considered.find((c) => c.key === winner.option.candidate.eventKey && c.format === winner.option.formatId);
  if (chosen) chosen.outcome = "chosen";

  return {
    plan: Object.freeze({
      formatId: winner.option.formatId,
      candidate: winner.option.candidate,
      autonomy: winner.option.autonomy,
      kind: winner.option.kind,
      topicKey: winner.option.topicKey || null,
      periodKey: winner.option.periodKey || null,
      type: winner.type,
      family: winner.type.spec.family,
      hookStyle,
      captionStructure,
      score: winner.score,
    }),
    considered,
  };
}

/* ── Near-duplicate detection ─────────────────────────────────────────────── */

const STOP = new Set(["the", "a", "an", "and", "or", "of", "in", "on", "at", "to", "is", "it", "this", "that",
  "for", "with", "as", "by", "from", "its", "be", "are", "was", "what", "how", "your", "you", "orbit", "axis"]);

export function contentWords(text) {
  return new Set((String(text || "").toLowerCase().match(/[a-z][a-z']+/g) || [])
    .filter((w) => w.length > 2 && !STOP.has(w)));
}

export function jaccard(a, b) {
  const A = a instanceof Set ? a : contentWords(a);
  const B = b instanceof Set ? b : contentWords(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  return shared / (A.size + B.size - shared);
}

/** The opening a reader sees: the headline plus slide one's hook line. */
export function openingOf(post) {
  const hero = (post?.slides || []).find((s) => ["hero", "cover"].includes(s?.role)) || post?.slides?.[0];
  return `${post?.headline || ""} ${hero?.body || ""}`.trim();
}

/**
 * Does this copy read like something the channel recently posted?
 *
 * @param {object} post
 * @param {Array}  recent  [{ headline, hook, caption, slot_date }]
 * @returns {{ duplicate: boolean, closest: number, against: string|null, field: string|null }}
 */
export function nearDuplicate(post, recent = [], { threshold = DEFAULT_ROTATION.nearDuplicateThreshold } = {}) {
  const opening = contentWords(openingOf(post));
  const caption = contentWords(post?.caption);
  let closest = 0;
  let against = null;
  let field = null;
  for (const r of recent) {
    const o = jaccard(opening, contentWords(`${r.headline || ""} ${r.hook || ""}`));
    const c = jaccard(caption, contentWords(r.caption));
    if (o > closest) { closest = o; against = r.slot_date || null; field = "opening"; }
    if (c > closest) { closest = c; against = r.slot_date || null; field = "caption"; }
  }
  return { duplicate: closest >= threshold, closest: Number(closest.toFixed(3)), against, field };
}
