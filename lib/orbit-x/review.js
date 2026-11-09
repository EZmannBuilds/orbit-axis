// Orbit X :: the review queue (2026-11-09).
//
// THE DEFAULT IS REVIEW, THEN SCHEDULE, THEN PUBLISH. The channel prepares the
// next 7 editorial days as "ready for review" posts. Here a person (the
// Content Desk, or the founder):
//
//   - sees each post's slides as the PNGs that will be published;
//   - may edit its caption and alt text; every per-post check runs again on
//     the edited text, a failing edit is refused, and every edit (kept or
//     refused) is written to the event log with who made it;
//   - approves it with a publish date and time (shown and entered in the
//     editorial timezone, America/Chicago). Yellow posts additionally need an
//     explicit per-post confirmation, and every approval is bound to the exact
//     slide hashes the reviewer was shown;
//   - may unschedule, reschedule, edit or reject it at any point until its
//     publish starts;
//   - may regenerate it, optionally with a template picked by hand.
//
// Approved posts publish at their time from the cron tick (channel.js),
// through OrbitXPublisher, with the same quota, pause and kill-switch checks.
// "Publish now" is an approval for the current minute, driven immediately.
//
// WHO WRITES. The route checks the reviewer's session and admin membership
// first (api.js). The writes then go through the channel's service-role store,
// because the database lets only the channel set publication states; the
// reviewer's id is recorded on the post, the run and every event. Reads may
// use either store.

import { DateTime } from "luxon";
import { channelConfig, killSwitchEngaged } from "./channel-config.js";
import { PUBLISHING_STATES } from "./channel-store.js";
import {
  activeTemplates, checkPost, driveRun, channelContext, finishRun, localParts, neighboursOf, publishWindow,
  defaultPublishAt, scheduleWithin, renderStoredPost, writeCopy, postRow, lookaheadDates, todayIn,
} from "./channel.js";
import { templateStates } from "./post-types.js";
import { normalizeDesign, renderPost } from "./templates.js";
import { coverFit } from "./grid-preview.js";
import { validateGeneratedPost } from "./schemas.js";
import { graphConfig } from "./publisher.js";
import { aiConfig } from "./ai.js";

export class OrbitXReviewError extends Error {
  constructor(message, { status = 409, code = "review_refused", detail = null } = {}) {
    super(message);
    this.name = "OrbitXReviewError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

const refuse = (message, opts) => { throw new OrbitXReviewError(message, opts); };
const EDITABLE_STATES = Object.freeze(["ready_for_review", "approved"]);

async function loadPair(store, postId) {
  const post = await store.postById(postId);
  if (!post || post.origin !== "channel") refuse("No such channel post.", { status: 404, code: "not_found" });
  const run = await store.runByPostId(postId);
  if (!run) refuse("This post has no channel run.", { status: 404, code: "not_found" });
  return { post, run };
}

async function neighbours(store, run, config) {
  const runs = await store.runsBetween(
    DateTime.fromISO(run.slot_date).minus({ days: 30 }).toISODate(), DateTime.fromISO(run.slot_date).plus({ days: 30 }).toISODate());
  const { history, upcoming } = neighboursOf(runs, run.slot_date, { exceptRunId: run.id });
  return [...history, ...upcoming].slice(0, config.rotation.nearDuplicateLookback);
}

/** Hold the run's lease for a desk action, so a tick cannot publish under it. */
async function withLease(store, run, now, fn) {
  const leased = await store.leaseRun(run.id, new Date(now().getTime() + 30_000).toISOString(), now().toISOString());
  if (!leased) refuse("The channel is working on this post right now; try again in a minute.", { code: "busy" });
  try { return await fn(leased); }
  finally { await store.updateRun(run.id, { lease_until: null }).catch(() => {}); }
}

function windowOf(post, run, config) {
  if (run.publish_window_start && run.publish_by) return { start: run.publish_window_start, end: run.publish_by };
  return publishWindow({ candidate: post.event_payload, formatId: post.selected_format, slotDate: run.slot_date, timezone: config.timezone });
}

/* ── The week view ────────────────────────────────────────────────────────── */

/**
 * Every day in the lookahead, plus anything approved or publishing outside it,
 * with what a reviewer needs on one screen. Times are UTC instants plus local
 * parts in the editorial timezone.
 */
export async function weekView(store, { env = process.env, now = () => new Date() } = {}) {
  const config = channelConfig(env);
  const today = todayIn(now(), config.timezone);
  const days = lookaheadDates(today, config.lookaheadDays);
  const runs = await store.runsBetween(DateTime.fromISO(today).minus({ days: 2 }).toISODate(), days[days.length - 1]);
  const extra = (await store.runsInStates(["approved", ...PUBLISHING_STATES])).filter((r) => !runs.some((x) => x.id === r.id));
  const rows = [];
  for (const run of [...runs, ...extra].sort((a, b) => a.slot_date.localeCompare(b.slot_date))) {
    const post = run.post_id ? await store.postById(run.post_id) : null;
    const window = post ? windowOf(post, run, config) : null;
    const suggested = window ? defaultPublishAt({ slotDate: run.slot_date, timezone: config.timezone,
      time: config.publishTime, window }) : null;
    rows.push({
      runId: run.id, slotDate: run.slot_date, state: run.state, mode: run.mode, format: run.format,
      template: run.post_type_label, autonomy: run.autonomy, error: run.error,
      editable: EDITABLE_STATES.includes(run.state),
      needsExplicitApproval: run.autonomy === "yellow",
      scheduledFor: run.scheduled_for || null, scheduledLocal: localParts(run.scheduled_for, config.timezone),
      suggestedLocal: localParts(suggested, config.timezone),
      window: window ? { start: localParts(window.start, config.timezone), end: localParts(window.end, config.timezone) } : null,
      reviewedBy: run.reviewed_by || null, reviewedAt: run.reviewed_at || null,
      failedChecks: (run.checks || []).filter((c) => !c.passed && c.blocking).map((c) => c.id),
      post: post ? {
        id: post.id, status: post.status, headline: post.edited_copy?.headline || "",
        caption: post.edited_copy?.caption || "", altText: post.edited_copy?.altText || "",
        slides: post.edited_copy?.slides?.length || 0, permalink: post.permalink || null,
        externalMediaId: post.external_media_id || null, publishedAt: post.published_at || null,
      } : null,
    });
  }
  const control = await store.getControl();
  return {
    timezone: config.timezone, today, days, mode: config.mode, publishTime: config.publishTime,
    canPublish: graphConfig(env).configured && !killSwitchEngaged(env) && !control?.paused,
    publishBlockedReason: !graphConfig(env).configured ? "Instagram is not configured on this deployment"
      : killSwitchEngaged(env) ? "the kill switch is engaged" : control?.paused ? "the channel is paused" : null,
    rows,
  };
}

/* ── Previews ─────────────────────────────────────────────────────────────── */

/**
 * The slides as the PNGs that will be published, rendered now from the stored
 * copy, with the hashes an approval must quote back.
 */
export async function previewSlides(store, { postId }) {
  const { post, run } = await loadPair(store, postId);
  const { slides, media } = await renderStoredPost(post, run.slot_date);
  const prepared = (run.media || []).map((m) => m.pngSha256);
  return {
    postId, runId: run.id, autonomy: post.autonomy,
    matchesPrepared: prepared.length === media.length && media.every((m, i) => m.pngSha256 === prepared[i]),
    slides: slides.map((s, i) => ({ index: s.index, filename: s.filename, sha256: media[i].pngSha256,
      dataUrl: `data:image/png;base64,${s.png.toString("base64")}` })),
  };
}

/* ── Edit caption and alt text ────────────────────────────────────────────── */

export async function editPost(store, { postId, caption, altText, actor, env = process.env, now = () => new Date() }) {
  const config = channelConfig(env);
  const { post, run } = await loadPair(store, postId);
  if (!EDITABLE_STATES.includes(run.state)) refuse(`This post is ${run.state}; it can no longer be edited.`, { code: "locked" });
  const before = { caption: post.edited_copy.caption, altText: post.edited_copy.altText };
  const after = {
    caption: caption === undefined ? before.caption : String(caption),
    altText: altText === undefined ? before.altText : String(altText),
  };
  if (after.caption === before.caption && after.altText === before.altText) return { ok: true, unchanged: true, checks: run.checks };

  return withLease(store, run, now, async () => {
    let edited;
    try {
      edited = validateGeneratedPost({ ...post.edited_copy, caption: after.caption, altText: after.altText }, post.selected_format);
    } catch (error) {
      await store.appendEvent(run.id, "review_edit", "fail", { actor, fields: changedFields(before, after), problems: error.problems || [] });
      refuse("The edit does not fit the format.", { status: 422, code: "invalid", detail: { problems: error.problems || [] } });
    }
    const result = checkPost(edited, { candidate: post.event_payload, autonomy: post.autonomy,
      neighbours: await neighbours(store, run, config), rotation: config.rotation });
    const failed = result.checks.filter((c) => !c.passed && c.blocking);
    await store.appendEvent(run.id, "review_edit", failed.length ? "fail" : "ok", {
      actor, fields: changedFields(before, after), before, after,
      failedChecks: failed.map((c) => ({ id: c.id, detail: c.detail })),
    });
    if (failed.length) {
      refuse("The edited text did not pass the per-post checks; nothing was saved.", { status: 422, code: "checks_failed",
        detail: { checks: result.checks } });
    }
    await store.updatePost(post.id, { edited_copy: edited });
    await store.updateRun(run.id, { checks: result.checks,
      generated: { ...(run.generated || {}), caption: edited.caption } });
    return { ok: true, checks: result.checks };
  });
}

function changedFields(before, after) {
  return Object.keys(after).filter((k) => after[k] !== before[k]);
}

/* ── Approve, with a publish date and time ────────────────────────────────── */

/**
 * @param {object} args
 * @param {string[]} args.seenSlides  the PNG hashes the reviewer was shown, in order
 * @param {boolean} [args.confirmYellow] required for Yellow posts
 * @param {string} args.date  YYYY-MM-DD in the editorial timezone
 * @param {string} args.time  HH:MM in the editorial timezone
 * @param {boolean} [args.publishNow] approve for this minute and drive it immediately
 */
export async function approvePost(store, { postId, actor, seenSlides, confirmYellow = false, date, time, publishNow = false,
  env = process.env, deps = {} }) {
  const now = deps.now || (() => new Date());
  const config = channelConfig(env);
  const { post, run } = await loadPair(store, postId);
  if (!EDITABLE_STATES.includes(run.state)) refuse(`This post is ${run.state}; it cannot be approved now.`, { code: "locked" });

  // The approval is bound to what was shown: the current rendering must be
  // the prepared one, and the reviewer must quote its hashes back.
  const { media } = await renderStoredPost(post, run.slot_date);
  const current = media.map((m) => m.pngSha256);
  const prepared = (run.media || []).map((m) => m.pngSha256);
  if (prepared.length !== current.length || current.some((h, i) => h !== prepared[i])) {
    refuse("The rendering changed since this post was prepared. Regenerate it, then review the new slides.", { code: "stale_render" });
  }
  if (!Array.isArray(seenSlides) || seenSlides.length !== current.length || seenSlides.some((h, i) => h !== current[i])) {
    refuse("Open the slide previews and review the current slides before approving.", { code: "slides_not_seen" });
  }
  if (post.autonomy === "yellow" && confirmYellow !== true) {
    refuse("This is a Yellow (interpretive) post: confirm that you looked at every slide.", { code: "yellow_confirmation" });
  }
  const result = checkPost(post.edited_copy, { candidate: post.event_payload, autonomy: post.autonomy,
    neighbours: await neighbours(store, run, config), rotation: config.rotation });
  if (!result.passed) refuse("This post no longer passes its checks.", { status: 422, code: "checks_failed", detail: { checks: result.checks } });

  const window = windowOf(post, run, config);
  let at;
  if (publishNow) {
    if (killSwitchEngaged(env)) refuse("The kill switch is engaged; nothing can publish.", { code: "killed" });
    if ((await store.getControl())?.paused) refuse("The channel is paused; resume it to publish.", { code: "paused" });
    if (!graphConfig(env).configured) refuse("Instagram is not configured on this deployment.", { status: 503, code: "graph_unconfigured" });
    at = now().toISOString();
    if (Date.parse(at) < Date.parse(window.start) || Date.parse(at) >= Date.parse(window.end)) {
      refuse("This post's facts do not apply right now.", { code: "outside_window" });
    }
  } else {
    const parsed = scheduleWithin({ date, time, timezone: config.timezone, window, now: now() });
    if (!parsed.ok) refuse(`That publish time cannot be used: ${parsed.problem}.`, { status: 422, code: "bad_time" });
    at = parsed.at;
  }

  const outcome = await withLease(store, run, now, async () => {
    const reviewedAt = now().toISOString();
    if (post.status !== "approved") {
      try {
        await store.updatePost(post.id, { status: "approved", approved_at: reviewedAt, reviewed_by: actor || null,
          reviewed_at: reviewedAt, publish_at: at });
      } catch (error) {
        if (/conflict|live period/i.test(String(error?.code || error?.message))) {
          refuse(`${post.period_key} already has a live post; this one cannot be approved.`, { code: "period_taken" });
        }
        throw error;
      }
    } else {
      await store.updatePost(post.id, { publish_at: at, reviewed_by: actor || null, reviewed_at: reviewedAt });
    }
    const updated = await store.updateRun(run.id, { state: "approved", scheduled_for: at, reviewed_by: actor || null,
      reviewed_at: reviewedAt, publish_window_start: window.start, publish_by: window.end });
    await store.appendEvent(run.id, run.state === "approved" ? "review_reschedule" : "review_approve", "ok", {
      actor, autonomy: post.autonomy, scheduledFor: at, local: localParts(at, config.timezone)?.label,
      seenSlides: current.length, yellowConfirmed: post.autonomy === "yellow" ? true : undefined,
    });
    return updated;
  });

  if (publishNow) {
    const ctx = channelContext({ env, store, deps });
    const driven = await driveRun(outcome, ctx);
    return { ok: true, state: driven.state, scheduledFor: at, busy: Boolean(driven.busy) };
  }
  return { ok: true, state: outcome.state, scheduledFor: at, scheduledLocal: localParts(at, config.timezone) };
}

/** Back to the review queue. Allowed until the publish starts. */
export async function unschedulePost(store, { postId, actor, env = process.env, now = () => new Date() }) {
  const { post, run } = await loadPair(store, postId);
  if (run.state !== "approved") refuse(`This post is ${run.state}; only an approved, not-yet-published post can be unscheduled.`, { code: "locked" });
  return withLease(store, run, now, async () => {
    await store.updatePost(post.id, { status: "draft", approved_at: null, publish_at: null });
    await store.updateRun(run.id, { state: "ready_for_review", scheduled_for: null });
    await store.appendEvent(run.id, "review_unschedule", "ok", { actor, was: run.scheduled_for });
    return { ok: true, state: "ready_for_review" };
  });
}

export async function rejectPost(store, { postId, actor, reason = "", env = process.env, now = () => new Date() }) {
  const { run } = await loadPair(store, postId);
  if (!EDITABLE_STATES.includes(run.state)) refuse(`This post is ${run.state}; it can no longer be rejected.`, { code: "locked" });
  return withLease(store, run, now, async (leased) => {
    await store.appendEvent(run.id, "review_reject", "ok", { actor, reason: String(reason || "").slice(0, 300) || null });
    const done = await finishRun(store, leased, "review_rejected", String(reason || "rejected in review").slice(0, 200));
    return { ok: true, state: done.state };
  });
}

/* ── Regenerate, optionally with a hand-picked template ──────────────────── */

export async function regeneratePost(store, { postId, actor, typeId = null, instruction = "", env = process.env, deps = {} }) {
  const now = deps.now || (() => new Date());
  const config = channelConfig(env);
  const { post, run } = await loadPair(store, postId);
  if (run.state !== "ready_for_review") {
    refuse(run.state === "approved" ? "Unschedule this post before regenerating it." : `This post is ${run.state}; it cannot be regenerated.`,
      { code: "locked" });
  }
  if (!aiConfig(env).configured && !deps.generate) refuse("Regenerating needs the AI provider (ORBIT_X_AI_API_KEY).", { status: 503, code: "ai_unconfigured" });

  const { states } = await activeTemplates(store);
  const pick = typeId ? states.find((t) => t.id === typeId) : states.find((t) => t.label === run.post_type_label);
  if (!pick) refuse("That template is not available.", { status: 404, code: "no_template" });
  // A hand pick may be inactive (a person chose it), but never blocked.
  if (!pick.activatable) refuse(`That template cannot be used: ${pick.blockedReason}.`, { code: "template_blocked" });
  if (!pick.formats.includes(post.selected_format)) refuse(`That template does not carry ${post.selected_format}.`, { code: "template_format" });

  const plan = {
    candidate: post.event_payload, formatId: post.selected_format, autonomy: post.autonomy, kind: run.plan?.kind || null,
    topicKey: run.plan?.topicKey || null, periodKey: post.period_key,
    type: { id: pick.id, label: pick.label, spec: pick.spec, typeKey: pick.typeKey }, family: pick.spec.family,
    hookStyle: run.plan?.hookStyle || pick.spec.voice.hookStyles[0],
    captionStructure: run.plan?.captionStructure || pick.spec.voice.captionStructures[0],
  };
  const ctx = channelContext({ env, store, deps });
  const near = await neighbours(store, run, config);

  return withLease(store, run, now, async () => {
    const written = await writeCopy(plan, { ...ctx, instruction: String(instruction || "").slice(0, 500), recent: near });
    const result = checkPost(written.post, { candidate: plan.candidate, autonomy: plan.autonomy, neighbours: near, rotation: config.rotation });
    await store.appendEvent(run.id, "review_regenerate", result.passed ? "ok" : "fail", { actor, template: pick.label,
      manualPick: Boolean(typeId), instruction: instruction || null, checks: result.checks.filter((c) => !c.passed && c.blocking) });
    if (!result.passed) {
      refuse("The regenerated copy did not pass the per-post checks; the current post is unchanged.", { status: 422,
        code: "checks_failed", detail: { checks: result.checks } });
    }
    const inserted = await store.insertPost(postRow({ plan, post: written.post, slotDate: run.slot_date, mode: run.mode }));
    if (inserted.conflict) refuse("This period already has a live post.", { code: "period_taken" });
    await store.updatePost(post.id, { status: "rejected", rejection_reason: "regenerated" });
    const { rendered, media } = await renderStoredPost(inserted.post, run.slot_date);
    if (rendered.warnings.length) refuse(`The new rendering has warnings: ${rendered.warnings.join("; ")}`, { status: 422, code: "render" });
    await store.updatePost(inserted.post.id, { media });
    await store.updateRun(run.id, { post_id: inserted.post.id, post_type_id: pick.id, post_type_label: pick.label,
      family: pick.spec.family, media, checks: result.checks,
      plan: { ...(run.plan || {}), type: pick.label, family: pick.spec.family, regeneratedBy: actor || null },
      generated: { headline: written.post.headline, hook: (written.post.slides?.[0]?.body || "").slice(0, 200),
        caption: written.post.caption, usage: written.usage } });
    return { ok: true, postId: inserted.post.id, template: pick.label };
  });
}

/* ── Templates: active and preferred ─────────────────────────────────────── */

export async function templatePicker(store) {
  const { rows } = await activeTemplates(store);
  const [settings, preferences] = await Promise.all([store.listTemplateSettings(), store.listFormatPreferences()]);
  return { templates: templateStates(rows, settings, preferences), preferences };
}

export async function setTemplateActive(store, { typeKey, active, actor }) {
  const { templates } = await templatePicker(store);
  const t = templates.find((x) => x.typeKey === typeKey);
  if (!t) refuse("No such template.", { status: 404, code: "not_found" });
  if (active && !t.activatable) refuse(`This template cannot be activated: ${t.blockedReason}.`, { code: "template_blocked" });
  await store.setTemplateActive(typeKey, Boolean(active), actor || null);
  await store.appendEvent(null, "template_active", "ok", { actor, typeKey, active: Boolean(active) });
  return { ok: true, typeKey, active: Boolean(active) };
}

export async function setPreference(store, { format, typeKey, actor }) {
  const { templates } = await templatePicker(store);
  if (typeKey) {
    const t = templates.find((x) => x.typeKey === typeKey);
    if (!t) refuse("No such template.", { status: 404, code: "not_found" });
    if (!t.activatable) refuse(`This template cannot be preferred: ${t.blockedReason}.`, { code: "template_blocked" });
    if (!t.formats.includes(format)) refuse(`${t.label} does not carry ${format}.`, { code: "template_format" });
  }
  await store.setFormatPreference(format, typeKey || null, actor || null);
  await store.appendEvent(null, "template_preferred", "ok", { actor, format, typeKey: typeKey || null });
  return { ok: true, format, typeKey: typeKey || null };
}


/* ── The profile grid preview ─────────────────────────────────────────────── */

/**
 * The next nine queued posts as they would sit on the profile: newest
 * (latest publish time) first, each tile the first slide, cropped to the
 * profile's 3:4. Posts that are queued, approved or publishing count; nothing
 * is uploaded and nothing is published by looking.
 *
 * @returns {Promise<{ tiles: Array, queued: number }>}
 */
export async function gridTiles(store, { env = process.env, now = () => new Date(), limit = 9 } = {}) {
  const config = channelConfig(env);
  const today = todayIn(now(), config.timezone);
  const runs = await store.runsBetween(DateTime.fromISO(today).minus({ days: 1 }).toISODate(),
    DateTime.fromISO(today).plus({ days: 30 }).toISODate());
  const queued = runs.filter((r) => r.post_id && ["ready_for_review", "approved", "uploaded", "containers", "publishing"].includes(r.state));
  const when = (r) => r.scheduled_for || r.publish_window_start || `${r.slot_date}T00:00:00Z`;
  const picked = queued.sort((a, b) => when(a).localeCompare(when(b))).slice(0, limit).reverse();
  const tiles = [];
  for (const run of picked) {
    const post = await store.postById(run.post_id);
    if (!post?.edited_copy || !post?.event_payload) continue;
    const candidate = post.event_payload;
    const design = normalizeDesign(post.edited_copy.design, candidate.eventType, post.edited_copy.format);
    const rendered = renderPost({ ...post.edited_copy, design }, { eventType: candidate.eventType, title: candidate.title,
      facts: candidate.facts, sky: candidate.facts?.planets || [], design });
    tiles.push({ runId: run.id, slotDate: run.slot_date, state: run.state, template: run.post_type_label,
      scheduledLocal: localParts(run.scheduled_for, config.timezone)?.label || null, svg: coverFit(rendered.slides[0]?.svg || "") });
  }
  return { tiles, queued: queued.length };
}
