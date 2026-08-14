// Orbit Axis :: deterministic Daily Fortune engine.
//
// Pure and deterministic. The same active chart on the same local date always
// produces the same fortune. Selection is seeded from a SHA-256 of
// (localDate, chartId, chartInputHash, skySnapshotHash, version) — never a
// nondeterministic random source.
// No network, no LLM: all astrology comes from the local Swiss Ephemeris
// engine (natal.js / current-sky.js). Ollama may later smooth wording, but the
// deterministic output here is the source of truth.

import { createHash } from "node:crypto";
import { elementOf, modalityOf } from "../astro/natal.js";

// Bumped to v2 when the phrase banks were expanded. The seed contract is
// "same inputs + same engine version → same words", so changing the banks
// without changing the version would make that contract a lie: two people
// loading the same day could get different text depending on whether a row was
// already cached. Old rows keep their v1 wording, so nobody's history rewrites
// itself — which is also why fortuneHistoryByDate() exists in service.js.
export const FORTUNE_ENGINE_VERSION = "fortune-v2";

const ELEMENTS = { Fire: "fire", Earth: "earth", Air: "air", Water: "water" };

// ── seeded, deterministic selection ──────────────────────────────────────────
export function fortuneSeed({ localDate, chartId, chartInputHash, skySnapshotHash }) {
  return createHash("sha256")
    .update([localDate, chartId || "local", chartInputHash || "", skySnapshotHash || "", FORTUNE_ENGINE_VERSION].join("|"))
    .digest("hex");
}
function streamInt(seed, label, mod) {
  const h = createHash("sha256").update(`${seed}:${label}`).digest("hex");
  return parseInt(h.slice(0, 8), 16) % mod;
}
function pick(seed, label, arr) {
  return arr[streamInt(seed, label, arr.length)];
}

// ── local date for a timezone (never the server's tz) ────────────────────────
export function localDateForZone(date, timezoneName) {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezoneName || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
    });
    return fmt.format(date); // en-CA => YYYY-MM-DD
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  }
}

// ── geometry (transiting body vs fixed natal body) ───────────────────────────
//
// Re-exported from the engine, not reimplemented here.
//
// This module used to carry its own copy of the same calculation: the same five
// aspects, the same applying test, and its own hardcoded body list. Two
// implementations of one calculation is the arrangement the extraction existed
// to end — they agree until either is improved, and then they disagree
// silently. That had already begun: the v1 API reads transits from the engine
// while the fortune read them from here, so one app could answer the same
// question two ways depending on which door you knocked on.
//
// The engine's scope now includes the outer planets, Chiron, the nodes, and the
// angles, so a fortune can finally mention a Pluto square to the Ascendant.
//
// Imported as well as re-exported: `export … from` re-publishes the name
// without binding it in this module, and composeFortune() below calls it.
import { personalTransits } from "@ezmannbuilds/orbit-axis-engine";

export { personalTransits };

/* ── curated fragment banks (plain language, beginner-first) ─────────────────
   EXPANDED in fortune-v2. Everything here is authored copy selected by a hash
   of the day and the chart — nothing is generated, and nothing calls a model.

   WHY THIS COSTS NOTHING AT RUNTIME. Selection is pick(seed, label, arr), which
   is one SHA-256 of a short string and one array index. That is O(1) whatever
   the bank's length, so a bank of forty reads exactly as fast as a bank of two.
   The only price of more copy is bytes parsed once at cold start, and these
   banks together are a few kilobytes. There is no per-request cost to grow
   them, which is why growing them is the cheapest quality work available.

   FOUR RULES EVERY LINE HERE OBEYS, all enforced by test/fortune.test.js:

     1. NO TECHNICAL WORDING. Not just planet names — the forbidden list also
        contains ordinary English words used technically in astrology:
        house, degree, aspect, square, orb, opposition, natal, transit.
        "Around the house", "a degree of", "one aspect of your life" and
        "squarely" would all fail the suite, and each is an easy thing to
        write by accident.
     2. NO PROMISES. Conditions and invitations, never outcomes. Luck says
        what is favourable, never what will happen.
     3. NO FEAR. Watch-outs are practical, never ominous.
     4. NO MORAL GRADING. A quiet day is not a worse day than a bright one. */

const MOOD_BY_PHASE = {
  "New Moon": [
    "a quiet, fresh-start feeling — a good day to set one small intention",
    "a clean-slate mood; keep the day gentle and open",
    "a beginning-shaped day — you do not have to know where it leads yet",
    "an unwritten feeling; leave a little room for it to fill",
    "a low, patient hum — starting small counts as starting",
    "a private sort of day, better for deciding than announcing",
  ],
  "Waxing Crescent": [
    "a little momentum building — small steps feel doable",
    "soft forward motion; follow what's slowly gaining energy",
    "the first pull of something taking shape — tend it lightly",
    "an encouraging day for the thing you started and half-forgot",
    "gentle traction; you may notice effort costing slightly less",
    "a day that rewards showing up more than pushing",
  ],
  "First Quarter": [
    "a nudge to act on something you've been turning over",
    "a decision point — a small push moves things along",
    "a day with some resistance in it, and some traction too",
    "the moment where thinking about it stops being enough",
    "a bit of tension that wants a choice rather than more analysis",
    "a day for the smallest version of the brave thing",
  ],
  "Waxing Gibbous": [
    "a tidy-the-loose-ends mood; refining feels good",
    "almost-there energy — polish rather than start",
    "a day for the last ten percent, which is usually the honest part",
    "adjusting feels better than adding today",
    "a near-complete feeling; resist beginning something new",
    "good conditions for editing — yourself included",
  ],
  "Full Moon": [
    "feelings run a little brighter and fuller than usual",
    "things feel vivid today; let emotions have some room",
    "a lit-up sort of day — what you feel, you feel completely",
    "clarity arrives with volume; let it settle before acting on it",
    "an unignorable day, in a way that is mostly useful",
    "everything sits closer to the surface than it did yesterday",
  ],
  "Waning Gibbous": [
    "a reflective, share-what-you've-learned kind of day",
    "a settling mood — good for honest conversations",
    "the after-the-peak quiet, where things make more sense",
    "a day for saying the true thing kindly",
    "an unhurried mood; understanding matters more than doing",
    "good conditions for telling someone what you worked out",
  ],
  "Last Quarter": [
    "a good day to let go of one small thing",
    "release energy; loosen your grip on what's done",
    "a clearing-out feeling — subtraction is progress today",
    "a day that goes better when you stop defending something",
    "the quiet relief of finishing rather than starting",
    "a good time to close a tab, literal or otherwise",
  ],
  "Waning Crescent": [
    "rest and daydreaming are allowed — move slowly",
    "a soft, low-key day; conserve your energy",
    "an unproductive-looking day doing quiet, necessary work",
    "a dimmed, drifting mood — do not schedule the hard thing",
    "permission to be uninteresting for a day",
    "a slow tide; going with it costs less than fighting it",
  ],
};

/* Element qualifiers are now a BANK per element, and each one is a COMPLETE
   SENTENCE rather than a trailing fragment.

   The fragment form was inherited from v1, where every mood phrase was a noun
   phrase it could hang off. The expanded banks include phrases that end in a
   clause or an imperative, and appending to those produced:

     "A dimmed, drifting mood — do not schedule the hard thing
      with a scattered brightness to it."

   Caught by reading the generated output rather than by any test; grammar is
   not something the suite can check. Standalone sentences decouple the two
   banks completely, so all 6 x 4 combinations read correctly and either bank
   can grow later without re-checking the other. */
const MOOD_ELEMENT = {
  Fire: [
    "There's a spark of warmth behind it.",
    "It carries a bright, restless edge.",
    "Something impatient runs underneath.",
    "Expect a little heat in it.",
  ],
  Earth: [
    "It has a steady, grounded feel.",
    "Both feet are on the floor today.",
    "It moves in a slow, solid register.",
    "There's a practical weight to it.",
  ],
  Air: [
    "It comes with a light, curious edge.",
    "The key is talkative and quick-moving.",
    "Your attention may flit more than usual.",
    "There's a scattered brightness to it.",
  ],
  Water: [
    "The undertone is tender and feelings-first.",
    "You may feel unusually permeable.",
    "Everything registers slightly more than usual.",
    "There's an undertow you may not name.",
  ],
};

const LOVE_BY_ELEMENT = {
  Fire: [
    "warmth and playfulness come easily — say the bold, kind thing",
    "affection wants to be expressed openly today",
    "enthusiasm reads as love right now; let it show",
    "a good day to make the first move, however small",
    "generosity lands well — be a little extravagant with warmth",
    "the direct thing is the affectionate thing today",
  ],
  Earth: [
    "small, practical gestures of care land best today",
    "steadiness and reliability feel like love right now",
    "doing the unglamorous helpful thing says the most",
    "presence beats eloquence — just be reliably there",
    "care shows up as follow-through today, not as words",
    "the ordinary kindness is the one that registers",
  ],
  Air: [
    "good conversation is the way to closeness today",
    "connection grows through words and shared curiosity",
    "ask the question you have been meaning to ask",
    "being genuinely interested is the whole gesture today",
    "closeness arrives sideways, through something you both find funny",
    "say the half-formed thought; it is better company than silence",
  ],
  Water: [
    "tenderness and quiet presence matter more than grand gestures",
    "let yourself feel and gently share it",
    "being soft is not the same as being unclear",
    "a day for listening past what is actually said",
    "closeness through comfort rather than conversation",
    "let something unspoken finally be said quietly",
  ],
};

// Previously a single hardcoded sentence appended to love when a soft Venus or
// Mars contact is active. A bank keeps that day from reading identically for
// everyone who has one.
const LOVE_SOFT_CONTACT = [
  "Affection and ease may line up a little more naturally today.",
  "Warmth is slightly less effortful than usual right now.",
  "There is a bit of extra ease in reaching toward someone today.",
  "Connection may cost less effort than it did recently.",
  "Kindness tends to land cleanly under conditions like these.",
];

const LUCK_BY_SEASON = {
  base: [
    "doors feel a little easier to nudge open — notice small yeses",
    "conditions favor trying the thing you keep almost-doing",
    "a good window to ask, apply, or reach out",
    "supportive timing for learning and small bets",
    "circumstances lean slightly toward the person who asks first",
    "a reasonable day to put your name forward",
    "small openings are more likely than large ones — take a small one",
    "favourable conditions for a conversation you have been postponing",
    "timing suits practising something badly in private",
    "a fair day for a modest risk with a survivable downside",
    "conditions reward being findable — be somewhere, say something",
    "a decent window for tidying up an opportunity you already have",
  ],
};

const LUCK_SOFT_CONTACT = [
  "A supportive, growth-friendly note is in the mix.",
  "There is a widening quality to the day worth using.",
  "Conditions lean a little toward more rather than less.",
  "Something expansive sits underneath today's conditions.",
  "The day has some room in it — more than yesterday did.",
];

const WATCHOUT_GENERAL = [
  "give yourself a little extra time — rushing is where small mix-ups sneak in",
  "double-check the details before you commit to them",
  "pause before reacting; a short breath saves a long detour",
  "keep plans a bit flexible today",
  "say the thing plainly — half-said is where confusion starts",
  "do the boring confirmation step; it is cheaper than the correction",
  "notice when tired is doing the talking",
  "one thing at a time will be faster today than three at once",
  "assume the other person meant it kindly, and ask if unsure",
  "leave a buffer around anything with a fixed time",
  "resist deciding something large while you are hungry or rushed",
  // Reworded from "…the thing you are sure you will remember": the phrase was
  // harmless but tripped the no-promises guard on "you will". Rewording one
  // line is cheaper than loosening a rule that protects every other line.
  "write it down even if you are certain you would remember anyway",
];

// Prefixes for the friction case. Previously one hardcoded phrase.
const WATCHOUT_FRICTION = [
  "Some friction is in play today",
  "There is a bit of drag in the day",
  "Conditions are a little rougher than usual",
  "Expect some resistance today",
];

// The retrograde branch, translated. NO line here may name the planet — the
// technical fact lives in Technical Sky. Each must still carry the practical
// content the suite asserts survives: messages, plans, details, confirming, or
// a second look.
const WATCHOUT_REVIEW = [
  "Messages and plans may need a second look — confirm details before you lock them in",
  "Worth re-reading messages before sending, and confirming plans before relying on them",
  "Details are slippery today — confirm the important ones rather than assuming",
  "Give plans a second look; small details are the ones that shift",
  "Confirm the details of anything arranged in a hurry",
];

// Lucky color — curated, all readable on the dark navy base.
const LUCKY_COLORS = [
  { name: "Lavender Mist", value: "#B8A7FF" }, { name: "Periwinkle", value: "#A6B1FF" },
  { name: "Moon White", value: "#EAEEFF" }, { name: "Soft Blush", value: "#FFB7C5" },
  { name: "Electric Blue", value: "#6FA8FF" }, { name: "Indigo Glow", value: "#8C7BFF" },
  { name: "Pale Gold", value: "#F0D48C" }, { name: "Sea Glass", value: "#8FE3D0" },
  { name: "Rosewater", value: "#F3C6D6" }, { name: "Amethyst", value: "#C08CFF" },
  { name: "Starlight Silver", value: "#D7DEF5" }, { name: "Twilight Teal", value: "#79D6E6" },
  { name: "Dusk Coral", value: "#FFA8A0" }, { name: "Pale Jade", value: "#A8E6C1" },
  { name: "Cornflower", value: "#8FB4FF" }, { name: "Warm Sand", value: "#E8CFA9" },
  { name: "Orchid Haze", value: "#D3A4F5" }, { name: "Frost Blue", value: "#B6DBFF" },
];

/**
 * Every authored line in this file, flattened.
 *
 * Exported for the test suite. The composed-output tests sample a handful of
 * skies, which can only ever exercise the phrases those seeds happen to select
 * — a forbidden word could sit in a line nobody's seed picks for months, and
 * ship. This lets the suite check ALL of them, which is the only version of
 * that guarantee worth having.
 */
export function allAuthoredPhrases() {
  return [
    ...Object.values(MOOD_BY_PHASE).flat(),
    ...Object.values(MOOD_ELEMENT).flat(),
    ...Object.values(LOVE_BY_ELEMENT).flat(),
    ...LOVE_SOFT_CONTACT,
    ...LUCK_BY_SEASON.base,
    ...LUCK_SOFT_CONTACT,
    ...WATCHOUT_GENERAL,
    ...WATCHOUT_FRICTION,
    ...WATCHOUT_REVIEW,
    ...LUCKY_COLORS.map((c) => c.name),
  ];
}

/** The review-branch lines, so the suite can check each carries real advice. */
export function reviewPhrases() { return [...WATCHOUT_REVIEW]; }

// ── lucky number: documented numerology reduction ────────────────────────────
// Rule: sum the digits of the local date (YYYYMMDD) plus a chart-seed offset
// (0..98), then digit-sum repeatedly to a single 1..9 (0 maps to 9). Stable for
// a given chart + day because both inputs are stable.
export function luckyNumber(seed, localDate) {
  const digits = localDate.replace(/-/g, "").split("").reduce((s, d) => s + Number(d), 0);
  let n = digits + streamInt(seed, "lucky-number", 99);
  while (n > 9) n = String(n).split("").reduce((s, d) => s + Number(d), 0);
  return n === 0 ? 9 : n;
}

function planetSign(chart, name) { return chart.planets?.[name]?.sign || null; }
function skySign(sky, name) { return sky.planets?.[name]?.sign || sky[name.toLowerCase()]?.sign || null; }

// ── main composition ─────────────────────────────────────────────────────────
// chart: computeNatalChart(...) output. sky: currentSky(...) output.
export function composeFortune({ chart, sky, localDate, timezoneName, chartId, chartInputHash }) {
  const seed = fortuneSeed({ localDate, chartId, chartInputHash, skySnapshotHash: sky.snapshot_hash });
  const transits = personalTransits(sky, chart);

  // ── Mood ──
  const moonPhase = sky.moon.phase_name;
  const moodBase = pick(seed, "mood", MOOD_BY_PHASE[moonPhase] || MOOD_BY_PHASE["Waning Crescent"]);
  const moonElement = elementOf(sky.moon.sign);
  // Two independent seeded picks — the phrase and its qualifier — so the same
  // phase and element still produce 6 x 4 different moods rather than one.
  // Distinct labels, or both streams would index identically and the second
  // choice would be decorative.
  const moodTail = MOOD_ELEMENT[moonElement]
    ? pick(seed, "mood-element", MOOD_ELEMENT[moonElement])
    : "";
  // Two sentences, not a phrase with a tail — see MOOD_ELEMENT above.
  const mood = `${cap(moodBase)}.${moodTail ? ` ${moodTail}` : ""}`;

  // ── Love ── (natal Venus element, colored by any Venus/Mars transit)
  const venusSign = planetSign(chart, "Venus") || sky.moon.sign;
  const loveEl = elementOf(venusSign) || "Water";
  let love = cap(pick(seed, "love", LOVE_BY_ELEMENT[loveEl])) + ".";
  const venusTransit = transits.find((t) => (t.transiting === "Venus" || t.natal === "Venus") && t.soft);
  if (venusTransit) love += ` ${pick(seed, "love-soft", LOVE_SOFT_CONTACT)}`;

  // ── Luck ── (framed as favorable conditions; never a promise)
  let luck = cap(pick(seed, "luck", LUCK_BY_SEASON.base)) + ".";
  const jupiterTransit = transits.find((t) => (t.transiting === "Jupiter" || t.natal === "Jupiter") && t.soft);
  if (jupiterTransit) luck += ` ${pick(seed, "luck-soft", LUCK_SOFT_CONTACT)}`;
  luck += " (Conditions to notice, not guarantees.)";

  // ── Watch-Out ── (retrogrades + hard transits, practical, no fear)
  //
  // Update 5.2: these readings are the plain-language half of the fortune, and
  // must not name planets. "Mercury is retrograde, so double-check messages"
  // reads as jargon to the people most likely to need the advice — and the
  // technical fact is not lost, it appears in Technical Sky where the exact
  // position and the ℞ mark belong.
  //
  // The astrology is unchanged. Only the wording is translated, and it stays
  // deterministic: the same sky still produces the same sentence.
  let watch;
  if (sky.retrogrades.includes("Mercury")) {
    watch = pick(seed, "watch-review", WATCHOUT_REVIEW);
  } else {
    const hard = transits.find((t) => t.hard);
    watch = hard
      ? `${pick(seed, "watch-friction", WATCHOUT_FRICTION)} — ${pick(seed, "watch", WATCHOUT_GENERAL)}`
      : cap(pick(seed, "watch", WATCHOUT_GENERAL));
  }
  watch += ".";

  const lucky_number = luckyNumber(seed, localDate);
  const lucky_color = pick(seed, "lucky-color", LUCKY_COLORS);

  const factors = buildFactors(sky, chart, transits);

  return {
    fortune_engine_version: FORTUNE_ENGINE_VERSION,
    fortune_date: localDate,
    timezone_name: timezoneName || "UTC",
    chart_id: chartId || null,
    seed_hash: seed,
    sky_snapshot: {
      context_version: sky.context_version || null,
      calculated_at_utc: sky.calculated_at_utc || sky.instant_utc || null,
      user_timezone: sky.user_timezone || timezoneName || "UTC",
      timezone_source: sky.timezone_source || null,
      timezone_fallback: sky.timezone_fallback ?? null,
      local_date: sky.local_date || localDate,
      zodiac_season: sky.zodiac_season,
      moon_sign: sky.moon.sign,
      moon_phase: sky.moon.phase_name,
      moon_phase_fraction: sky.moon.phase_fraction ?? null,
      illumination_percent: sky.moon.illumination_percent,
      waxing: sky.moon.waxing,
      next_full_moon: sky.next_full_moon || null,
      next_new_moon: sky.next_new_moon || null,
      retrogrades: sky.retrogrades,
      source: sky.source || null,
    },
    mood, love_reading: love, luck_reading: luck, watch_out: watch,
    lucky_number, lucky_color,
    factors,
  };
}

// ── "Why this reading" factors, phrased per detail level ─────────────────────
// Update Two removed the Balanced level: each factor now carries only `simple`
// and `advanced` phrasings. (Stored rows from before the update may still hold a
// `balanced` key; factorsForLevel simply never reads it.)
function buildFactors(sky, chart, transits) {
  const f = [];
  f.push({
    type: "season",
    simple: `The Sun is in ${sky.zodiac_season} season`,
    advanced: `Sun ${fmtDeg(sky.sun)} ${sky.sun.sign}`,
  });
  f.push({
    type: "moon",
    simple: `The Moon is in ${sky.moon.sign} and ${sky.moon.waxing ? "waxing (growing)" : "waning (shrinking)"} — ${Math.round(sky.moon.illumination_percent)}% lit`,
    advanced: `Moon ${fmtDeg(sky.moon)} ${sky.moon.sign}, ${sky.moon.phase_name}, ${sky.moon.illumination_percent}% illuminated, ${sky.moon.waxing ? "waxing" : "waning"}`,
  });
  for (const r of sky.retrogrades) {
    f.push({ type: "retrograde", simple: `${r} is retrograde (a review-and-slow-down signal)`, advanced: `${r} retrograde` });
  }
  for (const t of transits.slice(0, 3)) {
    f.push({
      type: "transit",
      simple: plainTransit(t),
      advanced: `Transiting ${t.transiting} ${t.aspect} natal ${t.natal}, orb ${fmtOrb(t.orb)}, ${t.applying ? "applying" : "separating"}`,
      // Update 5.2b: the structured transit travels alongside its two phrasings
      // so the Transits page can sort and filter without re-deriving geometry
      // from a sentence. Additive — every existing reader ignores it, and a
      // fortune stored before this update simply lacks the field.
      transit: {
        transiting: t.transiting,
        natal: t.natal,
        aspect: t.aspect,
        orb: t.orb,
        applying: Boolean(t.applying),
        soft: Boolean(t.soft),
        hard: Boolean(t.hard),
      },
    });
  }
  return f;
}

function plainTransit(t) {
  const map = {
    Venus: "affection", Mars: "drive", Moon: "feelings", Sun: "sense of self",
    Mercury: "thinking and talking", Jupiter: "growth and luck", Saturn: "structure and limits",
  };
  const a = map[t.transiting] || t.transiting, b = map[t.natal] || t.natal;
  if (t.soft) return `Today's ${a} works together with your natural ${b}`;
  if (t.hard) return `Today's ${a} rubs against your natural ${b} — a little friction to work with`;
  return `Today's ${a} meets your natural ${b}`;
}

// ── helpers ──────────────────────────────────────────────────────────────────
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function fmtDeg(b) { return b.degrees != null ? `${b.degrees}°${String(b.minutes ?? 0).padStart(2, "0")}′` : ""; }
function fmtOrb(orb) { const d = Math.floor(orb); const m = Math.round((orb - d) * 60); return `${d}°${String(m).padStart(2, "0")}′`; }

// Render the factor list at a given detail level (Simple | Advanced). Any
// non-Advanced value — including a legacy "Balanced" — renders as Simple.
export function factorsForLevel(factors, level) {
  const key = level === "Advanced" ? "advanced" : "simple";
  return factors.map((f) => f[key] ?? f.simple);
}
