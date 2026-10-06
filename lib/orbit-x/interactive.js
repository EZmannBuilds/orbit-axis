// Orbit X :: interactive social posts (Dev Update 5.6).
//
// An interactive post asks the audience something. That is a DIFFERENT
// editorial object from a reading, and burying the question inside a
// reflection slide is what made it impossible to validate: a poll with one
// answer, a "this or that" with no options, and a question that quietly
// predicted someone's future all looked identical to the desk.
//
// So the question is structured. The interaction format declares whether
// choices are required, how many are valid, and which slide roles the post
// renders through. Everything here is ordinary application code, inspectable
// and asserted by tests — the same rule the editorial formats follow.
//
// TWO REGISTERS STAY SEPARATE, as everywhere else in Orbit X: the calculated
// sky arrives from the engine and is read-only; the question is editorial. A
// question may be curious. It may never predict an outcome or diagnose a
// person, and those two shapes are refused deterministically below.

import { recommendTemplate } from "./templates.js";

/** How many answer choices a format takes.
 *  - `required` — the post is invalid without them (a poll with no options
 *    is not a poll).
 *  - `optional` — supported, never demanded.
 *  - `none`     — the format asks an open question; choices are meaningless. */
export const CHOICE_MODES = Object.freeze(["required", "optional", "none"]);

/** The maximum a rendered choice slide can hold legibly at feed scale. */
export const CHOICE_LABEL_MAX = 48;
export const MAX_CHOICES = 4;

export const INTERACTION_FORMATS = Object.freeze({
  open_question: Object.freeze({
    id: "open_question",
    name: "Open question",
    blurb: "One question, no options — the answer is theirs to write.",
    choices: "none", minChoices: 0, maxChoices: 0,
    roles: Object.freeze(["hero", "question", "engagement"]),
    placement: "feed_carousel",
    questionHelper: "One clear question about noticing, not predicting.",
    engagementHelper: "How to answer — a comment, a save, a note to self.",
  }),
  two_choice_poll: Object.freeze({
    id: "two_choice_poll",
    name: "Two-choice poll",
    blurb: "Exactly two options — a sticker poll or a comment A/B.",
    choices: "required", minChoices: 2, maxChoices: 2,
    roles: Object.freeze(["hero", "question", "choices", "engagement"]),
    placement: "story",
    questionHelper: "A question with exactly two honest answers.",
    engagementHelper: "Name where to tap or what to comment.",
  }),
  this_or_that: Object.freeze({
    id: "this_or_that",
    name: "This or that",
    blurb: "Two to four either/or options, side by side.",
    choices: "required", minChoices: 2, maxChoices: 4,
    roles: Object.freeze(["hero", "question", "choices", "engagement"]),
    placement: "feed_carousel",
    questionHelper: "Which of these is more true for you right now?",
    engagementHelper: "Ask for the letter or the word, not an essay.",
  }),
  finish_the_sentence: Object.freeze({
    id: "finish_the_sentence",
    name: "Finish the sentence",
    blurb: "An opening clause the audience completes.",
    choices: "none", minChoices: 0, maxChoices: 0,
    roles: Object.freeze(["hero", "question", "engagement"]),
    placement: "story",
    questionHelper: "Write the opening clause, ending in an ellipsis.",
    engagementHelper: "Invite the completion — short, one line.",
  }),
  emoji_response: Object.freeze({
    id: "emoji_response",
    name: "Emoji response",
    blurb: "Answer with one emoji; a small key is optional.",
    choices: "optional", minChoices: 2, maxChoices: 4,
    roles: Object.freeze(["hero", "question", "choices", "engagement"]),
    placement: "story",
    questionHelper: "A question one symbol can answer.",
    engagementHelper: "Say which emoji means what, if you offered a key.",
  }),
  save_and_return: Object.freeze({
    id: "save_and_return",
    name: "Save and return",
    blurb: "A prompt worth keeping and answering later.",
    choices: "none", minChoices: 0, maxChoices: 0,
    roles: Object.freeze(["hero", "question", "engagement"]),
    placement: "feed_carousel",
    questionHelper: "A question that is better answered in a week than now.",
    engagementHelper: "Say when to come back to it.",
  }),
  story_question: Object.freeze({
    id: "story_question",
    name: "Story question",
    blurb: "A single-frame question sized for a story reply box.",
    choices: "none", minChoices: 0, maxChoices: 0,
    roles: Object.freeze(["hero", "question"]),
    placement: "story",
    questionHelper: "Short enough to read in a second and answer in five.",
    engagementHelper: "Optional — the reply box is the prompt.",
  }),
  carousel_reflection: Object.freeze({
    id: "carousel_reflection",
    name: "Carousel reflection",
    blurb: "Setup, question, and an invitation across a short carousel.",
    choices: "optional", minChoices: 2, maxChoices: 4,
    roles: Object.freeze(["hero", "question", "choices", "engagement"]),
    placement: "feed_carousel",
    questionHelper: "The question the setup has been walking toward.",
    engagementHelper: "Close the loop — what to do with the answer.",
  }),
});

export const INTERACTION_FORMAT_IDS = Object.freeze(Object.keys(INTERACTION_FORMATS));
export const DEFAULT_INTERACTION_FORMAT = "open_question";

/** Where an interactive post is meant to live. Presentation, never a
 *  promise: Orbit X publishes nothing, so this is a note to the founder. */
export const PLACEMENTS = Object.freeze({
  feed_carousel: "Feed carousel",
  feed_single: "Feed single image",
  story: "Story",
  reel_cover: "Reel cover",
});

export function interactionFormat(id) {
  return INTERACTION_FORMATS[id] || null;
}

/** Does this interaction format take answer choices, and how many? */
export function choiceRule(id) {
  const format = INTERACTION_FORMATS[id];
  if (!format) return Object.freeze({ mode: "none", min: 0, max: 0 });
  return Object.freeze({ mode: format.choices, min: format.minChoices, max: format.maxChoices });
}

const isStr = (v) => typeof v === "string" && v.trim().length > 0;

/* ── Question safety ────────────────────────────────────────────────────────
   The editorial constitution already refuses prediction and medical framing
   in prose. A question evades those shapes by construction — "will you meet
   someone this month?" states nothing and predicts everything — so the
   interrogative forms get their own named tripwires. Like every audit in
   Orbit X this is a tripwire for the worst shapes, not a moderator; the human
   review step is still the real gate. */
export const QUESTION_RULES = Object.freeze([
  { id: "predictive_question",
    pattern: /\bwhat will (?:happen|change|come)\b|\bwhen will (?:you|i|we|this|it)\b|\bwill (?:you|i|we) (?:meet|find|get|lose|receive|become|be)\b|\bwhat does (?:your|the) future hold\b|\bis .{0,24} going to happen\b/i,
    why: "asks the audience to expect a specific outcome — a question may notice, never predict" },
  { id: "diagnostic_question",
    pattern: /\bdiagnos\w+|\bdo you have (?:adhd|anxiety|depression|bpd|autism|trauma)\b|\bare you (?:depressed|bipolar|autistic|traumatised|traumatized)\b|\bwhat'?s wrong with you\b|\bis your (?:mental health|relationship|marriage) (?:failing|broken|over)\b/i,
    why: "asks the audience to self-diagnose — Orbit does not assess anyone" },
  { id: "engagement_bait_question",
    pattern: /\btag (?:three|3|two|2|a) (?:friends?|people)\b|\bcomment ["'“]?[a-z]{2,12}["'”]? (?:below|to)\b|\bshare (?:this )?to your story (?:if|for)\b|\bdouble tap if\b/i,
    why: "engagement bait — invite a real answer, never a mechanical one" },
]);

/**
 * Deterministic audit of the structured interaction. Returns findings;
 * empty means clean. Run beside auditCopy(), never instead of it.
 */
export function auditInteraction(interaction) {
  if (!interaction || typeof interaction !== "object") return [];
  const findings = [];
  const fields = [
    ["interaction.question", interaction.question],
    ["interaction.context", interaction.context],
    ["interaction.engagementPrompt", interaction.engagementPrompt],
    ...(Array.isArray(interaction.choices)
      ? interaction.choices.map((choice, i) => [`interaction.choices[${i}]`, choice]) : []),
  ];
  for (const [path, text] of fields) {
    if (!isStr(text)) continue;
    for (const rule of QUESTION_RULES) {
      if (rule.pattern.test(text)) findings.push({ path, rule: rule.id, why: rule.why });
    }
  }
  return findings;
}

/**
 * Validate and freeze the structured interaction.
 *
 * @param {object} raw
 * @param {object} [opts] { requireComplete } — false is the DRAFT register:
 *        the format and its choice contract are still enforced (a poll with
 *        one option is wrong the moment it is typed), but the question and
 *        engagement prompt may still be empty while the founder is writing.
 * @returns {{ interaction: object|null, problems: string[] }}
 */
export function validateInteraction(raw, { requireComplete = true } = {}) {
  const problems = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { interaction: null, problems: ["interactive post is missing its interaction block"] };
  }
  const formatId = String(raw.format || "").trim();
  const format = INTERACTION_FORMATS[formatId];
  if (!format) {
    return { interaction: null,
      problems: [`interaction format "${raw.format}" is not one of: ${INTERACTION_FORMAT_IDS.join(", ")}`] };
  }

  const question = String(raw.question || "").trim();
  if (requireComplete && !question) problems.push("interaction question missing");
  if (question.length > 200) problems.push("interaction question exceeds 200 characters");

  const context = String(raw.context || "").trim();
  if (context.length > 240) problems.push("interaction context exceeds 240 characters");

  const engagementPrompt = String(raw.engagementPrompt || "").trim();
  if (requireComplete && format.roles.includes("engagement") && !engagementPrompt) {
    problems.push("engagement prompt missing");
  }
  if (engagementPrompt.length > 160) problems.push("engagement prompt exceeds 160 characters");

  const rule = choiceRule(formatId);
  const supplied = Array.isArray(raw.choices)
    ? raw.choices.map((c) => String(c ?? "").trim()).filter(Boolean) : [];
  const choices = supplied.slice(0, MAX_CHOICES);
  if (rule.mode === "none") {
    if (choices.length) problems.push(`${format.name} takes no answer choices`);
  } else {
    // THE COUNT IS AN APPROVAL RULE, NOT A TYPING RULE. A poll being written
    // passes through "one option typed" on its way to two, and refusing the
    // draft at that moment would make the field unusable — the scaffold
    // itself starts with none. So the count binds when the post must be
    // complete (and again at the approval gate via interactionCompleteness);
    // shape violations that can never become valid — too many options,
    // duplicates, a label the row cannot hold — are refused immediately.
    const countBinds = requireComplete || (rule.mode === "optional" && choices.length > 0);
    if (countBinds && (choices.length < rule.min || choices.length > rule.max)) {
      problems.push(rule.min === rule.max
        ? `${format.name} needs exactly ${rule.min} answer choices; ${choices.length} supplied`
        : `${format.name} needs ${rule.min}–${rule.max} answer choices; ${choices.length} supplied`);
    } else if (!countBinds && choices.length > rule.max) {
      problems.push(`${format.name} takes at most ${rule.max} answer choices; ${choices.length} supplied`);
    }
    for (const [i, choice] of choices.entries()) {
      if (choice.length > CHOICE_LABEL_MAX) {
        problems.push(`answer choice ${i + 1} exceeds ${CHOICE_LABEL_MAX} characters`);
      }
    }
    const seen = new Set(choices.map((c) => c.toLowerCase()));
    if (seen.size !== choices.length) problems.push("answer choices must be distinct");
  }

  const placement = PLACEMENTS[raw.placement] ? raw.placement : format.placement;

  return {
    interaction: Object.freeze({
      format: formatId,
      question,
      context,
      choices: Object.freeze(choices),
      engagementPrompt,
      placement,
    }),
    problems,
  };
}

/** Which required interaction fields still need the founder (approval gate). */
export function interactionCompleteness(interaction) {
  const missing = [];
  const format = INTERACTION_FORMATS[interaction?.format];
  if (!format) return { missing: ["interaction format"], complete: false };
  if (!isStr(interaction.question)) missing.push("interaction question");
  if (format.roles.includes("engagement") && !isStr(interaction.engagementPrompt)) {
    missing.push("engagement prompt");
  }
  const rule = choiceRule(interaction.format);
  if (rule.mode === "required" && (interaction.choices || []).length < rule.min) {
    missing.push("answer choices");
  }
  return { missing, complete: missing.length === 0 };
}

/** How many required sections an interaction format contributes to the
 *  desk's completeness meter: the question, plus its invitation, plus the
 *  answer choices when the format cannot work without them. */
export function interactionRequiredSections(formatId) {
  const format = INTERACTION_FORMATS[formatId];
  if (!format) return 1;                      // the format itself is the gap
  let total = 1;                              // the question
  if (format.roles.includes("engagement")) total += 1;
  if (format.choices === "required") total += 1;
  return total;
}

/**
 * The slides an interactive post renders through, derived from the structured
 * interaction. ONE SOURCE OF TRUTH: the founder edits the interaction fields
 * and the slides follow, so a question can never disagree with the slide that
 * draws it — which is exactly how the old "question buried in a reflection
 * slide" arrangement drifted.
 */
export function interactiveSlides(interaction, { headline = "" } = {}) {
  const format = INTERACTION_FORMATS[interaction?.format] || INTERACTION_FORMATS[DEFAULT_INTERACTION_FORMAT];
  const choices = Array.isArray(interaction?.choices) ? interaction.choices : [];
  const roles = format.roles.filter((role) => role !== "choices" || choices.length >= 2);
  return roles.map((role) => {
    if (role === "hero") return { role, heading: headline, body: String(interaction?.context || "") };
    if (role === "question") return { role, heading: "A question", body: String(interaction?.question || "") };
    if (role === "choices") return { role, heading: "Choose one", body: choices.join("\n") };
    return { role, heading: "Your turn", body: String(interaction?.engagementPrompt || "") };
  });
}

/**
 * The manual interactive scaffold. Derived fields arrive finished; every
 * interpretive field arrives EMPTY with its guidance carried in `suggestions`
 * — the same publishable-or-empty rule the reading scaffold follows, so
 * worksheet text can never reach stored copy or an export.
 *
 * @param {object} candidate verified, engine-built
 * @param {object} opts { interactionFormat, altText, headline }
 */
export function buildInteractiveScaffold(candidate, {
  interactionFormat: formatId = DEFAULT_INTERACTION_FORMAT,
  headline = "",
  altText = "",
} = {}) {
  const format = INTERACTION_FORMATS[formatId] || INTERACTION_FORMATS[DEFAULT_INTERACTION_FORMAT];
  const rule = choiceRule(format.id);
  const interaction = {
    format: format.id,
    question: "",
    context: "",
    choices: rule.mode === "required" ? Array.from({ length: rule.min }, () => "") : [],
    engagementPrompt: "",
    placement: format.placement,
  };
  const post = {
    format: "interactive_post",
    headline,
    subhead: "",
    interaction,
    slides: interactiveSlides({ ...interaction, choices: [] }, { headline }),
    caption: "",
    cta: "",
    altText,
    editorialNotes: ["manual interactive post",
      "the question is editorial; the sky behind it is engine output"],
    // The founder default, applied openly and changeable per draft — the
    // same rule the cadence readings follow.
    design: { aspect: "portrait", template: recommendTemplate("interactive", "interactive_post"), density: "standard" },
  };
  const suggestions = {
    headline: [],
    interaction: {
      format: format.id,
      helper: format.blurb,
      questionHelper: format.questionHelper,
      engagementHelper: format.engagementHelper,
      choiceRule: rule,
      placements: PLACEMENTS,
    },
    slides: post.slides.map((slide) => ({ role: slide.role, helper: "", placeholder: "", suggestions: [] })),
    caption: { helper: "Repeat the question in the caption — most answers are typed there, not on the slide." },
  };
  return { post, suggestions };
}
