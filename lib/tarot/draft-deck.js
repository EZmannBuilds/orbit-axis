// Orbit Axis :: the DRAFT Tarot deck.
//
// WHAT THIS IS, EXACTLY
//
// Seventy-eight cards written for Orbit Axis, informed by the public-domain
// tarot tradition — chiefly A. E. Waite's *The Pictorial Key to the Tarot*
// (1911) and the Waite–Smith deck (1909), which entered the United States
// public domain in 1966 and the United Kingdom's in 2021–22 on the death of
// Pamela Colman Smith in 1951.
//
// The prose is not transcribed from those sources. It is written here, in
// Orbit's own register: reflective rather than predictive, and phrased as a
// question a reader can actually sit with. But it is *derived* from a shared
// tradition, and the provenance below says so rather than calling it original.
// That distinction is the whole point of the field.
//
// WHY IT IS A DRAFT, AND WHY THAT IS NOT A TECHNICALITY
//
// `reviewed: false` on every card, because review is something a person does
// and the owner has not done it. `deckStatus()` refuses an unreviewed deck in
// production regardless of any flag, so this deck can be read, tested, and
// argued with locally and in preview — and cannot ship.
//
// The owner's stated plan is to commission original meanings from a writer.
// When those arrive they replace this file, the provenance names the author,
// and the review flag becomes theirs to set. Until then this is a working
// draft that says what it is.
//
// A NOTE ON WHAT THESE MEANINGS DO NOT DO
//
// No card here predicts an event, promises a timescale, or offers medical,
// financial, or relationship advice. That is enforced, not merely intended:
// validateCard() in deck.js refuses the language, and a test runs the whole
// deck through it.

import { readFileSync } from "node:fs";

/**
 * Where this deck's artwork sits in the bucket.
 *
 * Versioned by deck, and never reused: replacing artwork means a new path, or
 * a CDN holding a one-year immutable cache serves the old bytes for a year.
 */
const IMAGE_DECK_PATH = "waite-smith/1909";

const PROVENANCE = Object.freeze({
  author: "Orbit Axis (draft)",
  license: "public-domain-derived",
  source: "Informed by A. E. Waite, The Pictorial Key to the Tarot (1911), and "
    + "the Waite-Smith deck (1909) — both public domain. Prose written for "
    + "Orbit Axis; not transcribed.",
  tradition: "Rider-Waite-Smith",
  reviewed: false,
});

/**
 * Card artwork, attached from the manifest the sourcing script wrote.
 *
 * The images are the Waite-Smith plates (1909), public domain, downloaded from
 * Wikimedia Commons by scripts/tarot-images.mjs — which verifies each licence
 * before keeping the file and refuses to write a partial manifest.
 *
 * The artwork and the meaning are SEPARATELY licensed and separately
 * replaceable. When an artist is commissioned, this manifest is regenerated and
 * the prose is untouched; when a writer is commissioned, the reverse.
 *
 * A missing manifest is not an error. The deck simply has no imagery and every
 * card renders its typographic face, which is the state the app shipped in.
 */
const IMAGES = (() => {
  try {
    return JSON.parse(readFileSync(new URL("./image-manifest.json", import.meta.url), "utf8"));
  } catch {
    return {};
  }
})();

const card = (slug, name, arcana, suit, number, upright_meaning, reflection_prompt) => {
  const art = IMAGES[slug];
  return {
    slug, name, arcana, suit, number, upright_meaning, reflection_prompt,
    provenance: PROVENANCE,
    image: art
      ? {
          path: `${IMAGE_DECK_PATH}/${art.file}`,
          width: art.width,
          height: art.height,
          license: art.license,
          source: art.source,
        }
      : null,
  };
};

/* ── Major Arcana ───────────────────────────────────────────────────────────
   Twenty-two cards, numbered 0–21. The majors tend to describe a condition
   someone is in rather than a task in front of them, and the prompts are
   written to match that scale. */

const MAJORS = [
  card("the-fool", "The Fool", "major", null, 0,
    "A beginning taken before all the information is in. The Fool is about willingness rather than readiness — the step where confidence comes from openness instead of from a plan.",
    "Where are you waiting to feel ready before you begin?"),

  card("the-magician", "The Magician", "major", null, 1,
    "Having what the work requires, and knowing it. The Magician is the moment when scattered capability becomes usable — the same skills, newly pointed at something.",
    "What do you already have that you have not put to use?"),

  card("the-high-priestess", "The High Priestess", "major", null, 2,
    "Knowledge that has not been spoken aloud yet. The High Priestess is the part of a situation you understand without being able to argue for it, and the patience to let it stay unspoken a while longer.",
    "What do you know that you have not found words for?"),

  card("the-empress", "The Empress", "major", null, 3,
    "Something growing because conditions allow it. The Empress is abundance as a consequence of tending — attention given steadily rather than intensely.",
    "What in your life is growing because you have been tending it?"),

  card("the-emperor", "The Emperor", "major", null, 4,
    "Structure as a form of care. The Emperor is the boundary, the rule, the order that makes a thing durable — and the question of whether the structure still serves what it was built for.",
    "Which of your structures still serve you, and which do you simply maintain?"),

  card("the-hierophant", "The Hierophant", "major", null, 5,
    "Inherited understanding — the tradition, the training, the way it has always been done. The Hierophant asks what you have accepted because it was handed to you.",
    "Which of your beliefs did you choose, and which did you inherit?"),

  card("the-lovers", "The Lovers", "major", null, 6,
    "A choice that reveals a value. The Lovers is less about romance than about alignment: what you pick when two things you care about cannot both be honoured.",
    "What does your most recent difficult choice say about what you value?"),

  card("the-chariot", "The Chariot", "major", null, 7,
    "Momentum held together by will. The Chariot is forward motion achieved by keeping opposing forces pointed the same way, which works as long as attention holds.",
    "What are you holding together by force of effort alone?"),

  card("strength", "Strength", "major", null, 8,
    "Power exercised gently. Strength is the capacity to meet something difficult without hardening against it — steadiness rather than force.",
    "Where could patience accomplish more than pressure?"),

  card("the-hermit", "The Hermit", "major", null, 9,
    "Deliberate withdrawal in order to see clearly. The Hermit is the value of stepping back far enough that the noise stops organising your thinking.",
    "What would become clearer if you stepped back from it?"),

  card("wheel-of-fortune", "Wheel of Fortune", "major", null, 10,
    "Circumstance turning for reasons outside anyone's hand. The Wheel is a reminder that some conditions are weather rather than consequence, and are met rather than earned.",
    "What are you treating as your fault that was simply circumstance?"),

  card("justice", "Justice", "major", null, 11,
    "Consequence following cause, plainly. Justice is the clear-eyed accounting — what actually follows from what, with the story stripped out.",
    "If you looked at this without the story you tell about it, what would you see?"),

  card("the-hanged-one", "The Hanged One", "major", null, 12,
    "A pause that is not a delay. The Hanged One is suspension used deliberately — the change of view that only comes from staying still in an uncomfortable position.",
    "What might a different angle on this show you?"),

  card("death", "Death", "major", null, 13,
    "An ending that clears ground. Death is the close of a chapter rather than a loss — the recognition that something has finished and can be released rather than maintained.",
    "What has already ended that you are still keeping alive?"),

  card("temperance", "Temperance", "major", null, 14,
    "Proportion found by mixing. Temperance is the patient adjustment between extremes until something workable emerges — less a compromise than a recipe.",
    "Where would a smaller dose serve you better than the full measure?"),

  card("the-devil", "The Devil", "major", null, 15,
    "An attachment that feels like necessity. The Devil is the pattern you describe as unavoidable, and the quiet question of what keeps it in place.",
    "What do you call unavoidable that you have not tested lately?"),

  card("the-tower", "The Tower", "major", null, 16,
    "A structure giving way at once. The Tower is sudden change to something that looked solid — disruptive, clarifying, and rarely gentle.",
    "What would you rebuild differently if you were starting from the ground?"),

  card("the-star", "The Star", "major", null, 17,
    "Quiet replenishment after difficulty. The Star is hope in its undramatic form — the sense that something can be repaired, and the calm required to begin.",
    "What is quietly restoring you at the moment?"),

  card("the-moon", "The Moon", "major", null, 18,
    "Uncertainty that has not resolved. The Moon is the territory where feeling outruns evidence and things are not yet what they seem — a state to move through carefully rather than to force.",
    "What are you uncertain about that you have been pretending is settled?"),

  card("the-sun", "The Sun", "major", null, 19,
    "Clarity and ease arriving together. The Sun is warmth without complication — a straightforwardness worth noticing precisely because it is rare.",
    "What is going well that you have not stopped to acknowledge?"),

  card("judgement", "Judgement", "major", null, 20,
    "Reckoning with what has happened, and deciding what it means. Judgement is the honest look back that makes a real change of direction possible.",
    "What are you ready to see differently about your own past?"),

  card("the-world", "The World", "major", null, 21,
    "Completion, with its own quiet cost. The World is the closing of a long arc — arrival, and the odd emptiness that often follows one.",
    "What have you finished without ever marking as finished?"),
];

export const DRAFT_MAJORS = Object.freeze(MAJORS);

/* ── Minor Arcana ───────────────────────────────────────────────────────────
   Four suits of fourteen. The minors describe the texture of ordinary days
   rather than the shape of a life, so the meanings are smaller and the prompts
   more immediate.

   Wands — action, drive, the work someone is pushing forward.
   Cups — feeling, connection, what a person is carrying emotionally.
   Swords — thought, speech, conflict, and the clarity or damage in them.
   Pentacles — the material world: money, body, craft, and slow accumulation. */

const WANDS = [
  card("ace-of-wands", "Ace of Wands", "minor", "wands", 1,
    "A first spark of energy for something. The Ace is potential in its rawest state — real, but not yet shaped into anything.",
    "What has your attention right now that you have not acted on?"),
  card("two-of-wands", "Two of Wands", "minor", "wands", 2,
    "Standing at the edge of a decision with the map already in hand. The Two is planning that has gone as far as planning can go.",
    "What are you still preparing for that you could simply start?"),
  card("three-of-wands", "Three of Wands", "minor", "wands", 3,
    "Work sent out and now waiting. The Three is the interval after effort, when the outcome is genuinely not in your hands.",
    "What have you set in motion that you are waiting on?"),
  card("four-of-wands", "Four of Wands", "minor", "wands", 4,
    "A milestone worth marking. The Four is stability reached and the celebration that acknowledges it.",
    "What would it look like to properly mark something you have achieved?"),
  card("five-of-wands", "Five of Wands", "minor", "wands", 5,
    "Friction between people pulling different ways. The Five is competition and disagreement — often energetic rather than hostile, and often unresolved.",
    "Which disagreement in your life is generating heat without progress?"),
  card("six-of-wands", "Six of Wands", "minor", "wands", 6,
    "Recognition arriving. The Six is being seen for what you have done, and the question of how comfortably you can accept it.",
    "How do you respond when someone acknowledges your work?"),
  card("seven-of-wands", "Seven of Wands", "minor", "wands", 7,
    "Holding a position under pressure. The Seven is defending something you have built against real challenge.",
    "What are you defending, and is it still worth the effort of defending?"),
  card("eight-of-wands", "Eight of Wands", "minor", "wands", 8,
    "Rapid movement after a delay. The Eight is the stretch where several things resolve at once and the pace is not yours to set.",
    "What is moving faster than you expected?"),
  card("nine-of-wands", "Nine of Wands", "minor", "wands", 9,
    "Tired persistence. The Nine is carrying on when the reserves are low — resilience with a real cost attached.",
    "Where are you running on reserves you have not replenished?"),
  card("ten-of-wands", "Ten of Wands", "minor", "wands", 10,
    "Carrying more than one person reasonably can. The Ten is the load taken on gradually until its weight became normal.",
    "What are you carrying that was never actually yours to carry?"),
  card("page-of-wands", "Page of Wands", "minor", "wands", 11,
    "Enthusiasm without expertise. The Page is the beginner's energy — curious, unpolished, and genuinely useful.",
    "What would you try if being a beginner at it did not bother you?"),
  card("knight-of-wands", "Knight of Wands", "minor", "wands", 12,
    "Acting before deliberating. The Knight is momentum and appetite, which carries a person a long way and occasionally past the turning.",
    "Where has your speed been an asset, and where has it cost you?"),
  card("queen-of-wands", "Queen of Wands", "minor", "wands", 13,
    "Warmth and self-possession together. The Queen is confidence that draws people in rather than pushing them back.",
    "When do you feel most yourself in company?"),
  card("king-of-wands", "King of Wands", "minor", "wands", 14,
    "Vision that other people can follow. The King is drive matured into direction — leadership by clarity of intent.",
    "What are you leading, formally or otherwise?"),
];

const CUPS = [
  card("ace-of-cups", "Ace of Cups", "minor", "cups", 1,
    "A feeling beginning. The Ace is emotional openness before it has attached itself to any particular person or outcome.",
    "What are you feeling that you have not named yet?"),
  card("two-of-cups", "Two of Cups", "minor", "cups", 2,
    "Mutual regard between two people. The Two is connection acknowledged on both sides — a meeting rather than a pursuit.",
    "Which of your connections feels genuinely mutual?"),
  card("three-of-cups", "Three of Cups", "minor", "cups", 3,
    "Shared gladness. The Three is friendship and company, and the particular relief of being among people who know you.",
    "Who do you feel lighter around?"),
  card("four-of-cups", "Four of Cups", "minor", "cups", 4,
    "Dissatisfaction in the presence of enough. The Four is the flatness that makes an offered thing hard to see.",
    "What is being offered that you have not really looked at?"),
  card("five-of-cups", "Five of Cups", "minor", "cups", 5,
    "Grief focused on what was lost. The Five is the honest weight of disappointment, and the fact that something usually remains behind you unnoticed.",
    "What remains that you have not turned around to see?"),
  card("six-of-cups", "Six of Cups", "minor", "cups", 6,
    "Memory with warmth in it. The Six is nostalgia — sustaining when it restores you, limiting when it becomes the preferred place to live.",
    "What does your fondness for the past give you, and what does it cost?"),
  card("seven-of-cups", "Seven of Cups", "minor", "cups", 7,
    "Too many options, none chosen. The Seven is imagination outpacing commitment, where every possibility stays appealing by staying hypothetical.",
    "Which of your options have you been keeping open to avoid choosing?"),
  card("eight-of-cups", "Eight of Cups", "minor", "cups", 8,
    "Walking away from something that was fine. The Eight is leaving in search of meaning rather than in response to damage.",
    "What no longer holds meaning for you, even though nothing is wrong with it?"),
  card("nine-of-cups", "Nine of Cups", "minor", "cups", 9,
    "Contentment arrived at. The Nine is satisfaction with what you have — pleasant, personal, and worth pausing on.",
    "What are you satisfied with that you rarely say out loud?"),
  card("ten-of-cups", "Ten of Cups", "minor", "cups", 10,
    "Emotional fullness shared with others. The Ten is belonging — the sense of a life with people properly in it.",
    "Where do you feel most at home with other people?"),
  card("page-of-cups", "Page of Cups", "minor", "cups", 11,
    "Feeling met with curiosity. The Page is emotional openness that has not yet learned to guard itself.",
    "What are you curious about that you have been treating as unserious?"),
  card("knight-of-cups", "Knight of Cups", "minor", "cups", 12,
    "Following feeling wherever it goes. The Knight is romantic and idealistic, moved more by how a thing feels than by what it is.",
    "Where are you following a feeling, and where is it taking you?"),
  card("queen-of-cups", "Queen of Cups", "minor", "cups", 13,
    "Deep feeling held steadily. The Queen is emotional depth that does not spill — the capacity to feel a great deal and remain useful.",
    "Whose feelings are you holding alongside your own?"),
  card("king-of-cups", "King of Cups", "minor", "cups", 14,
    "Composure that is not suppression. The King is emotional maturity — feeling fully and choosing the response deliberately.",
    "Where do you manage your feelings well, and where do you only appear to?"),
];

const SWORDS = [
  card("ace-of-swords", "Ace of Swords", "minor", "swords", 1,
    "A thought that cuts through. The Ace is the moment a confusion resolves into a clear statement you can act on.",
    "What have you recently understood clearly for the first time?"),
  card("two-of-swords", "Two of Swords", "minor", "swords", 2,
    "A decision avoided by refusing to look. The Two is stalemate maintained because choosing would mean losing something either way.",
    "What decision are you avoiding by not gathering information?"),
  card("three-of-swords", "Three of Swords", "minor", "swords", 3,
    "Plain hurt, usually from words. The Three is the sharp kind of pain that comes with understanding something you would rather not have understood.",
    "What truth was painful to hear, and what did it clarify?"),
  card("four-of-swords", "Four of Swords", "minor", "swords", 4,
    "Rest taken deliberately. The Four is the pause that restores capacity — not avoidance, but recovery.",
    "When did you last rest without earning it first?"),
  card("five-of-swords", "Five of Swords", "minor", "swords", 5,
    "Winning at a cost to the relationship. The Five is the argument taken to its conclusion, where being right turned out not to be the point.",
    "Where have you won something that cost more than it was worth?"),
  card("six-of-swords", "Six of Swords", "minor", "swords", 6,
    "Moving on from a difficult stretch, carrying some of it along. The Six is transition — an improvement that is not yet an arrival.",
    "What are you moving away from, and what are you bringing with you?"),
  card("seven-of-swords", "Seven of Swords", "minor", "swords", 7,
    "Acting alone, and not entirely openly. The Seven is strategy that shades into evasion, and the question of what the concealment is for.",
    "What are you keeping to yourself, and why?"),
  card("eight-of-swords", "Eight of Swords", "minor", "swords", 8,
    "Feeling trapped by a situation with more give than it appears to have. The Eight is restriction that is partly circumstance and partly the story told about it.",
    "What feels impossible that you have not actually tested?"),
  card("nine-of-swords", "Nine of Swords", "minor", "swords", 9,
    "Worry at its loudest, usually at night. The Nine is anxiety that has outgrown the thing it started from.",
    "What has your worry grown larger than?"),
  card("ten-of-swords", "Ten of Swords", "minor", "swords", 10,
    "The lowest point of something, and therefore the end of it. The Ten is the finality that at least removes the question of whether it can continue.",
    "What has bottomed out, and what does that free you from?"),
  card("page-of-swords", "Page of Swords", "minor", "swords", 11,
    "Sharp curiosity, not yet tactful. The Page is the appetite for finding things out, questions included.",
    "What question have you been hesitant to ask?"),
  card("knight-of-swords", "Knight of Swords", "minor", "swords", 12,
    "Conviction moving fast. The Knight is intellectual force that convinces and occasionally runs past the evidence.",
    "Where is your certainty running ahead of what you actually know?"),
  card("queen-of-swords", "Queen of Swords", "minor", "swords", 13,
    "Clear sight, honestly expressed. The Queen is perceptiveness with the kindness of directness rather than the kindness of softening.",
    "Where would honesty serve someone better than reassurance?"),
  card("king-of-swords", "King of Swords", "minor", "swords", 14,
    "Judgement formed carefully and stated plainly. The King is intellect with authority — the person whose assessment others rely on.",
    "Whose judgement do you rely on, and who relies on yours?"),
];

const PENTACLES = [
  card("ace-of-pentacles", "Ace of Pentacles", "minor", "pentacles", 1,
    "A practical opening. The Ace is the beginning of something tangible — a resource, a skill, an opportunity with substance to it.",
    "What practical opportunity is in front of you right now?"),
  card("two-of-pentacles", "Two of Pentacles", "minor", "pentacles", 2,
    "Juggling commitments that all matter. The Two is balance maintained by constant small adjustments.",
    "What are you balancing that has stopped feeling sustainable?"),
  card("three-of-pentacles", "Three of Pentacles", "minor", "pentacles", 3,
    "Skill recognised and combined with others'. The Three is collaboration where each person's contribution is visible.",
    "Whose skill complements yours, and have you told them?"),
  card("four-of-pentacles", "Four of Pentacles", "minor", "pentacles", 4,
    "Holding on tightly. The Four is security pursued through retention — sensible up to the point where holding becomes the only strategy.",
    "What are you holding onto more tightly than it needs?"),
  card("five-of-pentacles", "Five of Pentacles", "minor", "pentacles", 5,
    "Hardship, and the isolation that often comes with it. The Five is scarcity made worse by the reluctance to say so.",
    "What help is available that you have not asked for?"),
  card("six-of-pentacles", "Six of Pentacles", "minor", "pentacles", 6,
    "Giving and receiving, and the balance between them. The Six is generosity, along with the awareness of what it establishes.",
    "Are you more comfortable giving or receiving, and what does that cost you?"),
  card("seven-of-pentacles", "Seven of Pentacles", "minor", "pentacles", 7,
    "Pausing to assess something long in progress. The Seven is the patient look at whether continued effort is still worth it.",
    "What long effort deserves an honest assessment right now?"),
  card("eight-of-pentacles", "Eight of Pentacles", "minor", "pentacles", 8,
    "Repetition in the service of mastery. The Eight is the unglamorous practice that skill is actually made of.",
    "What are you willing to be bad at long enough to get good at?"),
  card("nine-of-pentacles", "Nine of Pentacles", "minor", "pentacles", 9,
    "Self-sufficiency enjoyed. The Nine is the comfort of having built something yourself and being at ease in it.",
    "What have you built that you can genuinely enjoy?"),
  card("ten-of-pentacles", "Ten of Pentacles", "minor", "pentacles", 10,
    "Security that extends beyond one person. The Ten is the long view — what lasts, what is passed on, what holds a family or a body of work together.",
    "What are you building that will outlast your involvement in it?"),
  card("page-of-pentacles", "Page of Pentacles", "minor", "pentacles", 11,
    "Studious beginnings. The Page is the early, diligent stage of learning something with practical use.",
    "What are you learning, and are you giving it enough time?"),
  card("knight-of-pentacles", "Knight of Pentacles", "minor", "pentacles", 12,
    "Steady, unhurried reliability. The Knight is the slow pace that finishes things, and occasionally the slowness that stalls them.",
    "Where is your thoroughness serving you, and where is it just delay?"),
  card("queen-of-pentacles", "Queen of Pentacles", "minor", "pentacles", 13,
    "Practical care for people and things. The Queen is competence directed at making life work — for herself and for others.",
    "Who do you take practical care of, and who does that for you?"),
  card("king-of-pentacles", "King of Pentacles", "minor", "pentacles", 14,
    "Established, well-managed abundance. The King is material mastery — resources handled with confidence and used to good effect.",
    "What resources do you handle well, and what would you like to handle better?"),
];

/** The full 78-card draft deck, in deck order: majors, then suits. */
export const DRAFT_CARDS = Object.freeze([
  ...MAJORS, ...WANDS, ...CUPS, ...SWORDS, ...PENTACLES,
]);

/**
 * The version this draft draws under.
 *
 * `-draft` is load-bearing: it is part of the daily-draw seed, so a card drawn
 * today from the draft and a card drawn later from the commissioned deck are
 * openly different draws rather than silently the same one. Nobody has to
 * wonder why "today's card" changed when the content was replaced — the deck
 * version says it did.
 */
export const DRAFT_DECK_VERSION = "0.1.0-draft";
