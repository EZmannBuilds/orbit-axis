// Orbit X :: the automatic channel (Dev Update 6.1).
//
// ONE TICK OF A RESUMABLE STATE MACHINE. Vercel Cron calls the protected route
// a few times each morning; every call runs runChannelTick(), which claims or
// resumes the day's run and advances it as far as the time budget allows:
//
//   claimed     plan (rotation.js) + write (Claude) + check (policy.js)
//               + save the post row          -> generated | skipped
//   generated   render SVG -> PNG + JPEG; upload when live
//                                            -> uploaded | dry_run_complete
//   uploaded    one image container per slide, then the carousel container;
//               the post becomes "scheduled" -> containers
//   containers  poll until FINISHED, then media_publish; the post becomes
//               "published" with Meta's media id -> published
//   publishing  (resumed after an unknown outcome) ask the container whether
//               it was published, recover the media id, never post twice
//
// Every state is persisted before the next external call, so a function that
// dies mid-tick resumes rather than repeats. The run row's UNIQUE slot key
// makes the day idempotent, a lease keeps two overlapping invocations from
// working the same run, and the existing partial unique index on period_key
// means a period that already has a live post cannot get a second.
//
// WHAT NEVER HAPPENS HERE: a post without a usable approved type; a Red post;
// a Yellow post without ORBIT_X_AUTOPUBLISH_YELLOW; a post that failed any
// blocking check; a call to Meta in dry run; a call to Meta after the kill
// switch or the desk's pause; "scheduled" or "published" written before Meta
// answered. Every step, pass or fail, is written to the append-only log.

import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import { channelConfig, killSwitchEngaged, TICK_BUDGET_MS } from "./channel-config.js";
import { channelOptions } from "./channel-candidates.js";
import { TERMINAL_RUN_STATES } from "./channel-store.js";
import {
  syncRegistry, usability, typeLabel, designForType, templateVersion, HOOK_STYLES, CAPTION_STRUCTURES,
} from "./post-types.js";
import { choosePlan, nearDuplicate, openingOf } from "./rotation.js";
import { autonomyAllowed, runPostChecks, channelBrief } from "./policy.js";
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
 *  excluded and the next cron tick tries the next-best option. */
export const MAX_PLANS_PER_DAY = 3;
const LEASE_MS = 45_000;
const PRODUCED_STATES = Object.freeze(["generated", "rendered", "uploaded", "containers", "publishing", "published", "dry_run_complete"]);

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function slotFor(now, config) {
  const slotDate = DateTime.fromJSDate(now, { zone: config.timezone }).toISODate();
  return { slotDate, slotKey: `${config.mode}:${slotDate}` };
}

/** What rotation needs to know about past runs. */
export function historyFromRuns(runs = []) {
  return runs
    .filter((r) => r.post_id && r.plan && PRODUCED_STATES.includes(r.state))
    .map((r) => ({
      slot_date: r.slot_date, format: r.format, family: r.family, post_type_label: r.post_type_label,
      hook_style: r.plan?.hookStyle || null, caption_structure: r.plan?.captionStructure || null,
      topic_key: r.plan?.topicKey || null,
      headline: r.generated?.headline || "", hook: r.generated?.hook || "", caption: r.generated?.caption || "",
    }));
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
 * Run one tick.
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
  const summary = { ok: true, mode: config.mode, steps: [] };
  const note = (step, outcome, detail) => summary.steps.push({ step, outcome, ...(detail ? { detail } : {}) });

  if (!config.enabled) return { ...summary, ok: false, state: "disabled" };

  // ── Kill switch: stops everything, and in-flight runs end for good. ──
  if (config.killSwitch) {
    await store.appendEvent(null, "tick", "skip", { reason: "kill switch engaged", mode: config.mode });
    for (const run of await store.unfinishedRunsBefore("9999-12-31")) {
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

  const { slotDate, slotKey } = slotFor(now(), config);
  summary.slotKey = slotKey;

  if (config.tokenExpiresAt && Date.parse(config.tokenExpiresAt) - now().getTime() < 10 * 86_400_000) {
    await store.appendEvent(null, "token", "warn", { expiresAt: config.tokenExpiresAt,
      note: "the Instagram access token expires within 10 days; refresh it and update ORBIT_X_IG_ACCESS_TOKEN and ORBIT_X_IG_TOKEN_EXPIRES_AT" });
  }

  // ── Yesterday's unfinished work does not post late. ──
  for (const stale of await store.unfinishedRunsBefore(slotDate)) {
    await resolveStaleRun({ store, run: stale, config, env, deps, fetchImpl });
  }

  // ── Claim or resume today's run. ──
  let run = await store.runBySlot(slotKey);
  if (!run) {
    run = await store.insertRun({ slot_key: slotKey, slot_date: slotDate, mode: config.mode, state: "claimed" })
      || await store.runBySlot(slotKey);
    if (run) await store.appendEvent(run.id, "claim", "info", { slotKey });
  }
  if (!run) return { ...summary, ok: false, state: "unclaimed" };
  summary.runId = run.id;
  if (TERMINAL_RUN_STATES.includes(run.state)) return { ...summary, state: run.state, done: true };

  const leased = await store.leaseRun(run.id, new Date(now().getTime() + LEASE_MS).toISOString(), now().toISOString());
  if (!leased) return { ...summary, state: run.state, busy: true };
  run = leased;

  const ctx = { store, config, env, deps, fetchImpl, budget, now, slotDate, note };
  try {
    for (let guard = 0; guard < 8 && !TERMINAL_RUN_STATES.includes(run.state); guard += 1) {
      const before = run.state;
      run = await advance(run, ctx);
      if (run.state === before) break; // waiting on time or on Meta
    }
  } finally {
    await store.updateRun(run.id, { lease_until: null }).catch(() => {});
  }
  summary.state = run.state;
  summary.postId = run.post_id || null;
  if (run.graph?.media_id) summary.mediaId = run.graph.media_id;

  // ── Weekly, optional: ask Claude for new post types to review. ──
  if (config.designProposals && config.aiConfigured && budget.has(15_000)
    && DateTime.fromISO(slotDate).weekday === 7) {
    await maybeProposeTypes(ctx).catch((error) =>
      store.appendEvent(null, "design_proposal", "fail", { error: String(error?.code || error?.message || error).slice(0, 200) }));
  }
  return summary;
}

async function advance(run, ctx) {
  const { store, budget } = ctx;
  const step = run.state;
  try {
    if (step === "claimed") return budget.has(14_000) ? await planAndWrite(run, ctx) : run;
    if (step === "generated") return budget.has(5_000) ? await renderAndUpload(run, ctx) : run;
    if (step === "uploaded") return budget.has(4_000) ? await createContainers(run, ctx) : run;
    if (step === "containers") return budget.has(4_000) ? await publishWhenReady(run, ctx) : run;
    if (step === "publishing") return budget.has(4_000) ? await resolvePublishing(run, ctx) : run;
    return run;
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
async function finishRun(store, run, state, reason) {
  const updated = (await store.updateRun(run.id, { state, error: reason ? String(reason).slice(0, 500) : null,
    finished_at: new Date().toISOString(), lease_until: null })) || { ...run, state };
  if (run.post_id) {
    const post = await store.postById(run.post_id).catch(() => null);
    if (post && ["approved", "scheduled"].includes(post.status)) {
      await store.updatePost(post.id, { status: "failed", last_publish_error: String(reason || state).slice(0, 500) });
    }
  }
  await store.appendEvent(run.id, "finish", state === "failed" ? "fail" : "info", { state, reason: reason || null });
  return updated;
}

async function resolveStaleRun({ store, run, config, env, deps, fetchImpl }) {
  // A run that may already have published is resolved, not expired: the
  // container knows whether it went out.
  if (run.state === "publishing" && run.mode === "live" && run.graph?.carousel) {
    try {
      const publisher = makePublisher({ store, config, env, deps, fetchImpl, run });
      const status = await publisher.containerStatus(run.graph.carousel);
      if (status.statusCode === "PUBLISHED") {
        await recordPublished(run, await recoverMediaId(run, publisher, store), { store, publisher });
        return;
      }
    } catch { /* fall through to expiry; the log says why below */ }
  }
  await finishRun(store, run, "expired", `slot ${run.slot_date} ended before the run finished (${run.state})`);
}

/* ── claimed → generated ─────────────────────────────────────────────────── */

async function planAndWrite(run, ctx) {
  const { store, config, env, deps, slotDate, budget } = ctx;

  // The registry first: built-ins exist, stale approvals are superseded.
  const types = await syncRegistry(store);
  const usable = [];
  const unusable = [];
  for (const row of types) {
    if (row.status !== "approved") continue;
    const u = usability(row);
    if (u.usable) usable.push({ id: row.id, label: typeLabel(row), spec: u.spec });
    else unusable.push({ label: typeLabel(row), reason: u.reason });
  }

  const { options, notes } = (deps.buildOptions || channelOptions)(slotDate, env);
  const excluded = Array.isArray(run.plan?.excluded) ? run.plan.excluded : [];
  const eligible = [];
  const refusedByPolicy = [];
  for (const option of options) {
    if (excluded.includes(`${option.eventKey}|${option.formatId}`)) {
      refusedByPolicy.push({ key: option.eventKey, format: option.formatId, reason: "an earlier plan today failed its checks" });
      continue;
    }
    const allowed = autonomyAllowed(option.autonomy, { yellow: config.yellow });
    if (!allowed.allowed) { refusedByPolicy.push({ key: option.eventKey, format: option.formatId, reason: allowed.reason }); continue; }
    const coverage = await store.liveCoverage({ eventKey: option.eventKey, periodKey: option.periodKey });
    if (coverage.length) {
      refusedByPolicy.push({ key: option.eventKey, format: option.formatId,
        reason: `already covered (${coverage[0].origin || "desk"}, ${coverage[0].status})` });
      continue;
    }
    eligible.push(option);
  }

  const history = historyFromRuns(await store.recentRuns({ mode: config.mode, limit: 40 }));
  const { plan, considered } = choosePlan({ options: eligible, types: usable, history, slotDate, rotation: config.rotation });
  const planLog = { considered, refusedByPolicy, unusableTypes: unusable, notes, usableTypes: usable.map((t) => t.label), excluded };

  if (!plan) {
    await store.appendEvent(run.id, "plan", "skip", planLog);
    const why = !usable.length ? "no approved post type is usable yet (approve types in the desk)"
      : !eligible.length ? "nothing the policy allows is uncovered today" : "rotation rules left no option today";
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

  const recent = history.slice(0, config.rotation.nearDuplicateLookback);
  let instruction = "";
  let post = null;
  let result = null;
  let usage = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (attempt === 2 && !budget.has(12_000)) break;
    const written = await writeCopy(plan, { ...ctx, instruction, recent });
    post = written.post;
    usage = written.usage;
    const design = normalizeDesign(post.design, plan.candidate.eventType, plan.formatId);
    const rendered = renderPost({ ...post, design }, renderContext(plan.candidate, design));
    const duplicate = nearDuplicate(post, recent, { threshold: config.rotation.nearDuplicateThreshold });
    result = runPostChecks(post, { candidate: plan.candidate, autonomy: plan.autonomy,
      renderWarnings: rendered.warnings, layout: postCollisions(rendered), duplicate });
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
      return finishRun(store, saved || run, "skipped", `no plan passed the per-post checks after ${plans} tries; nothing was posted`);
    }
    // Still "claimed": the next tick plans again without this option.
    await store.appendEvent(run.id, "plan", "warn", { excluded: nextExcluded, note: "the next tick tries the next-best option" });
    return saved || run;
  }

  const candidate = plan.candidate;
  const family = plan.family;
  const period = candidate.facts?.period || null;
  const row = {
    event_key: candidate.eventKey,
    event_type: candidate.eventType,
    event_payload: candidate,
    calculation_metadata: {
      source: "orbit-x-channel", slot_date: slotDate, local_date: slotDate,
      ...(period ? { editorial_timezone: period.timezone, period_key: period.key, period_start_utc: period.start_utc,
        period_end_utc: period.end_utc, end_exclusive: true } : {}),
    },
    editorial_score: scoreCandidate(candidate, [], slotDate).totalScore,
    score_breakdown: scoreCandidate(candidate, [], slotDate).scores,
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
    status: config.live ? "approved" : "draft",
    approved_at: config.live ? new Date().toISOString() : null,
    editor_notes: config.live
      ? `Approved automatically by the channel policy (${plan.autonomy}) for ${slotDate} with ${plan.type.label}. Every blocking per-post check passed.`
      : `Channel dry run for ${slotDate} with ${plan.type.label} (${plan.autonomy}). Nothing was sent to Instagram.`,
    created_by: null,
    origin: "channel",
    autonomy: plan.autonomy,
    post_type_id: plan.type.id,
    post_type_label: plan.type.label,
  };
  const inserted = await store.insertPost(row);
  if (inserted.conflict) {
    await store.updateRun(run.id, { ...attempted, plan: { ...planSummary(plan), ...planLog }, checks: result.checks, generated });
    return finishRun(store, run, "skipped", `${row.period_key} already has a live post (unique period index)`);
  }
  await store.appendEvent(run.id, "write", "ok", { postId: inserted.post.id, status: row.status, headline: post.headline });
  return (await store.updateRun(run.id, {
    state: "generated", post_id: inserted.post.id, post_type_id: plan.type.id, post_type_label: plan.type.label,
    format: plan.formatId, family, autonomy: plan.autonomy, plan: { ...planSummary(plan), ...planLog },
    checks: result.checks, generated, attempts: 0, error: null,
  })) || run;
}

function planSummary(plan) {
  return { formatId: plan.formatId, eventKey: plan.candidate.eventKey, kind: plan.kind, topicKey: plan.topicKey,
    type: plan.type.label, family: plan.family, autonomy: plan.autonomy, hookStyle: plan.hookStyle,
    captionStructure: plan.captionStructure, score: plan.score };
}

async function writeCopy(plan, { env, deps, fetchImpl, budget, instruction, recent }) {
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
  // The design is the approved type's, whatever the model sent back.
  const post = validateGeneratedPost({ ...parsed, design: designForType(plan.type.spec) }, plan.formatId);
  return { post, usage: generated.usage || null };
}

/* ── generated → uploaded | dry_run_complete ─────────────────────────────── */

async function renderAndUpload(run, { store, config, deps, slotDate }) {
  const row = await store.postById(run.post_id);
  if (!row?.edited_copy || !row?.event_payload) return finishRun(store, run, "failed", "the saved post is missing its copy or facts");
  const post = row.edited_copy;
  const candidate = row.event_payload;
  const design = normalizeDesign(post.design, candidate.eventType, post.format);
  const rendered = renderPost({ ...post, design }, renderContext(candidate, design));
  if (rendered.warnings.length) return finishRun(store, run, "failed", `render warnings: ${rendered.warnings.join("; ")}`);
  const slides = await rasterizePost(rendered, { localDate: row.calculation_metadata?.local_date || slotDate,
    eventKey: candidate.eventKey });
  const media = slides.map((s) => ({ index: s.index, filename: s.filename, jpegFilename: s.jpegFilename,
    width: s.width, height: s.height, pngBytes: s.png.length, jpegBytes: s.jpeg.length,
    pngSha256: sha(s.png), jpegSha256: sha(s.jpeg) }));

  const upload = config.live || config.dryRunUpload;
  if (upload) {
    if (!deps.media) return finishRun(store, run, "failed", "media storage is not configured");
    for (const s of slides) {
      const m = media[s.index];
      m.pngUrl = await deps.media.upload(mediaPath({ slotDate: run.slot_date, postId: row.id, filename: s.filename }), s.png, "image/png");
      m.jpegUrl = await deps.media.upload(mediaPath({ slotDate: run.slot_date, postId: row.id, filename: s.jpegFilename }), s.jpeg, "image/jpeg");
    }
  }
  await store.updatePost(row.id, { media });
  await store.appendEvent(run.id, "render", "ok", { slides: media.length, uploaded: upload,
    files: media.map((m) => m.filename), aspect: design.aspect, family: design.template });

  if (!config.live) {
    const done = await store.updateRun(run.id, { media, state: "dry_run_complete", finished_at: new Date().toISOString() });
    await store.appendEvent(run.id, "dry_run", "info", { note: "dry run complete; nothing was sent to Instagram", postId: row.id });
    return done || run;
  }
  if (!media.every((m) => /^https:\/\//.test(m.jpegUrl || ""))) {
    return finishRun(store, run, "failed", "Meta needs public HTTPS image URLs; storage did not return them");
  }
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
