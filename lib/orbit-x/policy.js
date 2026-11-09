// Orbit X :: the autonomy policy and per-post checks (Dev Update 6.1).
//
// WHAT MAY POST WITHOUT A HUMAN, AND WHAT EVERY POST MUST PASS FIRST.
//
//   Green   fact-heavy formats (something_changed, calculated_not_invented).
//           Queued for review by default; auto-publish only in "auto" mode
//           (ORBIT_X_AUTOPUBLISH_LIVE=true).
//   Yellow  interpretive formats (the readings, without_the_fog, your_sky).
//           Prepared and queued, never auto-published: every Yellow post needs
//           a person to look at its slides and approve it, post by post, and
//           it passes the stricter Yellow checks below first.
//   Red     natal or synastry interpretation, medical, financial or legal
//           territory, deterministic prediction, emotionally sensitive
//           personal guidance. Never autonomous. There is no Red format, and
//           Red CONTENT is refused here in every post whatever its format or
//           its approved post type.
//
// Approving a post type approves a design. It never approves content: every
// check below runs on every post, every time.
//
// THESE ARE TRIPWIRES, NOT A MODERATOR. They are deliberately broader than the
// desk's audit (a human is no longer reading each post), so they will
// sometimes refuse copy a human would have passed. A refused post means the
// channel skips that day and says why in the audit log. That is the intended
// failure direction: a quiet day costs nothing; a bad post costs trust.

import { FORMATS, APPROVED_CTAS, EDITORIAL_CTAS } from "./formats.js";
import { auditCopy, verifyFactIntegrity, adviseCopy } from "./editorial.js";
import { draftCompleteness } from "./schemas.js";

export const AUTONOMY_LEVELS = Object.freeze(["green", "yellow", "red"]);

export function autonomyFor(formatId) {
  const risk = FORMATS[formatId]?.autonomyRisk;
  return AUTONOMY_LEVELS.includes(risk) ? risk : "red";
}

/**
 * May the channel PREPARE a post at this level at all? Green and Yellow are
 * prepared; Red never is.
 * @returns {{ allowed: boolean, reason: string }}
 */
export function autonomyAllowed(level) {
  if (level === "green") return { allowed: true, reason: "green: fact-heavy" };
  if (level === "yellow") return { allowed: true, reason: "yellow: interpretive; always waits for a person" };
  return { allowed: false, reason: "red: never autonomous" };
}

/**
 * Must a person approve this post before it can publish? (2026-11-09.)
 *
 * In the default "review" mode, every post. In "auto" mode
 * (ORBIT_X_AUTOPUBLISH_LIVE=true), Green posts may approve themselves; Yellow
 * posts never do, whatever their template's approval, because the founder
 * sees every interpretive graphic before it goes out.
 */
export function reviewRequired({ mode, autonomy }) {
  if (autonomy !== "green") return true;
  return mode !== "auto";
}

/* ── Text collection ──────────────────────────────────────────────────────── */

/** Every human-readable string in a post, with where it came from. Design
 *  and reading metadata are structure, not copy. */
export function postTexts(post) {
  const out = [];
  const push = (path, text) => { if (typeof text === "string" && text.trim()) out.push({ path, text }); };
  push("headline", post?.headline);
  push("subhead", post?.subhead);
  (post?.slides || []).forEach((s, i) => { push(`slides[${i}].heading`, s?.heading); push(`slides[${i}].body`, s?.body); });
  push("caption", post?.caption);
  push("cta", post?.cta);
  push("altText", post?.altText);
  return out;
}

/* ── Red territory: refused in every autonomous post ──────────────────────── */

export const RED_RULES = Object.freeze([
  { id: "red_medical", why: "medical or health territory",
    pattern: /\b(?:health|illness|disease|diagnos\w*|symptoms?|medic(?:al|ine|ation)\w*|therap(?:y|ist)\w*|anxiety|depress(?:ion|ed)|cures?|healing|heals?|surgery|pregnan\w*|fertility|mental health)\b/i },
  { id: "red_financial", why: "financial territory",
    pattern: /\b(?:money|financ\w*|invest\w*|stocks?|crypto\w*|salary|debts?|wealth|income|lottery|windfall|savings)\b/i },
  { id: "red_legal", why: "legal territory",
    pattern: /\b(?:legal|lawsuits?|lawyers?|attorneys?|court|sue|contracts?|custody|verdict)\b/i },
  { id: "red_personal_chart", why: "individual natal or synastry interpretation",
    pattern: /\b(?:your (?:natal|birth) chart (?:says|shows|means|reveals)|natal (?:reading|interpretation)|synastry|compatib\w*|soul ?mates?|twin flames?|your (?:partner|ex|crush|spouse))\b/i },
  { id: "red_sensitive", why: "emotionally sensitive personal guidance",
    pattern: /\b(?:grie(?:f|ving|ve)|breakups?|break up|divorce|self-harm|suicid\w*|trauma\w*|abus(?:e|ive)\w*|addict\w*)\b/i },
]);

/* ── The voice lint: symbolic, never predictive ───────────────────────────── */

// Negated forms ("not a prediction", "rather than a forecast") are the brand
// saying what it is not; they are removed before the lint reads the text.
const NEGATED = /\b(?:not|never|no|rather than|instead of|isn'?t|aren'?t|nor)\s+(?:a\s+|an\s+|the\s+)?(?:predictions?|forecasts?|predictive|prophecy)\b/gi;

export const VOICE_RULES = Object.freeze([
  { id: "voice_certainty", why: "states a future outcome as certain",
    // Any subject: "this Moon will bring", "Venus will reveal", "the week
    // will change". The verbs are the predictive ones; "will be" is not here.
    pattern: /\b(?:you(?:'ll| will| are going to| shall)|will (?:bring|cause|make|give|lead|change|transform|reveal|force|end|start|happen|open|unlock|shift)|is (?:going|bound) to|destined|fated|guarantee\w*|inevitabl\w*|certainly will)\b/i },
  { id: "voice_prediction", why: "frames astrology as prediction",
    pattern: /\b(?:predict(?:s|ed|ing|ion)?|forecast(?:s|ed|ing)?|prophec\w*|omens?|fortune-?tell\w*)\b/i },
  { id: "voice_fear", why: "fear, warning or luck framing",
    pattern: /\b(?:beware|warning|danger\w*|doom\w*|disaster\w*|lucky|unlucky|cursed|brace)\b/i },
  { id: "voice_agency", why: "gives the sky or the universe intentions",
    pattern: /\b(?:the universe (?:wants|is telling|has a|will)|the stars (?:want|say|are telling|have decided)|the planets (?:want|demand))\b/i },
  { id: "voice_relative_time", why: "relative timing whose truth depends on the publish instant",
    pattern: /\b(?:tonight|tomorrow|yesterday|this weekend|next (?:week|month|year)|later today|right now)\b/i },
]);

/** "This week" is true in a weekly reading, which the channel only ever
 *  publishes inside its own week; the same for "this month". Anywhere else
 *  the phrase depends on when the post is read, and is refused. */
function periodPhraseProblems(post) {
  const type = post?.reading?.type || null;
  const problems = [];
  for (const { path, text } of postTexts(post)) {
    if (/\bthis week\b/i.test(text) && type !== "weekly") problems.push(`${path}: "this week" outside a weekly reading`);
    if (/\bthis month\b/i.test(text) && type !== "monthly") problems.push(`${path}: "this month" outside a monthly reading`);
  }
  return problems;
}

// What the Yellow check requires: the interpretive register is ATTRIBUTED.
const FRAMING = /\b(?:may symboli[sz]e|can symboli[sz]e|symbolically|symbolism|astrolog(?:ers|ical tradition|y) (?:associates?|links?|reads?|connects?)|astrologers (?:often |traditionally )?(?:associate|read|link|connect)|traditionally (?:associated|connected|linked|read)|in astrology|within astrology|can represent|one way (?:to|astrologers)|invites? reflection|can invite|notice whether|the traditional theme|is associated with|is traditionally)\b/i;

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december"];
const MONTH_SHORT = MONTHS.map((m) => m.slice(0, 3));

/**
 * Human dates in copy ("November 13", "Nov 13") must name a day that appears
 * in the facts. verifyFactIntegrity() already does this for ISO dates; this is
 * the same promise for the way people actually write dates.
 */
export function verifyHumanDates(post, facts) {
  const factDays = new Set((JSON.stringify(facts || {}).match(/\b\d{4}-\d{2}-\d{2}\b/g) || [])
    .map((iso) => `${Number(iso.slice(5, 7))}-${Number(iso.slice(8, 10))}`));
  // A reading's period covers every day in it, so dates inside the period
  // are facts too.
  const period = facts?.period;
  if (period?.start_date && period?.end_date) {
    for (let t = Date.parse(period.start_date); t <= Date.parse(period.end_date); t += 86_400_000) {
      const d = new Date(t);
      factDays.add(`${d.getUTCMonth() + 1}-${d.getUTCDate()}`);
    }
  }
  const findings = [];
  const re = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi;
  for (const { path, text } of postTexts(post)) {
    if (path === "altText") continue; // alt text repeats the graphic's own date
    for (const m of text.matchAll(re)) {
      const word = m[1].toLowerCase().slice(0, 3);
      const month = MONTH_SHORT.indexOf(word === "sep" ? "sep" : word) + 1;
      const day = Number(m[2]);
      if (month && day && !factDays.has(`${month}-${day}`)) {
        // "May" is also a verb; only a following number makes it a date, and
        // the regex already requires one.
        findings.push({ path, rule: "invented_date", why: `${m[0]} is not a date in the supplied facts` });
      }
    }
  }
  return findings;
}

/* ── The checks ───────────────────────────────────────────────────────────── */

const INSTAGRAM_CAPTION_MAX = 2200;
const INSTAGRAM_CAROUSEL_MAX = 10;
const ALT_TEXT_MIN = 40;
const ALT_TEXT_MAX = 1000;
const HASHTAG_MAX = 5;

function check(id, passed, detail = null, { blocking = true } = {}) {
  return { id, passed: Boolean(passed), blocking, detail };
}

/**
 * Run every per-post check.
 *
 * @param {object} post       validated post
 * @param {object} context    { candidate, autonomy, renderWarnings, layout, duplicate }
 * @returns {{ passed: boolean, checks: Array<{id, passed, blocking, detail}> }}
 */
export function runPostChecks(post, { candidate, autonomy, renderWarnings = [], layout = [], duplicate = null } = {}) {
  const checks = [];
  const texts = postTexts(post);
  const facts = candidate?.facts || {};
  const format = FORMATS[post?.format];

  checks.push(check("autonomy_level", ["green", "yellow"].includes(autonomy), autonomy));
  checks.push(check("format_matches_level", format && format.autonomyRisk === autonomy,
    `${post?.format} is ${format?.autonomyRisk}`));

  const completeness = draftCompleteness(post);
  checks.push(check("complete", completeness.complete, completeness.missing.join(", ") || null));

  const audit = auditCopy(post);
  checks.push(check("editorial_audit", !audit.length, audit.map((f) => `${f.path}: ${f.why}`).join("; ") || null));

  const integrity = [...verifyFactIntegrity(post, facts), ...verifyHumanDates(post, facts)];
  checks.push(check("fact_integrity", !integrity.length, integrity.map((f) => `${f.path}: ${f.why}`).join("; ") || null));

  // House style (2026-11-09): no em dashes in post copy. Caught here so the
  // channel's drafts, a reviewer's edits, and the model's output are all held
  // to it; the writer is told in the channel brief.
  const dashes = texts.filter(({ text }) => text.includes("\u2014")).map((t) => t.path);
  checks.push(check("no_em_dash", !dashes.length, dashes.join(", ") || null));

  const red = [];
  for (const { path, text } of texts) {
    for (const rule of RED_RULES) if (rule.pattern.test(text)) red.push(`${path}: ${rule.why}`);
  }
  checks.push(check("red_territory", !red.length, red.join("; ") || null));

  const voice = [];
  for (const { path, text } of texts) {
    const cleaned = text.replace(NEGATED, " ");
    for (const rule of VOICE_RULES) if (rule.pattern.test(cleaned)) voice.push(`${path}: ${rule.why}`);
  }
  voice.push(...periodPhraseProblems(post));
  checks.push(check("voice_symbolic_not_predictive", !voice.length, voice.join("; ") || null));

  const alt = String(post?.altText || "").trim();
  const altProblems = [];
  if (alt.length < ALT_TEXT_MIN) altProblems.push(`shorter than ${ALT_TEXT_MIN} characters`);
  if (alt.length > ALT_TEXT_MAX) altProblems.push(`longer than ${ALT_TEXT_MAX} characters`);
  if (/#|https?:\/\/|www\./i.test(alt)) altProblems.push("contains a hashtag or link");
  if (alt && alt === String(post?.caption || "").trim()) altProblems.push("is the caption, not a description");
  checks.push(check("alt_text", !altProblems.length, altProblems.join("; ") || null));

  const lengthProblems = [];
  const caption = String(post?.caption || "");
  if (caption.length > INSTAGRAM_CAPTION_MAX) lengthProblems.push(`caption over Instagram's ${INSTAGRAM_CAPTION_MAX}`);
  if (format && caption.length > format.limits.caption) lengthProblems.push(`caption over the format's ${format.limits.caption}`);
  if ((caption.match(/#[\p{L}\p{N}_]+/gu) || []).length > HASHTAG_MAX) lengthProblems.push(`more than ${HASHTAG_MAX} hashtags`);
  if ((post?.slides || []).length > INSTAGRAM_CAROUSEL_MAX) lengthProblems.push(`more than ${INSTAGRAM_CAROUSEL_MAX} slides`);
  if ((post?.slides || []).length < 2) lengthProblems.push("a carousel needs at least 2 slides");
  checks.push(check("lengths", !lengthProblems.length, lengthProblems.join("; ") || null));

  checks.push(check("cta_allowed", [...APPROVED_CTAS, ...EDITORIAL_CTAS].includes(String(post?.cta || "")),
    post?.cta || "(none)"));

  checks.push(check("render_fits", !renderWarnings.length, renderWarnings.join("; ") || null));
  checks.push(check("layout_clear", !layout.length, layout.slice(0, 6).join("; ") || null));

  if (duplicate) {
    checks.push(check("not_near_duplicate", !duplicate.duplicate,
      duplicate.duplicate ? `${duplicate.field} is ${duplicate.closest} similar to the post of ${duplicate.against}` : `closest ${duplicate.closest}`));
  }

  // Yellow: the interpretive register must be visibly attributed, and the
  // stricter second-person rule applies.
  if (autonomy === "yellow") {
    const interpretive = (post?.slides || []).filter((s) => !["cover", "hero", "evidence", "key_dates", "cta"].includes(s?.role));
    const attributed = FRAMING.test(interpretive.map((s) => s.body).join(" ")) || FRAMING.test(caption);
    checks.push(check("yellow_attributed_framing", attributed,
      attributed ? null : "no attributed symbolic framing (\"astrologers associate\", \"may symbolize\", ...)"));
    const secondPerson = texts.filter(({ text }) => /\byour (?:day|week|month|year|life|future|luck)\b|\byou (?:need|must|should)\b/i.test(text));
    checks.push(check("yellow_no_personal_directives", !secondPerson.length,
      secondPerson.map((t) => t.path).join(", ") || null));
  }

  // Advisories ride along for the log. They never block.
  for (const a of adviseCopy(post)) {
    if (a.rule === "relative_time") continue; // already a blocking voice rule above
    checks.push(check(`advisory_${a.rule}`, false, `${a.path}: ${a.why}`, { blocking: false }));
  }

  const passed = checks.every((c) => c.passed || !c.blocking);
  return { passed, checks };
}

/** The extra brief the writer gets for an autonomous post. Instruction, never copy. */
export function channelBrief({ autonomy, hookStyleText, captionStructureText, recentOpenings = [] }) {
  return {
    publication: "This post is checked automatically and may be published with little or no further editing. Write as carefully as if no person will read it before it goes out.",
    hookStyle: hookStyleText,
    captionStructure: captionStructureText,
    autonomy,
    neverMention: "Health, illness, healing, money, investing, legal matters, contracts, a specific person's birth chart, compatibility, relationships of specific people, grief, breakups, or any other personal guidance. If the facts seem to invite one of these, choose a different angle.",
    timing: "Use absolute dates, exactly as they appear in the facts. Never write tonight, tomorrow, yesterday, next week, next month, or right now. \"This week\" is allowed only in a weekly reading and \"this month\" only in a monthly one.",
    voice: "Symbolic, never predictive. Attribute every interpretation to astrological tradition (\"astrologers associate\", \"may symbolize\", \"traditionally linked with\"). Never say what will happen or what the reader will feel.",
    hashtags: `At most ${HASHTAG_MAX} hashtags, or none.`,
    punctuation: "Do not use em dashes. Use a comma, a colon, a full stop or parentheses instead.",
    altText: `altText describes what the slides visibly show (shapes, glyphs, dates, text), in ${ALT_TEXT_MIN}–${ALT_TEXT_MAX} characters, with no hashtags or links.`,
    avoidRepeating: recentOpenings.slice(0, 10),
  };
}
