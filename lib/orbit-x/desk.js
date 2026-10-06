// Orbit X :: the desk's presentation logic (Dev Update 5.6).
//
// WHY THIS IS A MODULE AND NOT A CLOSURE INSIDE ui.html. Orbit has no bundler
// and no jsdom, so every previous assertion about the desk was a regex over
// the page's source text — a test that proves a string exists and nothing
// about what it does. Everything here is the part of the redesign that CAN be
// executed: stage order, library titles, status vocabulary, the readable
// shape of a verified packet, recommendation summaries. Node tests import it
// and the browser imports the same file, so what the suite exercises is what
// the desk runs.
//
// It renders nothing. There is no DOM in this file, deliberately — the page
// owns markup, this owns meaning.

import { FORMATS } from "./formats.js";
import { TEMPLATES, humanDate, recommendTemplate } from "./templates.js";
import { INTERACTION_FORMATS } from "./interactive.js";

/* ── The workspace ───────────────────────────────────────────────────────── */

/** Three stages, in order. Choose what to make, write it, look at it. The old
 *  desk had all three stacked on one page and a fourth column of history
 *  beside them; the stages are now navigable and the library is its own
 *  view (below), not a panel inside the candidate list. */
export const STAGES = Object.freeze([
  Object.freeze({ id: "choose", label: "Choose", hint: "Pick what to publish" }),
  Object.freeze({ id: "write", label: "Write", hint: "Write the copy" }),
  Object.freeze({ id: "preview", label: "Preview", hint: "Check and export" }),
]);
export const STAGE_IDS = Object.freeze(STAGES.map((s) => s.id));

/** The Library is a top-level VIEW, not a stage: it is where saved work
 *  lives, and reaching it must never mean stepping backwards through a
 *  workflow. */
export const VIEWS = Object.freeze(["workspace", "library"]);

/** Which stages a draft has unlocked. Write and Preview are meaningless
 *  before something is being drafted, and offering them anyway is how the old
 *  desk showed an empty editor beside an empty preview. */
export function availableStages(hasDraft) {
  return hasDraft ? STAGE_IDS : ["choose"];
}

/* ── The solo lifecycle ──────────────────────────────────────────────────────
   The database keeps its statuses (draft, approved, rejected, exported, and
   the three reserved publisher states). Nothing is removed — a stored
   `approved` row is still `approved`. What changes is the WORD: a solo
   founder does not approve their own work, they decide it is ready to post.
   Rejection stays available, in a review section, under a name that reads
   like a note to self instead of a moderator's verdict. */
export const STATUS_LABELS = Object.freeze({
  draft: "Draft",
  approved: "Ready to Post",
  exported: "Exported",
  rejected: "Needs changes",
  scheduled: "Scheduled",
  published: "Published",
  failed: "Failed",
});

/** Visual weight for the status pill — never colour alone; the label carries
 *  the meaning and the tone only reinforces it. */
export const STATUS_TONES = Object.freeze({
  draft: "neutral", approved: "ready", exported: "done",
  rejected: "warn", scheduled: "ready", published: "done", failed: "warn",
});

export function statusLabel(status) {
  return STATUS_LABELS[String(status || "").trim()] || "Draft";
}

export function statusTone(status) {
  return STATUS_TONES[String(status || "").trim()] || "neutral";
}

/** The status the "mark ready" action moves a draft to. The API vocabulary is
 *  untouched — only the button's word changed. */
export const READY_STATUS = "approved";
export const READY_ACTION_LABEL = "Mark ready to post";

/* ── Reading names ───────────────────────────────────────────────────────── */

const READING_NAMES = Object.freeze({ daily: "Daily Reading", weekly: "Weekly Reading", monthly: "Monthly Reading" });

const EVENT_KIND_NAMES = Object.freeze({
  full_moon: "Full Moon",
  new_moon: "New Moon",
  sun_ingress: "Sun Ingress",
  mercury_rx: "Mercury Retrograde",
  mercury_direct: "Mercury Direct",
  daily_sky: "Current Sky",
  educational: "Explainer",
  interactive: "Interactive Post",
});

function monthLabel(yyyyMm) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(yyyyMm || ""));
  return m ? `${humanDate(`${yyyyMm}-01`).split(" ")[0]} ${m[1]}` : "";
}

function longDate(iso) {
  const day = humanDate(iso);
  const year = /^(\d{4})-/.exec(String(iso || ""))?.[1];
  return day && year ? `${day}, ${year}` : day;
}

/**
 * A human title for a stored event key. `full_moon:2026-08-27` is a database
 * fact, not a name a person should have to read in a list — the Library shows
 * "Full Moon · August 27, 2026" and keeps the key in the details.
 */
export function humanEventTitle(eventKey) {
  const key = String(eventKey || "").trim();
  if (!key) return "Untitled";
  const [head, ...rest] = key.split(":");
  if (READING_NAMES[head]) {
    if (head === "monthly") return `${READING_NAMES[head]} · ${monthLabel(rest[0]) || rest.join(":")}`;
    if (head === "weekly" && rest.length === 2) {
      return `${READING_NAMES[head]} · ${humanDate(rest[0])}–${longDate(rest[1])}`;
    }
    return `${READING_NAMES[head]} · ${longDate(rest[0]) || rest.join(":")}`;
  }
  if (EVENT_KIND_NAMES[head]) {
    const when = longDate(rest[0]);
    return when ? `${EVENT_KIND_NAMES[head]} · ${when}` : EVENT_KIND_NAMES[head];
  }
  return key;
}

/** The date or period a saved item covers, as a person would say it. */
export function periodLabelFor(row) {
  const copy = row?.edited_copy || row?.generated_copy || null;
  if (copy?.reading?.periodLabel) return copy.reading.periodLabel;
  const payloadPeriod = row?.event_payload?.facts?.period;
  if (payloadPeriod?.label) return payloadPeriod.label;
  const date = row?.event_payload?.facts?.date || row?.event_payload?.facts?.local_date;
  if (date) return longDate(date);
  const key = String(row?.event_key || "");
  const tail = key.split(":").slice(1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(tail[0] || "")) return longDate(tail[0]);
  if (/^\d{4}-\d{2}$/.test(tail[0] || "")) return monthLabel(tail[0]);
  return "";
}

/** What kind of post this is, in the founder's words. */
export function typeLabelFor(row) {
  const format = FORMATS[row?.selected_format];
  if (format?.interactive) {
    const kind = INTERACTION_FORMATS[row?.edited_copy?.interaction?.format];
    return kind ? `Interactive · ${kind.name}` : "Interactive";
  }
  if (format?.readingType) return READING_NAMES[format.readingType] || format.name;
  return format?.name || String(row?.selected_format || "Post");
}

export function templateLabelFor(row) {
  const family = row?.template_family || row?.edited_copy?.design?.template;
  const template = TEMPLATES[family];
  if (template) return `${template.name}${row?.template_version ? ` ${row.template_version}` : ""}`;
  return row?.template || "—";
}

/**
 * One Library card's worth of meaning. Everything a saved item shows, decided
 * here so the page only has to place it: a readable title, what kind of post
 * it is, the period it covers, its status in solo words, the template it was
 * saved with, and whether there is a first slide to draw a thumbnail from.
 */
export function libraryEntry(row) {
  const copy = row?.edited_copy || row?.generated_copy || null;
  const authored = String(copy?.reading?.theme || copy?.headline || "").trim();
  return Object.freeze({
    id: row?.id || null,
    title: authored || humanEventTitle(row?.event_key),
    // The key stays reachable — under Details, never as the label.
    eventKey: String(row?.event_key || ""),
    typeLabel: typeLabelFor(row),
    periodLabel: periodLabelFor(row),
    status: String(row?.status || "draft"),
    statusLabel: statusLabel(row?.status),
    statusTone: statusTone(row?.status),
    templateLabel: templateLabelFor(row),
    rejectionReason: row?.rejection_reason || null,
    savedAt: String(row?.updated_at || row?.created_at || "").slice(0, 10),
    thumbnailCopy: Array.isArray(copy?.slides) && copy.slides.length ? copy : null,
    openLabel: "Open draft",
  });
}

/** The Library's filter vocabulary — solo words, backed by real statuses. */
export const LIBRARY_STATUS_FILTERS = Object.freeze([
  Object.freeze({ value: "", label: "All statuses" }),
  Object.freeze({ value: "draft", label: STATUS_LABELS.draft }),
  Object.freeze({ value: "approved", label: STATUS_LABELS.approved }),
  Object.freeze({ value: "exported", label: STATUS_LABELS.exported }),
  Object.freeze({ value: "rejected", label: STATUS_LABELS.rejected }),
]);

export const LIBRARY_KIND_FILTERS = Object.freeze([
  Object.freeze({ value: "", label: "All content" }),
  Object.freeze({ value: "daily_reading", label: "Daily" }),
  Object.freeze({ value: "weekly_reading", label: "Weekly" }),
  Object.freeze({ value: "monthly_reading", label: "Monthly" }),
  Object.freeze({ value: "interactive_post", label: "Interactive" }),
  Object.freeze({ value: "other", label: "Other formats" }),
]);

const LIBRARY_NAMED_KINDS = Object.freeze(["daily_reading", "weekly_reading", "monthly_reading", "interactive_post"]);

export function matchesKindFilter(row, kind) {
  if (!kind) return true;
  if (kind === "other") return !LIBRARY_NAMED_KINDS.includes(row?.selected_format);
  return row?.selected_format === kind;
}

/* ── The Choose stage ────────────────────────────────────────────────────── */

/** The five things a founder can start. Everything else in the old desk was
 *  a way of reaching one of these. */
export const START_ACTIONS = Object.freeze([
  Object.freeze({ id: "daily", label: "Daily", kind: "reading", blurb: "Today's collective reading" }),
  Object.freeze({ id: "weekly", label: "Weekly", kind: "reading", blurb: "The editorial Monday–Sunday week" }),
  Object.freeze({ id: "monthly", label: "Monthly", kind: "reading", blurb: "The named calendar month" }),
  Object.freeze({ id: "special", label: "Special", kind: "event", blurb: "The next Full or New Moon" }),
  Object.freeze({ id: "interactive", label: "Interactive", kind: "interactive", blurb: "Ask the audience something" }),
]);

/**
 * One recommendation card's worth of meaning: what it is, when, which
 * template, one short reason, and what pressing the button does. Everything
 * technical — the event key, the ISO instant, the score and its full reason
 * list — travels in `details` for the card's expandable area, never in the
 * card's face.
 */
export function recommendationView(entry, { formats = FORMATS, recommendedTemplate = null } = {}) {
  const candidate = entry?.candidate || {};
  const score = entry?.score || {};
  const coverage = Array.isArray(entry?.coverage) ? entry.coverage : [];
  const existing = coverage[0] || null;
  const format = formats[entry?.suggestedFormat] || FORMATS[entry?.suggestedFormat] || null;
  const template = TEMPLATES[recommendedTemplate] || null;
  const reasons = Array.isArray(score.reasons) ? score.reasons : [];
  return Object.freeze({
    title: candidate.title || humanEventTitle(candidate.eventKey),
    timing: candidate.facts?.period?.label
      || longDate(candidate.facts?.date || candidate.facts?.local_date)
      || "Evergreen",
    formatId: entry?.suggestedFormat || null,
    formatName: format?.name || entry?.suggestedFormat || "",
    templateName: template?.name || "",
    // One reason on the face of the card. The rest are in Details — the old
    // card printed every scoring explanation at the same size as the title.
    reason: reasons[0] || "",
    // A draft that already exists is NOT an error. It used to render with a
    // red border and the word "already covered"; it is simply somewhere to
    // continue from.
    hasDraft: Boolean(existing),
    draftId: existing?.id || null,
    draftStatusLabel: existing ? statusLabel(existing.status) : null,
    actionLabel: existing ? "Open draft" : "Start draft",
    details: Object.freeze({
      eventKey: candidate.eventKey || "",
      eventType: candidate.eventType || "",
      timestamp: candidate.timestamp || null,
      score: Number.isFinite(score.totalScore) ? score.totalScore : null,
      maxScore: Number.isFinite(score.maxScore) ? score.maxScore : null,
      reasons: Object.freeze(reasons),
      coverage: Object.freeze(coverage.map((c) => Object.freeze({
        id: c.id, status: c.status, statusLabel: statusLabel(c.status) }))),
    }),
  });
}

/* ── Verified facts, for people ──────────────────────────────────────────────
   The packet used to be printed as `key: <JSON.stringify(value)>` per line,
   which is honest and unreadable — a founder checking "is the illumination
   right?" had to parse a nested object by eye. This turns the SAME packet,
   unchanged, into labelled groups. It invents nothing: a field the engine did
   not supply is simply absent, never defaulted, and the raw packet stays one
   disclosure away for diagnostics. */

const PLANET_ORDER = Object.freeze(["Sun", "Moon", "Mercury", "Venus", "Mars",
  "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"]);

function degreeLabel(planet) {
  const parts = [planet.sign];
  if (Number.isFinite(planet.degrees)) parts.push(`${Math.floor(planet.degrees)}°`);
  if (planet.retrograde) parts.push("℞");
  return parts.filter(Boolean).join(" ");
}

export function factSummary(candidate) {
  const facts = candidate?.facts || {};
  const period = facts.period || null;

  const when = [];
  if (period?.label) when.push({ label: period.type ? `${period.type} period` : "Period", value: period.label });
  else if (facts.date || facts.local_date) when.push({ label: "Date", value: longDate(facts.date || facts.local_date) });
  if (period?.timezone) when.push({ label: "Editorial timezone", value: period.timezone });
  if (facts.approximate) when.push({ label: "Precision", value: "Approximate, per the source table" });

  const moon = [];
  const atEvent = facts.sky_at_event || null;
  const phase = facts.moon_phase_name || null;
  if (phase) moon.push({ label: "Moon phase", value: phase });
  const moonSign = atEvent?.moon_sign || facts.moon_sign || null;
  if (moonSign) moon.push({ label: "Moon sign", value: moonSign });
  const illumination = Number.isFinite(atEvent?.moon_illumination_percent)
    ? atEvent.moon_illumination_percent
    : (Number.isFinite(facts.illumination_percent) ? facts.illumination_percent : null);
  if (illumination !== null) {
    const waxing = atEvent ? atEvent.moon_waxing : facts.is_waxing;
    moon.push({ label: "Illumination", value: `${Math.round(illumination)}%${typeof waxing === "boolean" ? ` · ${waxing ? "waxing" : "waning"}` : ""}` });
  }
  if (atEvent?.sun_sign) moon.push({ label: "Sun sign at the event", value: atEvent.sun_sign });

  const planets = (Array.isArray(facts.planets) ? facts.planets : [])
    .filter((planet) => planet?.name && planet?.sign)
    .slice()
    .sort((a, b) => {
      const ai = PLANET_ORDER.indexOf(a.name), bi = PLANET_ORDER.indexOf(b.name);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })
    .map((planet) => Object.freeze({ name: planet.name, value: degreeLabel(planet) }));

  const events = (Array.isArray(facts.selected_events) ? facts.selected_events : [])
    .map((event) => Object.freeze({
      key: event.key || "",
      title: event.title || "",
      when: `${event.approximate ? "Around " : ""}${longDate(event.date)}`,
      sign: event.sky_at_event?.moon_sign || null,
    }));

  return Object.freeze({
    eventKey: candidate?.eventKey || "",
    groups: Object.freeze([
      Object.freeze({ id: "when", label: "Period", items: Object.freeze(when) }),
      Object.freeze({ id: "moon", label: "Moon", items: Object.freeze(moon) }),
    ].filter((group) => group.items.length)),
    planets: Object.freeze(planets),
    events: Object.freeze(events),
    sourceNote: facts.source_note
      || "Astronomical facts calculated by the Orbit Axis deterministic engine. Symbolic copy is editorial.",
  });
}

/* ── Preview ─────────────────────────────────────────────────────────────── */

/** One labelled control replaces the old three unlabelled buttons ("Full
 *  size", "Feed size", "Feed preview" — two of which meant the same thing to
 *  anyone who had not built them). */
export const PREVIEW_MODES = Object.freeze([
  Object.freeze({ id: "full", label: "Full size" }),
  Object.freeze({ id: "feed", label: "Feed width (375px)" }),
  Object.freeze({ id: "sim", label: "Simulated feed post" }),
]);
export const PREVIEW_MODE_IDS = Object.freeze(PREVIEW_MODES.map((m) => m.id));

/* ── Save state ──────────────────────────────────────────────────────────── */

/** The sticky bar's dirty/saved state, as a sentence. Explicit saving is
 *  preserved: nothing here writes, it only describes. */
export function saveStateLabel({ dirty = false, saving = false, savedAt = null, saved = false } = {}) {
  if (saving) return "Saving…";
  if (dirty) return "Unsaved changes";
  if (savedAt) return `Saved at ${savedAt}`;
  // A draft reopened from the Library is saved — it just was not saved in
  // THIS session, and telling the founder "not saved yet" about stored work
  // is the kind of small lie that costs trust in a save indicator.
  return saved ? "Saved" : "Not saved yet";
}

export function saveStateTone({ dirty = false, saving = false, savedAt = null, saved = false } = {}) {
  if (saving) return "busy";
  if (dirty) return "warn";
  return (savedAt || saved) ? "done" : "neutral";
}

/* ── Write stage ─────────────────────────────────────────────────────────── */

/** The editor's field groups, in reading order. Each is collapsible; the
 *  interactive group only appears for a format that has a question. */
export const FIELD_GROUPS = Object.freeze([
  Object.freeze({ id: "hook", label: "Hook", hint: "The line that earns the swipe" }),
  Object.freeze({ id: "interaction", label: "Interactive question", hint: "What you're asking", interactiveOnly: true }),
  Object.freeze({ id: "content", label: "Reading", hint: "The slides" }),
  Object.freeze({ id: "caption", label: "Caption & CTA", hint: "The post's own read" }),
  Object.freeze({ id: "accessibility", label: "Accessibility", hint: "Describe what the graphic shows" }),
  Object.freeze({ id: "notes", label: "Notes & assistance", hint: "Optional, private to you" }),
]);

export function fieldGroupsFor(formatId) {
  const interactive = Boolean(FORMATS[formatId]?.interactive);
  return FIELD_GROUPS.filter((group) => (group.interactiveOnly ? interactive : true))
    .map((group) => (interactive && group.id === "content"
      ? Object.freeze({ ...group, label: "Slides", hint: "Derived from your question" }) : group));
}

/** Which template a cadence opens on, named for the founder rather than
 *  quietly applied. The recommendation itself still comes from
 *  templates.js — this only puts a readable name on it. */
export function cadenceTemplate(formatId, eventType = null) {
  const id = recommendTemplate(eventType, formatId);
  const template = TEMPLATES[id];
  return Object.freeze({
    id,
    name: template?.name || id,
    version: template?.version || "",
    blurb: template?.intendedUse || "",
  });
}
