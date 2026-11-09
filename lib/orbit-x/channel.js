// Orbit X :: the automatic channel (Dev Update 6.1, reworked 2026-11-09).
//
// REVIEW, THEN SCHEDULE, THEN PUBLISH. The channel keeps the next 7 editorial
// days prepared ahead, one post per day: planned (rotation.js), written
// (Claude), checked (policy.js) and rendered. Each post then waits as "ready
// for review". A person looks at its slides in the desk, may edit the caption
// and alt text (every check runs again), and approves it with a publish date
// and time. Approved posts publish at their time from the cron, which ticks
// every 15 minutes. In "auto" mode (ORBIT_X_AUTOPUBLISH_LIVE=true) a Green post
// approves itself at the default publish time; a Yellow post never does.
//
// One run per editorial day, as a resumable state machine:
//
//   claimed           plan + write + check, save the post   -> generated | skipped
//   generated         render PNG + JPEG, record their hashes -> ready_for_review
//                     (or approved, auto mode and Green only)
//   ready_for_review  waits for a person (review.js)         -> approved | review_rejected
//   approved          waits for its publish time; then render again, require the
//                     same hashes the reviewer saw, upload   -> uploaded
//   uploaded          one image container per slide, then the carousel container;
//                     the post becomes "scheduled"          -> containers
//   containers        poll until FINISHED, then media_publish; the post becomes
//                     "published" with Meta's media id      -> published
//   publishing        (resumed after an unknown outcome) ask the container,
//                     recover the media id, never post twice
//
// Every state is saved before the next external call, so a function that dies
// mid-tick resumes rather than repeats. The UNIQUE slot key makes each day
// idempotent, a lease keeps a tick and a desk action off the same run, and the
// existing partial unique index on period_key means a period that already has
// a live post cannot get a second. A run whose publish window closes before it
// is published expires; nothing posts late.
//
// WHAT NEVER HAPPENS HERE: a post from an inactive or unapproved template; a
// Red post; a Yellow post without a person's per-post approval; a post that
// failed any blocking check; a call to Meta after the kill switch or the
// desk's pause; "scheduled" or "published" written before Meta answered.
// Every step, pass or fail, is written to the append-only log.

import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import { channelConfig, killSwitchEngaged, TICK_BUDGET_MS, LOOKAHEAD_DAYS } from "./channel-config.js";
import { channelOptions } from "./channel-candidates.js";
import { TERMINAL_RUN_STATES, PUBLISHING_STATES } from "./channel-store.js";
import {
  syncRegistry, designForType, templateVersion, templateStates, rotationTypes, preferredMap,
  HOOK_STYLES, CAPTION_STRUCTURES,
} from "./post-types.js";
import { choosePlan, nearDuplicate, openingOf } from "./rotation.js";
import { autonomyAllowed, reviewRequired, runPostChecks, channelBrief } from "./policy.js";
import { buildPacket, systemPrompt } from "./prompts.js";
import { generateCopy, OrbitXAiError } from "./ai.js";
import { parseModelJson, validateGeneratedPost, OrbitXValidationError } from "./schemas.js";
import { attachReadingMetadata } from "./readings.js";
import { formatFor } from "./candidates.js";
import { scoreCandidate } from "./scoring.js";
import { TEMPLATES, normalizeDesign, renderPost } from "./templates.js";
import { rasterizePost } from "./raster.js";
import { postCollisions } from "./layout-check.js";
import { mediaPath } from "./media.js";
import { createPublisher, graphConfig, OrbitXPublishError } from "./publisher.js";
import { proposePostTypes } from "./design-proposals.js";

export const MAX_STEP_ATTEMPTS = 4;
/** A day gets this many plans. A plan whose copy fails the checks twice is
 *  excluded and the next tick tries the next-best option. */
export const MAX_PLANS_PER_DAY = 3;
const LEASE_MS = 45_000;
/** Runs whose post exists and still counts for rotation and duplicates. */
export const PRODUCED_STATES = Object.freeze(["generated", "ready_for_review", "approved", "uploaded", "containers",
  "publishing", "published"]);

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** One run per editorial day, whatever the mode it was prepared in. */
export function slotKeyFor(slotDate) {
  return `day:${slotDate}`;
}

export function todayIn(now, timezone) {
  return DateTime.fromJSDate(now, { zone: timezone }).toISODate();
}

export function lookaheadDates(today, days = LOOKAHEAD_DAYS) {
  const start = DateTime.fromISO(today, { zone: "UTC" });
  return Array.from({ length: days }, (_, i) => start.plus({ days: i }).toISODate());
}

/** Back-compat for the cron summary and tests written before the lookahead. */
export function slotFor(now, config) {
  const slotDate = todayIn(now, config.timezone);
  return { slotDate, slotKey: slotKeyFor(slotDate) };
}

/**
 * When may this post go out? Never outside the facts it states:
 *   readings   their own period (a weekly reading inside its week)
 *   moon posts the event's own editorial day
 *   evergreen  from its slot day for 7 days (no date-bound facts)
 * @returns {{ start: string, end: string }} ISO instants, end exclusive
 */
export function publishWindow({ candidate, formatId, slotDate, timezone }) {
  const period = candidate?.facts?.period;
  if (period?.start_utc && period?.end_utc) return { start: period.start_utc, end: period.end_utc };
  const day = DateTime.fromISO(slotDate, { zone: timezone }).startOf("day");
  const days = formatId === "something_changed" ? 1 : 7;
  return { start: day.toUTC().toISO(), end: day.plus({ days }).toUTC().toISO() };
}

/** The slot's default publish instant, clamped into its window. */
export function defaultPublishAt({ slotDate, timezone, time, window }) {
  const [h, m] = String(time || "08:30").split(":").map(Number);
  let at = DateTime.fromISO(slotDate, { zone: timezone }).set({ hour: h, minute: m, second: 0, millisecond: 0 });
  const start = DateTime.fromISO(window.start);
  const end = DateTime.fromISO(window.end);
  if (at < start) at = start;
  if (at >= end) at = end.minus({ minutes: 15 });
  return at.toUTC().toISO();
}

/**
 * Turn a reviewer's local date and time (editorial timezone) into a publish
 * instant, or say why it cannot be used.
 * @returns {{ ok: true, at: string } | { ok: false, problem: string }}
 */
export function scheduleWithin({ date, time, timezone, window, now }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || ""))) {
    return { ok: false, problem: "give a date (YYYY-MM-DD) and a time (HH:MM)" };
  }
  const at = DateTime.fromISO(`${date}T${time}`, { zone: timezone });
  // Luxon moves a time that does not exist (the spring-forward hour) to one
  // that does; a schedule must be the time the reviewer typed, or refused.
  if (!at.isValid || at.toFormat("yyyy-MM-dd HH:mm") !== `${date} ${time}`) {
    return { ok: false, problem: "that local time does not exist on that date (daylight saving)" };
  }
  const nowDt = DateTime.fromJSDate(now);
  if (at < nowDt.minus({ minutes: 1 })) return { ok: false, problem: "that time has already passed" };
  if (at < DateTime.fromISO(window.start)) return { ok: false, problem: "that is before this post's facts apply" };
  if (at >= DateTime.fromISO(window.end)) return { ok: false, problem: "that is after this post's facts stop applying" };
  return { ok: true, at: at.toUTC().toISO() };
}

/** Local date, time and a label for an instant, in the editorial timezone. */
export function localParts(iso, timezone) {
  if (!iso) return null;
  const dt = DateTime.fromISO(iso, { zone: timezone });
  return { date: dt.toISODate(), time: dt.toFormat("HH:mm"), label: dt.toFormat("ccc LLL d, h:mm a ZZZZ"), zone: timezone };
}

/** What rotation needs to know about a run. */
function historyEntry(r) {
  return {
    slot_date: r.slot_date, format: r.format, family: r.family, post_type_label: r.post_type_label,
    hook_style: r.plan?.hookStyle || null, caption_structure: r.plan?.captionStructure || null,
    topic_key: r.plan?.topicKey || null, event_key: r.plan?.eventKey || null, period_key: r.plan?.periodKey || null,
    headline: r.generated?.headline || "", hook: r.generated?.hook || "", caption: r.generated?.caption || "",
  };
}

/** Produced posts before a slot (nearest first) and after it (nearest first). */
export function neighboursOf(runs = [], slotDate, { exceptRunId = null } = {}) {
  const produced = runs.filter((r) => r.id !== exceptRunId && r.post_id && r.plan && PRODUCED_STATES.includes(r.state));
  return {
    history: produced.filter((r) => r.slot_date < slotDate).sort((a, b) => b.slot_date.localeCompare(a.slot_date)).map(historyEntry),
    upcoming: produced.filter((r) => r.slot_date > slotDate).sort((a, b) => a.slot_date.localeCompare(b.slot_date)).map(historyEntry),
  };
}

/** Kept for callers that only look back. */
export function historyFromRuns(runs = []) {
  return runs.filter((r) => r.post_id && r.plan && PRODUCED_STATES.includes(r.state)).map(historyEntry);
}

/** Per-slide alt text: the post's description plus where this slide sits. */
export function slideAltText(post, index) {
  const slide = post.slides[index] || {};
  const base = String(post.altText || "").trim();
  const where = `Slide ${index + 1} of ${post.slides.length}${slide.heading ? `: ${slide.heading}` : ""}.`;
  return `${base} ${where}`.slice(0, 1000);
}

function renderContext(candidate, design) {
  return { eventType: candidate.eventType, title: candidate.title, facts: candidate.facts,
    sky: candidate.facts?.planets || [], design };
}

class Budget {
  constructor(now, ms) { this.now = now; this.deadline = now().getTime() + ms; }
  remaining() { return this.deadline - this.now().getTime(); }
  has(ms) { return this.remaining() >= ms; }
}

/**
 * Run one tick. Order matters: posts whose publish time has come go first,
 * then publishes already under way, then keeping the next 7 days prepared.
 *
 * @param {object} args
 * @param {object} args.env
 * @param {object} args.store   channelStore (service lane)
 * @param {object} [args.deps]  { now, fetchImpl, media, buildOptions, generate,
 *                                publisherFor, sleep, budgetMs, proposeTypes }
 * @returns {Promise<object>} a summary safe to return to the cron caller
 */
export async function runChannelTick({ env = process.env, store, deps = {} }) {
  const config = channelConfig(env);
  const now = deps.now || (() => new Date());
  const budget = new Budget(now, deps.budgetMs ?? TICK_BUDGET_MS);
  const fetchImpl = deps.fetchImpl || fetch;
  const summary = { ok: true, mode: config.mode, published: [], prepared: [], expired: [] };

  if (!config.enabled) return { ...summary, ok: false, state: "disabled" };

  // ── Kill switch: nothing is prepared or published, and a publish already
  //    under way ends for good. Queued and scheduled posts stay where they
  //    are; they cannot go out while it is set, and expire if their window
  //    closes first.
  if (config.killSwitch) {
    await store.appendEvent(null, "tick", "skip", { reason: "kill switch engaged", mode: config.mode });
    for (const run of await store.runsInStates(PUBLISHING_STATES)) {
      await finishRun(store, run, "killed", "kill switch engaged");
    }
    return { ...summary, state: "killed" };
  }

  // ── Pause from the desk: nothing moves, nothing is lost. ──
  const control = await store.getControl();
  if (control?.paused) {
    await store.appendEvent(null, "tick", "skip", { reason: "paused from the desk", note: control.reason || null });
    return { ...summary, state: "paused" };
  }

  const today = todayIn(now(), config.timezone);
  summary.today = today;
  const ctx = { store, config, env, deps, fetchImpl, budget, now };

  if (config.tokenExpiresAt && Date.parse(config.tokenExpiresAt) - now().getTime() < 10 * 86_400_000) {
    await store.appendEvent(null, "token", "warn", { expiresAt: config.tokenExpiresAt,
      note: "the Instagram access token expires within 10 days; refresh it and update ORBIT_X_IG_ACCESS_TOKEN and ORBIT_X_IG_TOKEN_EXPIRES_AT" });
  }

  // ── Nothing posts late. ──
  for (const stale of await store.expiredRuns(now().toISOString(), today)) {
    await resolveStaleRun({ ...ctx, run: stale });
    summary.expired.push(stale.slot_date);
  }

  // ── 1. Approved posts whose time has come. ──
  for (const due of await store.dueRuns(now().toISOString())) {
    if (!budget.has(8_000)) break;
    const done = await driveRun(due, ctx);
    if (done.state === "published") summary.published.push(done.slot_date);
  }

  // ── 2. Publishes already under way (a carousel still processing). ──
  for (const inflight of await store.runsInStates(PUBLISHING_STATES)) {
    if (!budget.has(6_000)) break;
    const done = await driveRun(inflight, ctx);
    if (done.state === "published") summary.published.push(done.slot_date);
  }

  // ── 3. Keep the next 7 editorial days prepared. ──
  const days = lookaheadDates(today, config.lookaheadDays);
  for (const slotDate of days) {
    if (await store.runBySlot(slotKeyFor(slotDate))) continue;
    const claimed = await store.insertRun({ slot_key: slotKeyFor(slotDate), slot_date: slotDate, mode: config.mode, state: "claimed" });
    if (claimed) await store.appendEvent(claimed.id, "claim", "info", { slotDate, mode: config.mode });
  }
  for (const run of await store.runsBetween(days[0], days[days.length - 1])) {
    if (!["claimed", "generated"].includes(run.state)) continue;
    if (!budget.has(14_000)) break;
    const done = await driveRun(run, ctx);
    if (["ready_for_review", "approved"].includes(done.state)) summary.prepared.push(done.slot_date);
  }

  // ── Weekly, optional: ask Claude for new post types to review. ──
  if (config.designProposals && config.aiConfigured && budget.has(15_000)
    && DateTime.fromISO(today).weekday === 7) {
    await maybeProposeTypes(ctx).catch((error) =>
      store.appendEvent(null, "design_proposal", "fail", { error: String(error?.code || error?.message || error).slice(0, 200) }));
  }
  summary.state = "ok";
  return summary;
}

/**
 * Take a run's lease and advance it as far as the budget allows. Used by the
 * cron and by the desk (review.js), so the two can never work one run at once.
 * @returns {Promise<object>} the run as it now stands (with `busy` when leased elsewhere)
 */
export async function driveRun(run, ctx) {
  const { store, now } = ctx;
  if (TERMINAL_RUN_STATES.includes(run.state)) return run;
  const leased = await store.leaseRun(run.id, new Date(now().getTime() + LEASE_MS).toISOString(), now().toISOString());
  if (!leased) return { ...run, busy: true };
  let current = leased;
  try {
    for (let guard = 0; guard < 8 && !TERMINAL_RUN_STATES.includes(current.state); guard += 1) {
      const before = current.state;
      current = await advance(current, ctx);
      if (current.state === before) break; // waiting on a person, on time, or on Meta
    }
  } finally {
    await store.updateRun(current.id, { lease_until: null }).catch(() => {});
  }
  return current;
}

/** Build the context driveRun() needs, for callers outside a tick. */
export function channelContext({ env = process.env, store, deps = {}, budgetMs = TICK_BUDGET_MS }) {
  const now = deps.now || (() => new Date());
  return { store, config: channelConfig(env), env, deps, fetchImpl: deps.fetchImpl || fetch,
    budget: new Budget(now, deps.budgetMs ?? budgetMs), now };
}

async function advance(run, ctx) {
  const { budget, now } = ctx;
  const step = run.state;
  try {
    if (step === "claimed") return budget.has(14_000) ? await planAndWrite(run, ctx) : run;
    if (step === "generated") return budget.has(4_000) ? await prepareForReview(run, ctx) : run;
    if (step === "approved") {
      const due = run.scheduled_for && Date.parse(run.scheduled_for) <= now().getTime();
      return due && budget.has(6_000) ? await uploadForPublish(run, ctx) : run;
    }
    if (step === "uploaded") return budget.has(4_000) ? await createContainers(run, ctx) : run;
    if (step === "containers") return budget.has(4_000) ? await publishWhenReady(run, ctx) : run;
    if (step === "publishing") return budget.has(4_000) ? await resolvePublishing(run, ctx) : run;
    return run; // ready_for_review waits for a person
  } catch (error) {
    return handleStepError(run, step, error, ctx);
  }
}

async function handleStepError(run, step, error, { store, config, env }) {
  if (error instanceof OrbitXPublishError && error.code === "killed") {
    // The desk's pause is resumable; the kill switch is not.
    if (killSwitchEngaged(env) || config.killSwitch) return finishRun(store, run, "killed", error.message);
    await store.appendEvent(run.id, step, "skip", { reason: error.message });
    return run;
  }
  const retryable = Boolean(error?.retryable)
    || (error instanceof OrbitXAiError && ["ai_unreachable", "ai_overloaded_error", "ai_rate_limit_error"].includes(error.code))
    || (error instanceof OrbitXAiError && error.status === 429)
    || error?.code === "channel_store_unreachable"
    || error?.code === "media_unreachable"
    // A malformed model response is worth another try on the next tick.
    || error instanceof OrbitXValidationError;
  const attempts = (run.attempts || 0) + 1;
  const detail = { error: describeError(error), attempt: attempts, retryable };
  await store.appendEvent(run.id, step, retryable && attempts < MAX_STEP_ATTEMPTS ? "warn" : "fail", detail);
  if (retryable && attempts < MAX_STEP_ATTEMPTS) {
    return (await store.updateRun(run.id, { attempts, error: detail.error })) || run;
  }
  return finishRun(store, run, "failed", detail.error);
}

function describeError(error) {
  const parts = [error?.name || "Error", error?.code || null, error?.message ? String(error.message).slice(0, 240) : null];
  if (error?.graph) parts.push(`graph ${error.graph.code ?? ""}/${error.graph.subcode ?? ""}`);
  return parts.filter(Boolean).join(": ");
}

/** End a run, and make the post row say what really happened. */
export async function finishRun(store, run, state, reason) {
  const updated = (await store.updateRun(run.id, { state, error: reason ? String(reason).slice(0, 500) : null,
    finished_at: new Date().toISOString(), lease_until: null })) || { ...run, state };
  if (run.post_id) {
    const post = await store.postById(run.post_id).catch(() => null);
    if (post && ["approved", "scheduled"].includes(post.status)) {
      await store.updatePost(post.id, { status: "failed", last_publish_error: String(reason || state).slice(0, 500) });
    } else if (post && post.status === "draft" && ["expired", "review_rejected", "killed"].includes(state)) {
      await store.updatePost(post.id, { status: "rejected",
        rejection_reason: state === "review_rejected" ? String(reason || "rejected in review").slice(0, 200) : `channel_${state}` });
    }
  }
  await store.appendEvent(run.id, "finish", state === "failed" ? "fail" : "info", { state, reason: reason || null });
  return updated;
}

async function resolveStaleRun(ctx) {
  const { store, run } = ctx;
  // A run that may already have published is resolved, not expired: the
  // container knows whether it went out.
  if (run.state === "publishing" && run.graph?.carousel) {
    try {
      const publisher = makePublisher(ctx);
      const status = await publisher.containerStatus(run.graph.carousel);
      if (status.statusCode === "PUBLISHED") {
        await recordPublished(run, await recoverMediaId(run, publisher, store), { store, publisher });
        return;
      }
    } catch { /* fall through to expiry; the log says why below */ }
  }
  const why = run.publish_by ? `its publish window closed (${run.publish_by}) before it was published (${run.state})`
    : `day ${run.slot_date} passed before a post was prepared (${run.state})`;
  await finishRun(store, run, "expired", why);
}

/* ── claimed → generated ─────────────────────────────────────────────────── */

/** The registry, as the rotation and the desk see it right now. */
export async function activeTemplates(store) {
  const rows = await syncRegistry(store);
  const [settings, preferences] = await Promise.all([store.listTemplateSettings(), store.listFormatPreferences()]);
  const states = templateStates(rows, settings, preferences);
  return { rows, states, active: rotationTypes(states), preferred: preferredMap(preferences) };
}

/**
 * Every per-post check for one post, with its render and its neighbours.
 * Used when the channel writes a post, when a reviewer edits it, and again
 * when it is approved and when it is about to publish.
 */
export function checkPost(post, { candidate, autonomy, neighbours = [], rotation }) {
  const design = normalizeDesign(post.design, candidate.eventType, post.format);
  const rendered = renderPost({ ...post, design }, renderContext(candidate, design));
  const duplicate = nearDuplicate(post, neighbours, { threshold: rotation.nearDuplicateThreshold });
  return { ...runPostChecks(post, { candidate, autonomy, renderWarnings: rendered.warnings,
    layout: postCollisions(rendered), duplicate }), rendered };
}

async function planAndWrite(run, ctx) {
  const { store, config, env, deps, budget } = ctx;
  const slotDate = run.slot_date;

  const { active, preferred, states } = await activeTemplates(store);
  const inactive = states.filter((t) => !t.active).map((t) => ({ label: t.label, reason: t.blockedReason || "switched off in the desk" }));

  // Neighbours on both sides: the week ahead is planned day by day.
  const window = await store.runsBetween(
    DateTime.fromISO(slotDate).minus({ days: 45 }).toISODate(), DateTime.fromISO(slotDate).plus({ days: 45 }).toISODate());
  const { history, upcoming } = neighboursOf(window, slotDate, { exceptRunId: run.id });
  const takenKeys = new Set([...history, ...upcoming].flatMap((h) => [h.event_key, h.period_key]).filter(Boolean));

  const { options, notes } = (deps.buildOptions || channelOptions)(slotDate, env);
  const excluded = Array.isArray(run.plan?.excluded) ? run.plan.excluded : [];
  const eligible = [];
  const refusedByPolicy = [];
  for (const option of options) {
    if (excluded.includes(`${option.eventKey}|${option.formatId}`)) {
      refusedByPolicy.push({ key: option.eventKey, format: option.formatId, reason: "an earlier plan for this day failed its checks" });
      continue;
    }
    const allowed = autonomyAllowed(option.autonomy);
    if (!allowed.allowed) { refusedByPolicy.push({ key: option.eventKey, format: option.formatId, reason: allowed.reason }); continue; }
    if (takenKeys.has(option.periodKey) || (option.kind !== "evergreen" && takenKeys.has(option.eventKey))) {
      refusedByPolicy.push({ key: option.eventKey, format: option.formatId, reason: "another day in the queue already carries it" });
      continue;
    }
    const coverage = await store.liveCoverage({ eventKey: option.eventKey, periodKey: option.periodKey });
    if (coverage.length) {
      refusedByPolicy.push({ key: option.eventKey, format: option.formatId,
        reason: `already covered (${coverage[0].origin || "desk"}, ${coverage[0].status})` });
      continue;
    }
    eligible.push(option);
  }

  const { plan, considered } = choosePlan({ options: eligible, types: active, history, upcoming, preferred,
    slotDate, rotation: config.rotation });
  const planLog = { considered, refusedByPolicy, inactiveTemplates: inactive, notes,
    activeTemplates: active.map((t) => t.label), preferred, excluded };

  if (!plan) {
    await store.appendEvent(run.id, "plan", "skip", planLog);
    const why = !active.length ? "no template is active yet (approve and activate templates in the desk)"
      : !eligible.length ? "nothing the policy allows is uncovered for this day" : "rotation rules left no option for this day";
    await store.updateRun(run.id, { plan: planLog });
    return finishRun(store, run, "skipped", why);
  }
  await store.appendEvent(run.id, "plan", "ok", {
    format: plan.formatId, type: plan.type.label, family: plan.family, autonomy: plan.autonomy,
    hookStyle: plan.hookStyle, captionStructure: plan.captionStructure, score: plan.score, ...planLog });

  const attempted = { format: plan.formatId, family: plan.family, post_type_label: plan.type.label,
    post_type_id: plan.type.id, autonomy: plan.autonomy };
  if (!config.aiConfigured) {
    await store.updateRun(run.id, { ...attempted, plan: { ...planSummary(plan), ...planLog } });
    return finishRun(store, run, "skipped", "no copy source: the AI provider is not configured (ORBIT_X_AI_API_KEY)");
  }

  const neighbours = [...history, ...upcoming].slice(0, config.rotation.nearDuplicateLookback);
  let instruction = "";
  let post = null;
  let result = null;
  let usage = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (attempt === 2 && !budget.has(12_000)) break;
    const written = await writeCopy(plan, { ...ctx, instruction, recent: neighbours });
    post = written.post;
    usage = written.usage;
    result = checkPost(post, { candidate: plan.candidate, autonomy: plan.autonomy, neighbours, rotation: config.rotation });
    await store.appendEvent(run.id, "checks", result.passed ? "ok" : "fail", { attempt, checks: result.checks });
    if (result.passed) break;
    const failed = result.checks.filter((c) => !c.passed && c.blocking);
    instruction = `The previous draft was refused by automated checks. Fix exactly these and change nothing else needlessly: ${
      failed.map((c) => `${c.id}${c.detail ? ` (${c.detail})` : ""}`).join("; ")}`.slice(0, 500);
  }

  const generated = { headline: post?.headline || "", hook: openingOf(post || {}).slice(0, 200),
    caption: post?.caption || "", usage };
  if (!result?.passed) {
    const plans = (run.attempts || 0) + 1;
    const nextExcluded = [...excluded, `${plan.candidate.eventKey}|${plan.formatId}`];
    const saved = await store.updateRun(run.id, { ...attempted, attempts: plans,
      plan: { ...planSummary(plan), ...planLog, excluded: nextExcluded }, checks: result?.checks || null, generated });
    if (plans >= MAX_PLANS_PER_DAY) {
      return finishRun(store, saved || run, "skipped", `no plan passed the per-post checks after ${plans} tries; nothing was prepared`);
    }
    // Still "claimed": the next tick plans again without this option.
    await store.appendEvent(run.id, "plan", "warn", { excluded: nextExcluded, note: "the next tick tries the next-best option" });
    return saved || run;
  }

  const inserted = await store.insertPost(postRow({ plan, post, slotDate, mode: run.mode }));
  if (inserted.conflict) {
    await store.updateRun(run.id, { ...attempted, plan: { ...planSummary(plan), ...planLog }, checks: result.checks, generated });
    return finishRun(store, run, "skipped", `${plan.periodKey} already has a live post (unique period index)`);
  }
  await store.appendEvent(run.id, "write", "ok", { postId: inserted.post.id, headline: post.headline });
  return (await store.updateRun(run.id, {
    state: "generated", post_id: inserted.post.id, ...attempted, plan: { ...planSummary(plan), ...planLog },
    checks: result.checks, generated, attempts: 0, error: null,
  })) || run;
}

/** The orbit_x_posts row for a prepared post. Always a draft: approval is a
 *  separate, recorded step (a person's, or auto mode's for Green). */
export function postRow({ plan, post, slotDate, mode }) {
  const candidate = plan.candidate;
  const family = plan.family;
  const period = candidate.facts?.period || null;
  const score = scoreCandidate(candidate, [], slotDate);
  return {
    event_key: candidate.eventKey,
    event_type: candidate.eventType,
    event_payload: candidate,
    calculation_metadata: {
      source: "orbit-x-channel", slot_date: slotDate, local_date: slotDate,
      ...(period ? { editorial_timezone: period.timezone, period_key: period.key, period_start_utc: period.start_utc,
        period_end_utc: period.end_utc, end_exclusive: true } : {}),
    },
    editorial_score: score.totalScore,
    score_breakdown: score.scores,
    recommended_format: formatFor(candidate),
    selected_format: plan.formatId,
    generated_copy: post,
    edited_copy: post,
    template: `${family}/${templateVersion(family)}`,
    // Same meaning as the desk's columns: set for the five versioned visual
    // families, null for the 5.1 event templates.
    template_family: TEMPLATES[family]?.family ? family : null,
    template_version: TEMPLATES[family]?.family ? TEMPLATES[family].version : null,
    reading_type: post.reading?.type || null,
    period_key: plan.periodKey || period?.key || candidate.eventKey,
    period_start_at: period?.start_utc || null,
    period_end_at: period?.end_utc || null,
    status: "draft",
    editor_notes: `Prepared by the channel for ${slotDate} with ${plan.type.label} (${plan.autonomy}, ${mode} mode). `
      + "Every blocking per-post check passed. Waiting for review.",
    created_by: null,
    origin: "channel",
    autonomy: plan.autonomy,
    post_type_id: plan.type.id,
    post_type_label: plan.type.label,
  };
}

function planSummary(plan) {
  return { formatId: plan.formatId, eventKey: plan.candidate.eventKey, periodKey: plan.periodKey || null,
    kind: plan.kind, topicKey: plan.topicKey, type: plan.type.label, family: plan.family, autonomy: plan.autonomy,
    hookStyle: plan.hookStyle, captionStructure: plan.captionStructure, score: plan.score };
}

export async function writeCopy(plan, { env, deps, fetchImpl, budget, instruction, recent }) {
  const brief = channelBrief({
    autonomy: plan.autonomy,
    hookStyleText: HOOK_STYLES[plan.hookStyle],
    captionStructureText: CAPTION_STRUCTURES[plan.captionStructure],
    recentOpenings: recent.map((r) => `${r.headline} ${r.hook}`.trim()).filter(Boolean),
  });
  const packet = buildPacket(plan.candidate, plan.formatId, recent.map((r) => r.headline).filter(Boolean), instruction, brief);
  const timeoutMs = Math.max(5_000, Math.min(20_000, budget.remaining() - 3_000));
  const generate = deps.generate || (async (p) => generateCopy({ system: systemPrompt(), packet: p, env,
    fetchImpl: (url, init) => fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }) }));
  const generated = await generate(packet, { timeoutMs });
  const parsed = attachReadingMetadata(parseModelJson(generated.text), plan.candidate, plan.formatId);
  // The design is the approved template's, whatever the model sent back.
  const post = validateGeneratedPost({ ...parsed, design: designForType(plan.type.spec) }, plan.formatId);
  return { post, usage: generated.usage || null };
}

/* ── generated → ready_for_review (or approved) ──────────────────────────── */

/** Render a stored post to the PNG/JPEG pair, with hashes. */
export async function renderStoredPost(row, slotDate) {
  const post = row.edited_copy;
  const candidate = row.event_payload;
  const design = normalizeDesign(post.design, candidate.eventType, post.format);
  const rendered = renderPost({ ...post, design }, renderContext(candidate, design));
  const slides = await rasterizePost(rendered, { localDate: row.calculation_metadata?.local_date || slotDate,
    eventKey: candidate.eventKey });
  const media = slides.map((s) => ({ index: s.index, filename: s.filename, jpegFilename: s.jpegFilename,
    width: s.width, height: s.height, pngBytes: s.png.length, jpegBytes: s.jpeg.length,
    pngSha256: sha(s.png), jpegSha256: sha(s.jpeg) }));
  return { rendered, slides, media, design };
}

async function prepareForReview(run, ctx) {
  const { store, config, now } = ctx;
  const row = await store.postById(run.post_id);
  if (!row?.edited_copy || !row?.event_payload) return finishRun(store, run, "failed", "the saved post is missing its copy or facts");
  const { rendered, media, design } = await renderStoredPost(row, run.slot_date);
  if (rendered.warnings.length) return finishRun(store, run, "failed", `render warnings: ${rendered.warnings.join("; ")}`);
  await store.updatePost(row.id, { media });
  const window = publishWindow({ candidate: row.event_payload, formatId: row.selected_format, slotDate: run.slot_date,
    timezone: config.timezone });
  await store.appendEvent(run.id, "render", "ok", { slides: media.length, files: media.map((m) => m.filename),
    aspect: design.aspect, family: design.template, window });

  if (reviewRequired({ mode: run.mode, autonomy: row.autonomy })) {
    await store.appendEvent(run.id, "queue", "info", { note: "ready for review", autonomy: row.autonomy,
      ...(row.autonomy === "yellow" ? { requires: "a person to look at every slide and approve this post" } : {}) });
    return (await store.updateRun(run.id, { media, state: "ready_for_review", publish_window_start: window.start,
      publish_by: window.end, attempts: 0, error: null })) || run;
  }

  // Auto mode, Green: approve at the default publish time (or now, if that
  // has already passed today).
  const at = defaultPublishAt({ slotDate: run.slot_date, timezone: config.timezone, time: config.publishTime, window });
  const when = Date.parse(at) < now().getTime() ? now().toISOString() : at;
  try {
    await store.updatePost(row.id, { status: "approved", approved_at: new Date().toISOString(), publish_at: when });
  } catch (error) {
    if (/conflict|live period/i.test(String(error?.code || error?.message))) {
      return finishRun(store, run, "skipped", `${row.period_key} already has a live post (unique period index)`);
    }
    throw error;
  }
  await store.appendEvent(run.id, "auto_approve", "ok", { autonomy: row.autonomy, scheduledFor: when,
    local: localParts(when, config.timezone)?.label });
  return (await store.updateRun(run.id, { media, state: "approved", scheduled_for: when, publish_window_start: window.start,
    publish_by: window.end, attempts: 0, error: null })) || run;
}

/* ── approved (due) → uploaded ───────────────────────────────────────────── */

async function uploadForPublish(run, ctx) {
  const { store, config, deps, env } = ctx;
  // Nothing becomes public while the channel is stopped: the same pause and
  // kill switch the publisher checks before every call to Meta.
  if (killSwitchEngaged(env) || config.killSwitch) return finishRun(store, run, "killed", "kill switch engaged");
  if ((await store.getControl())?.paused) {
    await store.appendEvent(run.id, "upload", "skip", { reason: "paused from the desk" });
    return run;
  }
  const row = await store.postById(run.post_id);
  if (!row?.edited_copy || !row?.event_payload) return finishRun(store, run, "failed", "the saved post is missing its copy or facts");
  const { rendered, slides, media } = await renderStoredPost(row, run.slot_date);
  // The slides that go out are the slides that were approved, byte for byte.
  const approved = (run.media || []).map((m) => m.pngSha256);
  if (rendered.warnings.length || approved.length !== media.length || media.some((m, i) => m.pngSha256 !== approved[i])) {
    return finishRun(store, run, "failed", "the rendering changed after approval; regenerate the post and approve it again");
  }
  const window = await store.runsBetween(
    DateTime.fromISO(run.slot_date).minus({ days: 30 }).toISODate(), DateTime.fromISO(run.slot_date).plus({ days: 30 }).toISODate());
  const { history, upcoming } = neighboursOf(window, run.slot_date, { exceptRunId: run.id });
  const recheck = checkPost(row.edited_copy, { candidate: row.event_payload, autonomy: row.autonomy,
    neighbours: [...history, ...upcoming].slice(0, config.rotation.nearDuplicateLookback), rotation: config.rotation });
  if (!recheck.passed) {
    await store.appendEvent(run.id, "checks", "fail", { at: "publish", checks: recheck.checks });
    return finishRun(store, run, "failed", "the post no longer passes its checks at publish time");
  }
  if (!deps.media) return finishRun(store, run, "failed", "media storage is not configured");
  for (const s of slides) {
    const m = media[s.index];
    m.pngUrl = await deps.media.upload(mediaPath({ slotDate: run.slot_date, postId: row.id, filename: s.filename }), s.png, "image/png");
    m.jpegUrl = await deps.media.upload(mediaPath({ slotDate: run.slot_date, postId: row.id, filename: s.jpegFilename }), s.jpeg, "image/jpeg");
  }
  if (!media.every((m) => /^https:\/\//.test(m.jpegUrl || ""))) {
    return finishRun(store, run, "failed", "Meta needs public HTTPS image URLs; storage did not return them");
  }
  await store.updatePost(row.id, { media });
  await store.appendEvent(run.id, "upload", "ok", { slides: media.length });
  return (await store.updateRun(run.id, { media, state: "uploaded", attempts: 0, error: null })) || run;
}

/* ── uploaded → containers ───────────────────────────────────────────────── */

function makePublisher({ store, config, env, deps, fetchImpl, run }) {
  const shouldStop = async () => {
    if (killSwitchEngaged(env) || config.killSwitch) return "kill switch engaged";
    const control = await store.getControl();
    return control?.paused ? "paused from the desk" : null;
  };
  const log = (step, outcome, detail) => { store.appendEvent(run?.id || null, `graph:${step}`, outcome, detail).catch(() => {}); };
  if (deps.publisherFor) return deps.publisherFor({ shouldStop, log });
  return createPublisher({ config: graphConfig(env), fetchImpl, shouldStop, log,
    sleep: deps.sleep });
}

async function createContainers(run, ctx) {
  const { store, budget } = ctx;
  const row = await store.postById(run.post_id);
  const post = row.edited_copy;
  const media = run.media || row.media || [];
  if (media.length !== post.slides.length) return finishRun(store, run, "failed", "uploaded media does not match the slides");
  const publisher = makePublisher({ ...ctx, run });
  const graph = { children: [], ...(run.graph || {}) };

  for (let i = graph.children.length; i < media.length; i += 1) {
    if (!budget.has(3_000)) {
      return (await store.updateRun(run.id, { graph })) || run; // resume next tick
    }
    const id = await publisher.createImageItem({ imageUrl: media[i].jpegUrl, altText: slideAltText(post, i) });
    graph.children = [...graph.children, id];
    await store.updateRun(run.id, { graph });
  }
  if (!graph.carousel) {
    if (!budget.has(3_000)) return (await store.updateRun(run.id, { graph })) || run;
    graph.carousel = await publisher.createCarousel({ children: graph.children, caption: post.caption });
    graph.carouselCreatedAt = new Date().toISOString();
  }
  // "scheduled" is written only now, after Meta returned a carousel id.
  await store.updatePost(row.id, { status: "scheduled", scheduled_at: graph.carouselCreatedAt, publish_container_id: graph.carousel });
  await store.appendEvent(run.id, "containers", "ok", { children: graph.children.length, carousel: graph.carousel });
  return (await store.updateRun(run.id, { graph, state: "containers", attempts: 0, error: null })) || run;
}

/* ── containers → published ──────────────────────────────────────────────── */

async function publishWhenReady(run, ctx) {
  const { store, budget, now } = ctx;
  const publisher = makePublisher({ ...ctx, run });
  const status = await publisher.waitForFinished(run.graph.carousel, {
    deadline: now().getTime() + Math.max(0, budget.remaining() - 4_000), now: () => now().getTime() });
  if (status.statusCode === "IN_PROGRESS") {
    await store.appendEvent(run.id, "container_status", "info", { status: status.statusCode });
    return run;
  }
  if (status.statusCode === "PUBLISHED") return resolvePublishing(run, ctx);
  if (status.statusCode !== "FINISHED") {
    return finishRun(store, run, "failed", `carousel container is ${status.statusCode}${status.status ? ` (${status.status})` : ""}`);
  }
  // Persist the intent BEFORE the call whose outcome could be lost.
  const publishing = (await store.updateRun(run.id, { state: "publishing" })) || { ...run, state: "publishing" };
  const row = await store.postById(run.post_id);
  await store.updatePost(row.id, { publish_attempts: (row.publish_attempts || 0) + 1 });
  const mediaId = await publisher.publish(run.graph.carousel);
  return recordPublished(publishing, mediaId, { store, publisher });
}

async function recoverMediaId(run, publisher, store) {
  const row = await store.postById(run.post_id);
  return publisher.recoverPublished({ caption: row?.edited_copy?.caption, after: run.graph?.carouselCreatedAt });
}

async function resolvePublishing(run, ctx) {
  const { store } = ctx;
  const publisher = makePublisher({ ...ctx, run });
  const status = await publisher.containerStatus(run.graph.carousel);
  if (status.statusCode === "PUBLISHED") return recordPublished(run, await recoverMediaId(run, publisher, store), { store, publisher });
  if (status.statusCode === "FINISHED") {
    const mediaId = await publisher.publish(run.graph.carousel);
    return recordPublished(run, mediaId, { store, publisher });
  }
  return finishRun(store, run, "failed", `carousel container is ${status.statusCode} after a publish attempt`);
}

async function recordPublished(run, mediaId, { store, publisher }) {
  if (!mediaId) {
    return finishRun(store, run, "failed",
      "Instagram reports the carousel as published but its media id could not be recovered; check the account and record it by hand");
  }
  const permalink = await publisher.permalink(mediaId);
  const at = new Date().toISOString();
  await store.updatePost(run.post_id, { status: "published", published_at: at, external_media_id: mediaId,
    permalink, last_publish_error: null });
  await store.appendEvent(run.id, "publish", "ok", { mediaId, permalink });
  return (await store.updateRun(run.id, { state: "published", finished_at: at, error: null,
    graph: { ...(run.graph || {}), mediaId, permalink, media_id: mediaId } })) || { ...run, state: "published" };
}

/* ── the registry and AI proposals ───────────────────────────────────────── */

async function maybeProposeTypes({ store, env, deps, fetchImpl, now }) {
  const since = new Date(now().getTime() - 6 * 86_400_000).toISOString();
  const recent = await store.recentEvents({ step: "design_proposal", sinceIso: since, limit: 1 });
  if (recent.length) return;
  const existing = await store.listPostTypes();
  const propose = deps.proposeTypes || proposePostTypes;
  const { accepted, refused, usage } = await propose({ env, fetchImpl, existing, count: 2 });
  const inserted = accepted.length ? await store.insertPostTypes(accepted) : [];
  await store.appendEvent(null, "design_proposal", accepted.length ? "ok" : "skip",
    { proposed: inserted.map((r) => `${r.type_key}/v${r.version}`), refused, usage });
}
