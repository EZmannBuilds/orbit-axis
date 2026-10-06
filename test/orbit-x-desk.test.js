// Orbit X :: the publishing workspace (Dev Update 5.6).
//
// WHY THIS FILE EXISTS, AND WHAT IT REFUSES TO DO. Orbit has no bundler and no
// jsdom, so the older desk tests could only regex ui.html — assertions that a
// string is present, never that anything happens. Two boot-killing bugs have
// already shipped past exactly that kind of green.
//
// So the redesign put its meaning in lib/orbit-x/desk.js and
// lib/orbit-x/interactive.js — plain modules the browser imports and this file
// EXECUTES. Stage order, library titles, status vocabulary, the readable fact
// summary, interaction validation, and the interactive renderer are tested by
// running them. The handful of assertions that must remain source-level are
// CSS and markup contracts, and each says which browser check actually proved
// it (wide desktop, 1024, and 390×844 were all driven live).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  STAGES, STAGE_IDS, availableStages, VIEWS,
  STATUS_LABELS, statusLabel, statusTone, READY_STATUS, READY_ACTION_LABEL,
  humanEventTitle, libraryEntry, periodLabelFor, typeLabelFor, templateLabelFor,
  matchesKindFilter, LIBRARY_STATUS_FILTERS, LIBRARY_KIND_FILTERS,
  START_ACTIONS, recommendationView, factSummary,
  PREVIEW_MODES, PREVIEW_MODE_IDS, saveStateLabel, saveStateTone,
  fieldGroupsFor, cadenceTemplate,
} from "../lib/orbit-x/desk.js";
import {
  INTERACTION_FORMATS, INTERACTION_FORMAT_IDS, DEFAULT_INTERACTION_FORMAT,
  choiceRule, validateInteraction, interactionCompleteness, interactionRequiredSections,
  interactiveSlides, auditInteraction, buildInteractiveScaffold, CHOICE_LABEL_MAX,
} from "../lib/orbit-x/interactive.js";
import { validateGeneratedPost, draftCompleteness, OrbitXValidationError } from "../lib/orbit-x/schemas.js";
import { renderPost, TEMPLATE_FAMILY_IDS } from "../lib/orbit-x/templates.js";
import { FORMATS } from "../lib/orbit-x/formats.js";
import { handleOrbitXRoute } from "../lib/orbit-x/api.js";

const PAGE = readFileSync(new URL("../lib/orbit-x/ui.html", import.meta.url), "utf8");

/* ── Stage navigation ───────────────────────────────────────────────────── */

test("the workspace is three ordered stages, and two of them need a draft first", () => {
  assert.deepEqual(STAGE_IDS, ["choose", "write", "preview"]);
  assert.deepEqual(STAGES.map((s) => s.label), ["Choose", "Write", "Preview"]);
  // With nothing being drafted, Write and Preview are not offered: the old
  // desk showed an empty editor beside an empty preview from the first paint.
  assert.deepEqual(availableStages(false), ["choose"]);
  assert.deepEqual(availableStages(true), ["choose", "write", "preview"]);
  assert.deepEqual(VIEWS, ["workspace", "library"]);

  // And the page actually navigates them: a stage button per stage, marked
  // with aria-current="step", disabled until a draft unlocks it.
  assert.match(PAGE, /data-stage="\$\{s\.id\}"/, "one button per stage, generated from STAGES");
  assert.match(PAGE, /aria-current="step"/);
  assert.match(PAGE, /allowed\.includes\(s\.id\) \? "" : "disabled"/,
    "a locked stage is disabled, not merely styled as unavailable");
  assert.match(PAGE, /button\.onclick = \(\) => setStage\(button\.getAttribute\("data-stage"\)\)/);
});

test("the five start actions are the whole Choose stage, and the date control is not duplicated", () => {
  assert.deepEqual(START_ACTIONS.map((a) => a.id), ["daily", "weekly", "monthly", "special", "interactive"]);
  // The old page carried a date row (Date / Today / Tomorrow / Load) AND a
  // separate Collective Readings bar with its own Today/This Week/This Month.
  assert.equal([...PAGE.matchAll(/id="x-date"/g)].length, 1, "one date input");
  assert.equal([...PAGE.matchAll(/id="x-today"/g)].length, 1, "one Today control");
  assert.ok(!/data-reading="/.test(PAGE), "the duplicate Collective Readings bar is gone");
  assert.ok(!/id="x-tomorrow"/.test(PAGE), "the third date shortcut is gone with it");
});

/* ── The solo lifecycle ─────────────────────────────────────────────────── */

test("solo status labels rename the lifecycle without touching a stored status", () => {
  assert.equal(statusLabel("draft"), "Draft");
  assert.equal(statusLabel("approved"), "Ready to Post");
  assert.equal(statusLabel("exported"), "Exported");
  assert.equal(statusLabel("rejected"), "Needs changes");
  // Nothing is removed: the reserved publisher states still have names, so a
  // row written by a future publisher never renders as a blank pill.
  assert.equal(statusLabel("scheduled"), "Scheduled");
  assert.equal(statusLabel("published"), "Published");
  assert.equal(statusLabel("failed"), "Failed");
  assert.equal(statusLabel(undefined), "Draft");

  // THE LINE THAT MATTERS: the API vocabulary is untouched. "Mark ready to
  // post" writes `approved`, which is what the database, the RLS policies and
  // the one-live-period index all still understand.
  assert.equal(READY_STATUS, "approved");
  assert.equal(READY_ACTION_LABEL, "Mark ready to post");
  assert.equal(STATUS_LABELS.approved, "Ready to Post");
  assert.equal(statusTone("approved"), "ready");
  assert.equal(statusTone("rejected"), "warn");

  // Rejection lives in an optional review section, not the primary action row.
  const bar = PAGE.slice(PAGE.indexOf('class="x-actionbar"'), PAGE.indexOf("</div>\n\n<!-- ── Template Lab"));
  assert.ok(!/x-reject|Reject/i.test(bar), "no moderation control in the sticky action bar");
  assert.match(PAGE, /<summary>Review &amp; set aside<\/summary>/,
    "review tools are a disclosure inside the Preview stage");
});

/* ── The Library ────────────────────────────────────────────────────────── */

test("a raw event key is never the label a person reads", () => {
  assert.equal(humanEventTitle("full_moon:2026-08-27"), "Full Moon · August 27, 2026");
  assert.equal(humanEventTitle("new_moon:2026-09-10"), "New Moon · September 10, 2026");
  assert.equal(humanEventTitle("daily:2026-08-22"), "Daily Reading · August 22, 2026");
  assert.equal(humanEventTitle("weekly:2026-08-17:2026-08-23"), "Weekly Reading · August 17–August 23, 2026");
  assert.equal(humanEventTitle("monthly:2026-08"), "Monthly Reading · August 2026");
  assert.equal(humanEventTitle("interactive:2026-08-22"), "Interactive Post · August 22, 2026");
  // An unknown key is shown as itself rather than invented into a false name.
  assert.equal(humanEventTitle("something_new:2027-01-01"), "something_new:2027-01-01");
  assert.equal(humanEventTitle(""), "Untitled");
});

test("a Library entry carries a title, a type, a period, a status, and a template", () => {
  const row = {
    id: "11111111-2222-4333-8444-555555555555",
    event_key: "daily:2026-08-22",
    selected_format: "daily_reading",
    status: "approved",
    template_family: "lunar_field",
    template_version: "v1",
    updated_at: "2026-08-22T18:00:00.000Z",
    event_payload: { facts: { period: { label: "August 22, 2026", type: "daily" } } },
    edited_copy: { reading: { theme: "Most of this sky is moving forward", periodLabel: "August 22, 2026" },
      slides: [{ role: "cover", heading: "DAILY READING", body: "Three slow planets are not." }] },
  };
  const entry = libraryEntry(row);
  assert.equal(entry.title, "Most of this sky is moving forward", "the authored theme wins over the key");
  assert.equal(entry.typeLabel, "Daily Reading");
  assert.equal(entry.periodLabel, "August 22, 2026");
  assert.equal(entry.statusLabel, "Ready to Post");
  assert.equal(entry.statusTone, "ready");
  assert.equal(entry.templateLabel, "Lunar Field v1");
  assert.equal(entry.openLabel, "Open draft");
  assert.ok(entry.thumbnailCopy, "a saved item with slides can draw a thumbnail");
  // The key survives — as detail, not as the label.
  assert.equal(entry.eventKey, "daily:2026-08-22");
  assert.notEqual(entry.title, entry.eventKey);

  // With no authored copy the key still becomes a sentence.
  assert.equal(libraryEntry({ event_key: "full_moon:2026-08-27", selected_format: "something_changed",
    status: "draft" }).title, "Full Moon · August 27, 2026");
});

test("an interactive item names the kind of question it asks", () => {
  const row = { event_key: "interactive:2026-08-22", selected_format: "interactive_post", status: "draft",
    edited_copy: { headline: "Which pace?", interaction: { format: "this_or_that" }, slides: [] } };
  assert.equal(typeLabelFor(row), "Interactive · This or that");
  assert.equal(periodLabelFor(row), "August 22, 2026");
  assert.equal(templateLabelFor({ ...row, template_family: "orbit_signal", template_version: "v1" }), "Orbit Signal v1");
});

test("the Library filters cover every first-class kind and fall back honestly", () => {
  assert.deepEqual(LIBRARY_STATUS_FILTERS.map((f) => f.label),
    ["All statuses", "Draft", "Ready to Post", "Exported", "Needs changes"]);
  assert.deepEqual(LIBRARY_KIND_FILTERS.map((f) => f.value),
    ["", "daily_reading", "weekly_reading", "monthly_reading", "interactive_post", "other"]);
  assert.ok(matchesKindFilter({ selected_format: "daily_reading" }, ""));
  assert.ok(matchesKindFilter({ selected_format: "interactive_post" }, "interactive_post"));
  assert.ok(!matchesKindFilter({ selected_format: "interactive_post" }, "daily_reading"));
  assert.ok(matchesKindFilter({ selected_format: "something_changed" }, "other"));
  assert.ok(!matchesKindFilter({ selected_format: "monthly_reading" }, "other"));
});

test("the Library is a top-level view of cards, not a table inside the candidate panel", () => {
  assert.match(PAGE, /<div id="x-library" hidden>/, "the Library is its own view");
  assert.match(PAGE, /data-view="library"/, "and is reachable from the top bar, not from a stage");
  assert.match(PAGE, /class="x-lib-cards" id="x-lib-list"/);
  // Verified live at 390×844: cards, not a compressed table. The old desk
  // rendered <table class="x-hist"> with six columns inside the Candidates
  // panel, which on a phone was a horizontally scrolling grid of stubs.
  assert.ok(!/<table/.test(PAGE), "no table survives anywhere on the page");
  assert.ok(!/x-hist/.test(PAGE), "and neither does the history table's styling");
  assert.match(PAGE, /\.x-lib-cards \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(290px, 1fr\)\)/,
    "saved items reflow to one column on a phone");
  assert.match(PAGE, /\.x-lib-card \{[\s\S]{0,220}grid-template-columns: 104px minmax\(0, 1fr\)/,
    "the thumbnail sits BESIDE the text, so Open draft is reachable without scrolling a portrait slide");
  assert.match(PAGE, /aria-label="Open draft: \$\{esc\(entry\.title\)\}"/,
    "every Open action names which item it opens");
});

/* ── Recommendations ────────────────────────────────────────────────────── */

const REC_ENTRY = Object.freeze({
  candidate: { eventKey: "full_moon:2026-08-27", eventType: "full_moon", title: "Full Moon in Pisces",
    timestamp: "2026-08-27T20:13:00.000Z", facts: { date: "2026-08-27" } },
  score: { totalScore: 21, maxScore: 25, reasons: ["strong event", "not recently covered", "visually clear"] },
  suggestedFormat: "something_changed",
  coverage: [],
});

test("a recommendation card shows a title, a timing, a template, ONE reason — and hides the rest", () => {
  const v = recommendationView(REC_ENTRY, { recommendedTemplate: "orbit_signal" });
  assert.equal(v.title, "Full Moon in Pisces");
  assert.equal(v.timing, "August 27, 2026");
  assert.equal(v.formatName, "Something Changed");
  assert.equal(v.templateName, "Orbit Signal");
  assert.equal(v.reason, "strong event", "one short reason on the face of the card");
  assert.equal(v.actionLabel, "Start draft");
  assert.equal(v.hasDraft, false);

  // Everything engineering-shaped is behind Details: the key, the ISO
  // instant, the numeric score, and the full scoring explanation.
  assert.equal(v.details.eventKey, "full_moon:2026-08-27");
  assert.equal(v.details.timestamp, "2026-08-27T20:13:00.000Z");
  assert.equal(v.details.score, 21);
  assert.deepEqual([...v.details.reasons], ["strong event", "not recently covered", "visually clear"]);
  assert.match(PAGE, /<summary>Details<\/summary>/, "the card renders them inside a disclosure");
});

test("an event that already has a draft is a neutral state, never a red error", () => {
  const v = recommendationView({ ...REC_ENTRY, coverage: [{ id: "abc", status: "approved" }] },
    { recommendedTemplate: "orbit_signal" });
  assert.equal(v.hasDraft, true);
  assert.equal(v.draftStatusLabel, "Ready to Post");
  assert.equal(v.actionLabel, "Open draft", "'Manual draft' is replaced by the thing you actually want");
  assert.equal(v.draftId, "abc");
  // The old card set `x-cand--dup` whose only rule was border-color:
  // var(--color-error) — a red box around work you had already done well.
  assert.ok(!/x-cand--dup/.test(PAGE));
  assert.match(PAGE, /x-pill--ready">Draft exists/, "it reads as a state, in the accent, not the error colour");
});

test("manual mode is a calm indicator, not a sentence of provider plumbing", () => {
  assert.ok(!/manual drafting \(no AI provider configured\)/.test(PAGE),
    "the old status-line apology is gone");
  assert.match(PAGE, /<span class="x-pill" id="x-mode" hidden>Manual mode<\/span>/);
  assert.match(PAGE, /\$\("#x-mode"\)\.hidden = aiAvailable;/, "the chip appears only when no provider exists");
  // The provider detail still exists — under Diagnostics, where a detail belongs.
  assert.match(PAGE, /<summary>Diagnostics<\/summary>/);
  assert.match(PAGE, /"AI provider": aiAvailable \? "configured" : "not configured/);
  // And no secret ever travels with it.
  assert.ok(!/sk_(live|test)|whsec_|ORBIT_X_AI_API_KEY|service.role/i.test(PAGE));
});

/* ── Verified facts, readable ───────────────────────────────────────────── */

const READING_CANDIDATE = Object.freeze({
  eventKey: "daily:2026-08-22",
  eventType: "collective_reading",
  facts: {
    period: { type: "daily", key: "daily:2026-08-22", label: "August 22, 2026",
      timezone: "America/Chicago", start_date: "2026-08-22", end_date: "2026-08-22" },
    local_date: "2026-08-22",
    moon_phase_name: "Waxing Gibbous",
    illumination_percent: 69.5,
    is_waxing: true,
    moon_sign: "Sagittarius",
    planets: [
      { name: "Mercury", sign: "Leo", degrees: 23.4, retrograde: false },
      { name: "Sun", sign: "Leo", degrees: 29.2, retrograde: false },
      { name: "Saturn", sign: "Aries", degrees: 14.8, retrograde: true },
    ],
    selected_events: [
      { key: "full_moon:2026-08-27", kind: "full_moon", date: "2026-08-27",
        title: "Full Moon", approximate: false, sky_at_event: { moon_sign: "Pisces" } },
      { key: "mercury_rx:2026-08-30", kind: "mercury_rx", date: "2026-08-30",
        title: "Mercury stations retrograde", approximate: true },
    ],
    source_note: "Astronomical facts calculated by the Orbit Axis deterministic engine. Symbolic copy is editorial.",
  },
});

test("the verified packet becomes readable groups — without changing one fact", () => {
  const s = factSummary(READING_CANDIDATE);
  const flat = Object.fromEntries(s.groups.flatMap((g) => g.items).map((i) => [i.label, i.value]));
  assert.equal(flat["daily period"], "August 22, 2026");
  assert.equal(flat["Editorial timezone"], "America/Chicago");
  assert.equal(flat["Moon phase"], "Waxing Gibbous");
  assert.equal(flat["Moon sign"], "Sagittarius");
  assert.equal(flat.Illumination, "70% · waxing");

  // Planets read as a compact register, in canonical order, retrogrades marked.
  assert.deepEqual(s.planets.map((p) => `${p.name} ${p.value}`),
    ["Sun Leo 29°", "Mercury Leo 23°", "Saturn Aries 14° ℞"]);

  // Selected movements are dated for humans, and an approximate source says so.
  assert.deepEqual(s.events.map((e) => e.when), ["August 27, 2026", "Around August 30, 2026"]);
  assert.equal(s.events[0].sign, "Pisces");
  assert.match(s.sourceNote, /calculated by the Orbit Axis deterministic engine/);
});

test("a fact the engine did not supply is absent, never defaulted into existence", () => {
  const s = factSummary({ eventKey: "educational:stock", facts: {} });
  const labels = s.groups.flatMap((g) => g.items).map((i) => i.label);
  assert.ok(!labels.includes("Illumination"), "no illumination is not 0%");
  assert.ok(!labels.includes("Moon phase"));
  assert.deepEqual([...s.planets], []);
  assert.deepEqual([...s.events], []);
  // A sky with no moon facts renders no Moon group at all rather than an
  // empty one — absence over invention, the same rule the renderer follows.
  assert.ok(!s.groups.some((g) => g.id === "moon"));
});

test("the raw packet stays one disclosure away, and the panel stays read-only", () => {
  assert.match(PAGE, /<summary>View raw engine data<\/summary>/);
  assert.match(PAGE, /<pre>\$\{esc\(JSON\.stringify\(current\.candidate\.facts \?\? \{\}, null, 2\)\)\}<\/pre>/);
  assert.match(PAGE, /aria-label="Verified engine facts — read only"/);
  // Nothing in the facts panel is an input: there is no affordance for editing
  // astronomy, which is the point.
  const panel = PAGE.slice(PAGE.indexOf("function factsPanel()"), PAGE.indexOf("function templateBar()"));
  assert.ok(!/<input|<textarea|contenteditable/.test(panel), "the facts panel has no editable field");
  // And the old key: <JSON.stringify(value)> dump is gone.
  assert.ok(!/<strong>\$\{esc\(k\)\}<\/strong>: \$\{esc\(JSON\.stringify\(v\)\)\}/.test(PAGE));
});

/* ── Templates ──────────────────────────────────────────────────────────── */

test("each cadence opens on its founder default, named rather than quietly applied", () => {
  assert.equal(cadenceTemplate("daily_reading").id, "lunar_field");
  assert.equal(cadenceTemplate("weekly_reading").id, "planetary_grid");
  assert.equal(cadenceTemplate("monthly_reading").id, "orbit_signal");
  assert.equal(cadenceTemplate("something_changed").id, "orbit_signal");
  assert.equal(cadenceTemplate("interactive_post", "interactive").id, "orbit_signal");
  assert.equal(cadenceTemplate("daily_reading").name, "Lunar Field");
  assert.equal(cadenceTemplate("daily_reading").version, "v1");

  // The main writing flow shows ONE template and a way to change it. It used
  // to stack a grid of full first-slide renders for every template inline.
  assert.match(PAGE, /Cadence default/);
  assert.match(PAGE, /id="e-change-tpl"[^>]*>Change template/);
  assert.ok(!/x-tpl-cards/.test(PAGE), "the inline grid of full previews is gone from the editor");
});

test("Template Lab is a real dialog: brought into view, keyboard-navigable, with a way back", () => {
  assert.match(PAGE, /<dialog class="x-modal" id="x-lab" aria-labelledby="x-lab-title">/,
    "a native dialog, so focus is trapped and Escape closes without hand-rolled key handling");
  assert.match(PAGE, /dialog\.showModal\(\)/, "opened modally — the old lab rendered below the fold and never scrolled to");
  assert.match(PAGE, /\$\("#x-lab-close"\)\.focus\(\);/, "focus moves into the dialog");
  assert.match(PAGE, /labOpener = opener \|\|/, "and returns to whatever opened it");
  assert.match(PAGE, /id="x-lab-close"/, "an obvious close control");
  assert.match(PAGE, /Compare all five founder families/, "the five-way comparison is preserved");
  assert.match(PAGE, /data-use-family="\$\{id\}"/);
  assert.match(PAGE, /Use for this draft/);
  // Selecting a family returns to the editor and SAYS what changed — a silent
  // state change is indistinguishable from a dead button.
  const chooser = PAGE.slice(PAGE.indexOf('for (const button of $$("[data-use-family]"))'), PAGE.indexOf("function closeTemplateLab()"));
  assert.match(chooser, /closeTemplateLab\(\)/);
  assert.match(chooser, /status\(`Template set to /);
  assert.match(chooser, /setStage\("write"\)/);
  assert.equal(TEMPLATE_FAMILY_IDS.length, 5);
});

/* ── The Write stage ────────────────────────────────────────────────────── */

test("editor fields are grouped, and the interactive group appears only when it applies", () => {
  assert.deepEqual(fieldGroupsFor("daily_reading").map((g) => g.id),
    ["hook", "content", "caption", "accessibility", "notes"]);
  assert.deepEqual(fieldGroupsFor("interactive_post").map((g) => g.id),
    ["hook", "interaction", "content", "caption", "accessibility", "notes"]);
  assert.equal(fieldGroupsFor("interactive_post").find((g) => g.id === "content").label, "Slides");
  assert.match(PAGE, /<details class="x-group"/, "each group collapses");

  // "Hand off to a writer" is not a thing a solo founder does. The capability
  // survives as optional assistance, inside the collapsed Notes group.
  assert.ok(!/Hand off to a writer/.test(PAGE));
  assert.match(PAGE, /<summary>Writing assistance — draft elsewhere, import back<\/summary>/);
  const notesGroup = PAGE.slice(PAGE.indexOf('${group("notes"'), PAGE.indexOf('${group("design"'));
  assert.match(notesGroup, /e-handoff/, "the brief lives inside the Notes group");
  assert.match(PAGE, /group\("notes"[\s\S]*?, false\)\}/, "and that group starts collapsed");
});

test("the field you are editing is connected to the slide it draws", () => {
  assert.match(PAGE, /data-slide-role="one_sentence"/);
  assert.match(PAGE, /data-slide-role="question"/);
  assert.match(PAGE, /data-slide-index="\$\{i\}"/);
  assert.match(PAGE, /addEventListener\("focusin"/, "focus decides which slide is highlighted");
  assert.match(PAGE, /function highlightSlide\(\)/);
  assert.match(PAGE, /\.x-slides \.is-focused svg \{ border-color: var\(--color-accent\); \}/);
});

/* ── Dirty / saved state ────────────────────────────────────────────────── */

test("the sticky bar states exactly one of: unsaved, saving, saved", () => {
  assert.equal(saveStateLabel({}), "Not saved yet");
  assert.equal(saveStateLabel({ dirty: true }), "Unsaved changes");
  assert.equal(saveStateLabel({ saving: true, dirty: true }), "Saving…", "saving wins while it is happening");
  assert.equal(saveStateLabel({ savedAt: "02:19 PM" }), "Saved at 02:19 PM");
  // A draft reopened from the Library is saved — it was just not saved in
  // this session, and "Not saved yet" about stored work is a small lie.
  assert.equal(saveStateLabel({ saved: true }), "Saved");
  assert.equal(saveStateTone({ dirty: true }), "warn");
  assert.equal(saveStateTone({ saving: true }), "busy");
  assert.equal(saveStateTone({ savedAt: "02:19 PM" }), "done");
  assert.equal(saveStateTone({}), "neutral");

  // The bar is sticky, carries the three named actions, and groups the rest.
  assert.match(PAGE, /\.x-actionbar \{ position: fixed; left: 0; right: 0; bottom: 0;/);
  assert.match(PAGE, /id="x-save">Save draft</);
  assert.match(PAGE, /id="x-goto-preview">Preview</);
  assert.match(PAGE, /id="x-export">Export</);
  assert.match(PAGE, /id="x-copy-caption">Copy caption</);
  assert.match(PAGE, /id="x-copy-alt">Copy alt text</);
  assert.match(PAGE, /<summary aria-label="More draft actions">More<\/summary>/);

  // SAVING STAYS EXPLICIT. Nothing may write on a keystroke: the input
  // handler marks the draft dirty and stops there.
  assert.match(PAGE, /function touch\(\) \{\s*saveState = \{ \.\.\.saveState, dirty: true \};\s*refresh\(\);\s*\}/);
  const touchBody = PAGE.slice(PAGE.indexOf("function touch()"), PAGE.indexOf("function refresh()"));
  assert.ok(!/api\(|fetch\(/.test(touchBody), "editing never triggers a write, so nothing can be overwritten by typing");
});

test("one labelled Preview Mode selector replaces three unlabelled buttons", () => {
  assert.deepEqual(PREVIEW_MODE_IDS, ["full", "feed", "sim"]);
  assert.deepEqual(PREVIEW_MODES.map((m) => m.label),
    ["Full size", "Feed width (375px)", "Simulated feed post"]);
  assert.match(PAGE, /<label for="x-preview-mode">Preview mode<\/label>/);
  assert.match(PAGE, /<select id="x-preview-mode"/);
  assert.ok(!/data-pv=/.test(PAGE), "the three-button row is gone");
});

/* ── Interactive posts ──────────────────────────────────────────────────── */

test("all eight interaction formats exist, each declaring its own answer contract", () => {
  assert.deepEqual(INTERACTION_FORMAT_IDS, ["open_question", "two_choice_poll", "this_or_that",
    "finish_the_sentence", "emoji_response", "save_and_return", "story_question", "carousel_reflection"]);
  assert.equal(DEFAULT_INTERACTION_FORMAT, "open_question");
  for (const format of Object.values(INTERACTION_FORMATS)) {
    assert.ok(["required", "optional", "none"].includes(format.choices), format.id);
    assert.ok(format.roles.includes("question"), `${format.id} asks something`);
    assert.ok(format.name && format.blurb, format.id);
  }
  assert.deepEqual(choiceRule("two_choice_poll"), { mode: "required", min: 2, max: 2 });
  assert.deepEqual(choiceRule("this_or_that"), { mode: "required", min: 2, max: 4 });
  assert.deepEqual(choiceRule("open_question"), { mode: "none", min: 0, max: 0 });
  assert.deepEqual(choiceRule("emoji_response"), { mode: "optional", min: 2, max: 4 });
  // Interactive is a real format with its own contract, beside the eight
  // existing ones — nothing was repurposed.
  assert.equal(FORMATS.interactive_post.interactive, true);
  assert.equal(FORMATS.interactive_post.requiresEvent, false);
});

test("a poll without valid answers cannot be finished; an open question needs none", () => {
  // Polls and this-or-that REQUIRE choices at the approval gate.
  assert.deepEqual(interactionCompleteness({ format: "two_choice_poll", question: "Which?",
    engagementPrompt: "Tap one.", choices: ["A"] }).missing, ["answer choices"]);
  assert.equal(interactionCompleteness({ format: "two_choice_poll", question: "Which?",
    engagementPrompt: "Tap one.", choices: ["Still building", "Already landing"] }).complete, true);
  assert.equal(interactionCompleteness({ format: "this_or_that", question: "Which?",
    engagementPrompt: "Say the letter.", choices: ["One"] }).complete, false);

  // An open question is complete without any choices at all.
  assert.equal(interactionCompleteness({ format: "open_question", question: "What are you noticing?",
    engagementPrompt: "Reply in the comments.", choices: [] }).complete, true);

  // A finished poll is refused by validation when the count is wrong.
  const bad = validateInteraction({ format: "two_choice_poll", question: "Which?",
    engagementPrompt: "Tap one.", choices: ["only one"] }, { requireComplete: true });
  assert.ok(bad.problems.some((p) => /needs exactly 2 answer choices/.test(p)));

  // Shapes that can never become valid are refused even mid-draft.
  assert.ok(validateInteraction({ format: "two_choice_poll", choices: ["a", "A"] },
    { requireComplete: false }).problems.includes("answer choices must be distinct"));
  assert.ok(validateInteraction({ format: "open_question", choices: ["nope"] },
    { requireComplete: false }).problems.some((p) => /takes no answer choices/.test(p)));
  assert.ok(validateInteraction({ format: "this_or_that", choices: ["a", "b".repeat(CHOICE_LABEL_MAX + 1)] },
    { requireComplete: false }).problems.some((p) => /exceeds 48 characters/.test(p)));

  // But a count that is simply still being typed is a DRAFT, not an error:
  // the scaffold itself starts with none, and refusing there makes the field
  // unusable.
  assert.deepEqual(validateInteraction({ format: "two_choice_poll", choices: [] },
    { requireComplete: false }).problems, []);
  assert.equal(interactionRequiredSections("two_choice_poll"), 3);
  assert.equal(interactionRequiredSections("open_question"), 2);
  assert.equal(interactionRequiredSections("story_question"), 1);
});

test("a question may be curious; it may not predict or diagnose", () => {
  const predictive = auditInteraction({ format: "open_question",
    question: "When will you meet the person you're waiting for?" });
  assert.equal(predictive[0]?.rule, "predictive_question");
  assert.equal(predictive[0]?.path, "interaction.question");

  const diagnostic = auditInteraction({ format: "open_question",
    question: "Do you have anxiety, or is it the sky?" });
  assert.equal(diagnostic[0]?.rule, "diagnostic_question");

  const bait = auditInteraction({ format: "open_question", question: "What are you noticing?",
    engagementPrompt: "Tag three friends who need this." });
  assert.equal(bait[0]?.rule, "engagement_bait_question");
  assert.equal(bait[0]?.path, "interaction.engagementPrompt");

  // And ordinary, well-formed questions pass untouched.
  assert.deepEqual(auditInteraction({ format: "this_or_that",
    question: "Which pace feels more true for you right now?",
    context: "Two answers, one sky.",
    engagementPrompt: "Reply with A or B.",
    choices: ["Still building", "Already landing"] }), []);
});

test("the interaction is the source of truth — the slides are computed from it", () => {
  const interaction = { format: "this_or_that", question: "Which pace feels more true?",
    context: "Two answers, one sky.", engagementPrompt: "Reply with A or B.",
    choices: ["Still building", "Already landing"], placement: "feed_carousel" };
  const slides = interactiveSlides(interaction, { headline: "A question for August 22" });
  assert.deepEqual(slides.map((s) => s.role), ["hero", "question", "choices", "engagement"]);
  assert.equal(slides[1].body, "Which pace feels more true?");
  assert.equal(slides[2].body, "Still building\nAlready landing");

  // An open question renders no answer slide at all rather than an empty one.
  assert.deepEqual(interactiveSlides({ format: "open_question", question: "What changed?" })
    .map((s) => s.role), ["hero", "question", "engagement"]);

  // And validation RECOMPUTES them, so stored slides can never disagree with
  // the stored question — the same principle as facts never coming from the
  // browser, applied to the question.
  const post = validateGeneratedPost({
    format: "interactive_post", headline: "A question for August 22", interaction,
    slides: [{ role: "question", heading: "wrong", body: "a question nobody asked" }],
    caption: "Two answers, one sky.", cta: "",
    altText: "A question slide with two lettered answer rows.",
  }, "interactive_post");
  assert.equal(post.slides.length, 4);
  assert.equal(post.slides[1].body, "Which pace feels more true?");
  assert.deepEqual([...post.interaction.choices], ["Still building", "Already landing"]);
  assert.equal(draftCompleteness(post).complete, true);
});

test("an interactive post renders through the existing template system", () => {
  const { post: scaffold } = buildInteractiveScaffold(READING_CANDIDATE,
    { interactionFormat: "this_or_that", headline: "A question for August 22, 2026", altText: "Alt." });
  // The founder default is applied openly, and remains changeable per draft.
  assert.equal(scaffold.design.template, "orbit_signal");
  assert.equal(scaffold.design.aspect, "portrait");

  const post = validateGeneratedPost({ ...scaffold,
    interaction: { format: "this_or_that", question: "Which pace feels more true for you right now?",
      context: "Two answers, one sky.", engagementPrompt: "Reply with A or B.",
      choices: ["Still building", "Already landing"] },
    caption: "Two answers, one sky.",
    altText: "A bold portrait slide asking which pace feels truer, with two lettered answer rows.",
  }, "interactive_post");

  const rendered = renderPost(post, { eventType: "interactive", title: "Interactive Post",
    facts: READING_CANDIDATE.facts, sky: READING_CANDIDATE.facts.planets });
  assert.equal(rendered.slides.length, 4);
  assert.deepEqual(rendered.warnings, [], "the founder template holds this question without a warning");
  for (const slide of rendered.slides) {
    assert.match(slide.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1080 1350"/);
  }
  const choicesSvg = rendered.slides[2].svg;
  assert.match(choicesSvg, /Still building/);
  assert.match(choicesSvg, /Already landing/);
  assert.match(choicesSvg, />A</, "answers are lettered A and B");
  assert.match(choicesSvg, />B</);

  // Every family can draw it, which is what "change the template" has to mean.
  for (const family of TEMPLATE_FAMILY_IDS) {
    const r = renderPost({ ...post, design: { ...post.design, template: family } },
      { eventType: "interactive", facts: READING_CANDIDATE.facts, sky: READING_CANDIDATE.facts.planets });
    assert.equal(r.slides.length, 4, family);
    assert.deepEqual(r.warnings, [], `${family} renders the interactive post cleanly`);
  }
});

test("a choice slide with nothing to choose says so instead of drawing an empty frame", () => {
  const rendered = renderPost({ format: "interactive_post", headline: "A question",
    slides: [{ role: "choices", heading: "Choose one", body: "" }],
    design: { aspect: "portrait", template: "orbit_signal" } },
  { eventType: "interactive", facts: {}, sky: [] });
  assert.deepEqual(rendered.warnings, ["This post has an answer-choice slide with no choices."]);
});

/* ── Existing formats and stored drafts stay valid ──────────────────────── */

test("adding the interactive format leaves every stored reading exactly as valid", () => {
  const reading = {
    format: "daily_reading", headline: "Most of this sky is moving forward",
    reading: { type: "daily", periodKey: "daily:2026-08-22", periodLabel: "August 22, 2026",
      theme: "Most of this sky is moving forward", oneSentence: "The pace is still building.",
      selectedEventKeys: [] },
    slides: [
      { role: "cover", heading: "DAILY READING", body: "Three slow planets are not." },
      { role: "one_sentence", heading: "Today in one sentence", body: "The pace is still building." },
      { role: "movements", heading: "What's moving", body: "Waxing Gibbous · Moon in Sagittarius." },
      { role: "reading", heading: "The reading", body: "A symbolic synthesis, attributed to tradition." },
      { role: "reflection", heading: "Carry this", body: "What becomes easier to notice?" },
      { role: "evidence", heading: "Sky behind the reading", body: "Sun · Leo" },
    ],
    caption: "A daily reading.", cta: "", altText: "A dark portrait slide with a calculated Moon.",
  };
  const post = validateGeneratedPost(reading, "daily_reading");
  assert.equal(post.slides.length, 6, "a stored reading's slides are its own, never recomputed");
  assert.equal(post.interaction, undefined, "and it grows no interaction block");
  assert.equal(draftCompleteness(post).complete, true);

  // An interactive post missing its interaction block is refused by name
  // rather than silently rendering as an empty carousel.
  assert.throws(() => validateGeneratedPost({ format: "interactive_post", headline: "x",
    slides: [], caption: "c", cta: "", altText: "a" }, "interactive_post"),
  (error) => error instanceof OrbitXValidationError
    && error.problems.includes("interactive post is missing its interaction block"));
});

/* ── The API lane: save, reopen, update in place ────────────────────────── */

const ENV = Object.freeze({ ORBIT_X_ENABLED: "true", ORBIT_X_EDITORIAL_TIMEZONE: "America/Chicago" });
const AUTH = Object.freeze({ ownerId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" });

function stubStore() {
  const rows = [];
  return {
    rows,
    isAdmin: async () => true,
    coverageFor: async () => [],
    history: async () => rows,
    byId: async (id) => rows.find((r) => r.id === id) || null,
    insert: async (row) => {
      const saved = { id: "11111111-2222-4333-8444-555555555555", ...row };
      rows.push(saved);
      return saved;
    },
    update: async (id, fields) => {
      const row = rows.find((r) => r.id === id);
      Object.assign(row, fields);
      return row;
    },
  };
}

test("an interactive post saves, reopens, and updates the SAME row", async () => {
  const store = stubStore();
  const query = new URLSearchParams("date=2026-08-22");
  const start = await handleOrbitXRoute("GET", "/api/orbit-x/interactive", query, {}, AUTH, { env: ENV, store });
  assert.equal(start.status, 200);
  assert.equal(start.body.candidate.eventKey, "interactive:2026-08-22");
  assert.equal(start.body.candidate.eventType, "interactive");
  assert.equal(start.body.candidate.readingType, null,
    "an interactive post is anchored to a calculated day but is not that day's reading");
  assert.equal(start.body.candidate.source, "orbit-engine");

  const manual = await handleOrbitXRoute("POST", "/api/orbit-x/manual", new URLSearchParams(),
    { eventKey: start.body.candidate.eventKey, date: "2026-08-22", format: "interactive_post",
      interactionFormat: "two_choice_poll" }, AUTH, { env: ENV, store });
  assert.equal(manual.status, 200);
  assert.equal(manual.body.post.interaction.format, "two_choice_poll");
  assert.ok(manual.body.completeness.missing.includes("interaction question"));

  const copy = { ...manual.body.post,
    headline: "A question for August 22, 2026",
    interaction: { format: "two_choice_poll", question: "Which pace feels more true today?",
      context: "", choices: ["Still building", "Already landing"],
      engagementPrompt: "Tap A or B.", placement: "story" },
    caption: "Two answers, one sky.",
    altText: "A question slide with two lettered answer rows." };
  const saved = await handleOrbitXRoute("POST", "/api/orbit-x/posts", new URLSearchParams(),
    { eventKey: start.body.candidate.eventKey, date: "2026-08-22", format: "interactive_post",
      copy, generatedCopy: null }, AUTH, { env: ENV, store });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.completeness.complete, true);

  const row = store.rows[0];
  assert.equal(row.event_type, "interactive");
  assert.equal(row.selected_format, "interactive_post");
  assert.equal(row.generated_copy, null, "human authorship stays a recorded fact");
  assert.equal(row.template_family, "orbit_signal");
  assert.equal(row.template_version, "v1");
  // SCHEMA COMPATIBILITY, THE LOAD-BEARING ASSERTION: reading_type has a CHECK
  // constraint of daily/weekly/monthly, and period_key owns the partial unique
  // index that lets one live record hold a reading period. An interactive post
  // writes neither, so it needs no migration and can never take the Daily
  // Reading's period out from under it.
  assert.equal(row.reading_type, null);
  assert.equal(row.period_key, null);
  assert.equal(row.period_start_at, null);
  assert.equal(row.period_end_at, null);

  // Reopening returns the packet and the copy the desk needs to continue.
  const reopened = await handleOrbitXRoute("GET", `/api/orbit-x/posts/${row.id}`, new URLSearchParams(),
    {}, AUTH, { env: ENV, store });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.post.edited_copy.interaction.question, "Which pace feels more true today?");
  assert.equal(libraryEntry(reopened.body.post).typeLabel, "Interactive · Two-choice poll");

  // And saving again UPDATES THAT ROW rather than minting a second one.
  const edited = { ...reopened.body.post.edited_copy,
    interaction: { ...reopened.body.post.edited_copy.interaction, question: "Which pace is truer this week?" } };
  const updated = await handleOrbitXRoute("PATCH", `/api/orbit-x/posts/${row.id}`, new URLSearchParams(),
    { copy: edited, notes: "second pass" }, AUTH, { env: ENV, store });
  assert.equal(updated.status, 200);
  assert.equal(store.rows.length, 1, "update in place — no duplicate row");
  assert.equal(store.rows[0].edited_copy.interaction.question, "Which pace is truer this week?");
  assert.equal(store.rows[0].editor_notes, "second pass");

  // The verified packet is untouched by every one of those writes.
  assert.equal(store.rows[0].event_payload.eventKey, "interactive:2026-08-22");
  assert.ok(store.rows[0].event_payload.facts.period.start_date === "2026-08-22");
});

test("a predictive question is refused at the HTTP boundary, not merely in the browser", async () => {
  const store = stubStore();
  const start = await handleOrbitXRoute("GET", "/api/orbit-x/interactive",
    new URLSearchParams("date=2026-08-22"), {}, AUTH, { env: ENV, store });
  const res = await handleOrbitXRoute("POST", "/api/orbit-x/posts", new URLSearchParams(),
    { eventKey: start.body.candidate.eventKey, date: "2026-08-22", format: "interactive_post",
      copy: { format: "interactive_post", headline: "A question",
        interaction: { format: "open_question", question: "When will you meet someone new?",
          engagementPrompt: "Reply below." },
        caption: "c", cta: "", altText: "a" } }, AUTH, { env: ENV, store });
  assert.equal(res.status, 422);
  assert.ok(res.body.findings.some((f) => f.rule === "predictive_question"));
  assert.equal(store.rows.length, 0, "nothing reached storage");
});

/* ── Responsive and accessibility contracts ─────────────────────────────── */

test("the narrow-screen CTA row stacks instead of collapsing the input", () => {
  // Driven live at 390×844: the CTA text field and its picker each measured
  // 330px and the picker sat below the input. The old markup gave the input
  // flex:1 beside a fixed 240px select, so on a phone the field you type in
  // was the one that shrank.
  assert.match(PAGE, /\.x-split \{ display: flex; gap: var\(--space-xs\); flex-wrap: wrap; \}/);
  assert.match(PAGE, /\.x-split > \* \{ flex: 1 1 240px; min-width: 0; \}/);
  const ctaBlock = PAGE.slice(PAGE.indexOf('<label for="e-cta">'), PAGE.indexOf('id="e-cta-pick"'));
  assert.ok(!/max-width:\s*\d+px/.test(ctaBlock), "no fixed width fights the flex basis");
  assert.match(PAGE, /<label for="e-cta">Call to action<\/label>/);
  assert.match(PAGE, /<label for="e-cta-pick">Suggested CTAs<\/label>/);
});

test("nothing may push the page sideways at a supported width", () => {
  // Measured live: document.scrollWidth === window.innerWidth at 1440, 1024
  // and 390. These are the two rules that keep it that way.
  assert.match(PAGE, /\.x-shell \*, \.x-modal \* \{ min-width: 0; \}/,
    "a long unbroken key or a wide preview cannot stretch its grid column");
  assert.match(PAGE, /\.x-slides \{ display: flex; gap: var\(--space-xs\); overflow-x: auto;/,
    "wide slide strips scroll inside their own container");
  assert.match(PAGE, /\.x-modal-body \{[^}]*overflow: auto;/);
  assert.match(PAGE, /\.x-raw pre \{ max-height: 280px; overflow: auto;/,
    "the raw packet scrolls rather than widening the page");
  assert.match(PAGE, /overflow-wrap: anywhere/);
});

test("every control has a name, focus is visible, and status changes are announced", () => {
  // Labels: every input/select on the page is either wrapped in a <label> or
  // pointed at by one. This walks the real markup rather than trusting a
  // convention.
  const ids = [...PAGE.matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([a-z0-9-]+)"/gi)].map((m) => m[1]);
  const missing = ids.filter((id) => !new RegExp(`for="${id}"`).test(PAGE)
    && !new RegExp(`<label[^>]*>[^<]*<(?:input|select|textarea)[^>]*id="${id}"`).test(PAGE));
  assert.deepEqual(missing, [], `every static field is labelled (unlabelled: ${missing.join(", ")})`);

  // Generated fields carry their own names.
  assert.match(PAGE, /aria-label="Answer choice \$\{String\.fromCharCode\(65 \+ i\)\}"/);
  assert.match(PAGE, /aria-label="Stage \$\{i \+ 1\}: /);
  assert.match(PAGE, /aria-label="Start a \$\{esc\(action\.label\)\} post/);
  assert.match(PAGE, /<label for="sh-\$\{i\}">Heading<\/label>/);
  assert.match(PAGE, /<label for="sb-\$\{i\}">Body/);
  assert.match(PAGE, /<label id="e-ix-choices-label">Answer choices/);
  assert.match(PAGE, /role="group" aria-labelledby="e-ix-choices-label"/);
  assert.match(PAGE, /<legend class="x-help">Celestial visuals<\/legend>/,
    "checkbox clusters are grouped by a fieldset with a legend");

  // Focus is visible everywhere, not only where a browser default survived.
  assert.match(PAGE, /:focus-visible \{ outline: 2px solid var\(--color-border-focus\); outline-offset: 2px;/);
  assert.match(PAGE, /class="x-skip" href="#x-main"/, "and there is a skip link to the content");

  // Status messages live in polite live regions.
  assert.match(PAGE, /id="x-status" role="status" aria-live="polite"/);
  assert.match(PAGE, /id="x-lib-status-line" role="status" aria-live="polite"/);
  assert.match(PAGE, /id="x-preview-warnings" role="status" aria-live="polite"/);
  assert.match(PAGE, /id="x-import-status|id="e-import-status" role="status" aria-live="polite"/);
  assert.match(PAGE, /id="x-gate-error" role="alert"/);

  // Helper copy uses the secondary tone, a contrast step above the metadata
  // grey the old desk set every hint in.
  assert.match(PAGE, /\.x-help \{ font-size: var\(--type-fine\); color: var\(--color-secondary\);/);
  assert.ok(!/\.x-helper \{[^}]*--color-muted/.test(PAGE), "no helper text is left at the metadata tone");
});

test("the desk page still decides nothing about who may enter", () => {
  // Unchanged from Dev Update 5.2 and re-asserted because the page was
  // rewritten: the gate answers "is there a session", never "may this account
  // use Orbit X". That is a database fact the server and RLS both enforce.
  assert.ok(!/isAdmin|is_admin|orbit_x_admins/i.test(PAGE));
  assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(PAGE));
  assert.match(PAGE, /checkSession\(\)\.then/);
});
