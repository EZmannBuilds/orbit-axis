// Orbit Axis :: what a transit means, composed rather than written out.
//
// Same architecture as the Dev Update 1.5 natal corpus, and for the same
// reason: ten transiting bodies across ten natal targets across five aspects
// is five hundred paragraphs, which no one keeps consistent. Authored per
// layer, composed at read time.
//
// The natal roles are IMPORTED, not restated. Mercury means the same thing in
// My Chart and here, or the product contradicts itself. That applies to BOTH
// registers: `function_` is the label and `plain` is the same role with the
// terminology removed, and both live in the shared corpus for that reason.

import { PLANETS } from "../interpretation/planets.js";

/**
 * What is happening to you while it passes — the plain register.
 *
 * This is the layer that carries the reading. It names no planet and uses no
 * terminology, and it is written to take a natal `plain` phrase as its object:
 *
 *   "Your thoughts and conversations keep returning to"
 *   + "what you want, who you are drawn to, and what feels worth it."
 *
 * The sentence it replaced was "Transiting Mercury is putting words, plans,
 * and second thoughts around your natal Venus — values, attraction, and
 * taste." That is accurate and it is four pieces of vocabulary deep before it
 * says anything about the reader. The technical version is not lost: it is
 * still the card's title, and every body, aspect and orb behind the sentence
 * is listed under the card.
 */
export const TRANSIT_STIR = Object.freeze({
  Sun: "Attention and energy are landing on",
  Moon: "Your mood is moving through",
  Mercury: "Your thoughts and conversations keep returning to",
  Venus: "Warmth and ease are settling over",
  Mars: "You are likely to feel pushed to act on",
  Jupiter: "You want more room in",
  Saturn: "You are being asked to get serious about",
  Uranus: "Something keeps unsettling",
  Neptune: "Things are going a little hazy around",
  Pluto: "Something slow and deep is reworking",
});

/**
 * What a transiting body is doing while it passes — the technical register.
 *
 * Distinct from the natal `function_`: natal Mars is what drive looks like in
 * someone, transiting Mars is what it is currently pushing on. Kept because
 * the vocabulary is real and someone learning the subject should be able to
 * find it; it is no longer what the card leads with.
 */
export const TRANSIT_ACTION = Object.freeze({
  Sun: "bringing attention and visibility to",
  Moon: "passing quickly across",
  Mercury: "putting words, plans, and second thoughts around",
  Venus: "softening and drawing attention to",
  Mars: "pressing energy and urgency into",
  Jupiter: "widening the space around",
  Saturn: "asking for structure and patience from",
  Uranus: "unsettling and loosening",
  Neptune: "blurring the edges of",
  Pluto: "working slowly and deeply on",
});

/**
 * The dynamic itself. BOTH readings are authored for every aspect — the same
 * structural guard the natal corpus uses against "trines good, squares bad".
 */
export const ASPECT_DYNAMIC = Object.freeze({
  Conjunction: {
    plain: "These two are sitting in the same place right now, so it is hard to tell where one ends and the other starts.",
    verb: "meets",
    detail: "The two are occupying the same degree, so their themes are hard to separate for now.",
    constructive: "Concentrated attention. Whatever this pair governs is unusually easy to focus on.",
    tension: "Little distance to think from. What is amplified can be harder to see clearly.",
  },
  Opposition: {
    plain: "You are likely to see both sides of this at once, and to feel pulled between them.",
    verb: "faces",
    detail: "They sit across the chart from each other, which tends to show a theme through contrast.",
    constructive: "Contrast makes things legible. Two sides of a question become visible at once.",
    tension: "It can feel like being pulled between two valid demands rather than choosing freely.",
  },
  Square: {
    plain: "This one usually shows up as friction — something small has to give before it settles.",
    verb: "presses on",
    detail: "A ninety-degree angle, which usually registers as friction that asks for an adjustment.",
    constructive: "Friction is what makes a change actually happen rather than stay theoretical.",
    tension: "Pressure without an obvious release. Forcing it tends to cost more than pacing it.",
  },
  Trine: {
    plain: "This one is easy. Whatever help is here does not have to be fought for.",
    verb: "flows with",
    detail: "An easy angle — the two tend to cooperate without much effort being required.",
    constructive: "Support that is genuinely available, and easy to use if you reach for it.",
    tension: "Ease is easy to sleep through. Nothing here insists on being noticed.",
  },
  Sextile: {
    plain: "There is an opening here, and it tends to wait until you take it.",
    verb: "opens toward",
    detail: "A cooperative angle that tends to offer an opening rather than an event.",
    constructive: "A usable opportunity, usually one that responds to being acted on.",
    tension: "It asks for a first move. Left alone it often passes without much happening.",
  },
});

/** How close is close. Deterministic bands, stated as fact. */
export function intensity(orb) {
  if (!Number.isFinite(orb)) return null;
  if (orb <= 0.5) return { label: "Exact", detail: "This is as close as it gets." };
  if (orb <= 1.5) return { label: "Close", detail: "Tight enough to be one of the clearer influences right now." };
  return { label: "Wide", detail: "Within range, but not among the tightest contacts today." };
}

/**
 * The retrograde modifier — for the TRANSITING body only.
 *
 * A planet retrograde in the sky today says nothing about whether it was
 * retrograde at someone's birth, and conflating the two is a common way to be
 * confidently wrong. Natal retrograde belongs to My Chart.
 */
export const RETROGRADE_MODIFIER =
  "The moving planet is going backwards from where we watch it, which usually "
  + "means a second pass over ground you have already covered — reviewing, "
  + "repeating, or changing your mind about something, rather than meeting it "
  + "for the first time.";

export const NEVER_RETROGRADE = Object.freeze(["Sun", "Moon"]);

/**
 * One transit's reading, composed from the layers above.
 *
 * Returns null rather than filler when a body is unknown, so a malformed entry
 * becomes a missing card instead of a sentence about nothing.
 */
export function composeTransit(t) {
  if (!t) return null;
  const action = TRANSIT_ACTION[t.transiting];
  const stir = TRANSIT_STIR[t.transiting];
  const dynamic = ASPECT_DYNAMIC[t.aspect];
  const target = PLANETS[t.natal];
  if (!action || !stir || !dynamic || !target || !target.plain) return null;

  const title = `${t.transiting} ${dynamic.verb} your ${t.natal}`;
  // The reading, in the register a beginner can use. No planet, no aspect, no
  // "natal", no "transiting" — just the sentence about them.
  const lead = `${stir} ${target.plain}.`;
  // The same statement in the vocabulary, kept for anyone learning the subject
  // and shown under the card rather than in front of it.
  const technical = `Transiting ${t.transiting} is ${action} your natal ${t.natal}`
                  + ` — ${target.function_.toLowerCase()}.`;
  const band = intensity(t.orb);
  const detail = [dynamic.plain];
  if (band) detail.push(band.detail);
  if (t.retrograde && !NEVER_RETROGRADE.includes(t.transiting)) detail.push(RETROGRADE_MODIFIER);
  if (t.duration) detail.push(`${t.duration}.`);

  return Object.freeze({
    id: t.id,
    title,
    lead,
    technical,
    detail,
    constructive: dynamic.constructive,
    tension: dynamic.tension,
    intensity: band ? band.label : null,
    targetRole: target.function_,
    source_version: CONTENT_VERSION,
  });
}

// 2.0.0: the reading leads in plain English. The technical sentence is still
// composed and still returned, under `technical`.
export const CONTENT_VERSION = "transit-2.0.0";

export function composeAll(list) {
  return (list || []).map((t) => {
    const reading = composeTransit(t);
    return reading ? Object.freeze({ ...t, reading }) : null;
  }).filter(Boolean);
}
