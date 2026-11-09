// Orbit X :: the HTTP boundary (Dev Update 5.0).
//
// GATES, IN ORDER, EVERY REQUEST: the feature flag (server-controlled — a
// production deploy with the flag unset has no Orbit X at all), then the
// session (create-app's requireAuth), then admin membership (the database
// fact in orbit_x_admins). A non-admin gets 404, not 403: an internal tool
// does not advertise its existence to accounts that cannot use it. And RLS
// re-asks the membership question at every row regardless of what this file
// concludes.
//
// FACTS NEVER COME FROM THE BROWSER. Generation and saving both rebuild the
// candidate server-side from the engine for the named date; a client-supplied
// "facts" object is ignored by construction, because a browser that can
// author facts can author astronomy.

import { atlasEntry } from "../symbol-atlas/index.js";
import { formatFor, stripPlanets } from "./candidates.js";
import { candidatesForDate, readingForDate } from "./engine-facts.js";
import { scoreCandidate, rankCandidates } from "./scoring.js";
import { FORMATS, TEMPLATE, ROLE_SEQUENCES } from "./formats.js";
import { TEMPLATES, ASPECTS, DENSITIES, SAFE_LIMITS, recommendTemplate } from "./templates.js";
import { buildScaffold, buildReadingScaffold, signFromTitle } from "./language.js";
import { READING_TYPES, readingFormatFor, attachReadingMetadata } from "./readings.js";
import { buildPacket, systemPrompt } from "./prompts.js";
import { aiConfig, generateCopy, OrbitXAiError } from "./ai.js";
import { parseModelJson, validateGeneratedPost, draftCompleteness, OrbitXValidationError } from "./schemas.js";
import { auditCopy, adviseCopy, verifyFactIntegrity } from "./editorial.js";
import { orbitXStore, OrbitXStoreError } from "./store.js";
import { deskChannelStore, OrbitXChannelStoreError } from "./channel-store.js";
import { channelStatusSummary } from "./channel-config.js";
import {
  syncRegistry, usability, typeLabel, renderTypeSample, renderFingerprint, validatePostTypeSpec,
  TYPE_TRANSITIONS, CHANNEL_FORMATS,
} from "./post-types.js";
import { proposePostTypes } from "./design-proposals.js";
import { EVERGREEN_TOPICS, evergreenCandidate } from "./channel-candidates.js";

/** The server-controlled gate. String-equal on purpose: an accidental "1" or
 *  "yes" in an environment stays OFF. */
export function orbitXEnabled(env = process.env) {
  return env.ORBIT_X_ENABLED === "true";
}

function candidateForDraft(formatId, eventKey, dateIso, tz, env) {
  const readingType = FORMATS[formatId]?.readingType;
  if (readingType) {
    const result = readingForDate(readingType, dateIso, env);
    return result.candidate.eventKey === eventKey ? result : { ...result, candidate: null };
  }
  return findCandidate(eventKey, dateIso, tz, env);
}

/** Trusted symbolic vocabulary (§35): the Symbol Atlas already carries
 *  reviewed theme lists for signs and planets. Nothing here invents a new
 *  astrology database — no matching entry simply means no suggestions. */
function themesFor(candidate) {
  try {
    if (["full_moon", "new_moon", "collective_reading"].includes(candidate.eventType)) {
      const sign = candidate.facts?.sky_at_event?.moon_sign || candidate.facts?.moon_sign;
      const entry = sign ? atlasEntry("signs", sign.toLowerCase()) : null;
      return entry ? { subject: sign, list: entry.themes } : null;
    }
    if (candidate.eventType === "sun_ingress") {
      const sign = signFromTitle(candidate.title);
      const entry = sign ? atlasEntry("signs", sign.toLowerCase()) : null;
      return entry ? { subject: sign, list: entry.themes } : null;
    }
    if (["mercury_rx", "mercury_direct"].includes(candidate.eventType)) {
      const entry = atlasEntry("planets", "mercury");
      return entry ? { subject: "Mercury", list: entry.themes } : null;
    }
  } catch { /* absence over invention */ }
  return null;
}

/** Everything the desk needs to render designs: registry, not magic numbers. */
function designCatalog() {
  return {
    templates: TEMPLATES, aspects: ASPECTS, densities: DENSITIES,
    roleSequences: ROLE_SEQUENCES, safeLimits: SAFE_LIMITS,
  };
}

/** The four recommendations, and only these (owner decision, Dev Update 5.3):
 *  a Daily, Weekly, and Monthly reading, plus the next Moon readings. The
 *  period readings are built by the same engine call the Collective Readings
 *  bar uses, so a reading opened from the list and one opened from the bar are
 *  the same post — not two code paths that could drift apart. */
async function scoredCandidates(store, dateIso, tz, env) {
  const { context, candidates: moons, skipped, setAside } = candidatesForDate(dateIso, tz, env);

  const readings = [];
  for (const type of READING_TYPES) {
    try {
      readings.push(readingForDate(type, dateIso, env).candidate);
    } catch {
      // One period failing to calculate must not empty the whole desk; the
      // others still stand, and the absence shows as a missing row.
    }
  }

  const history = await store.history({ limit: 100 });
  const scored = [...readings, ...moons].map((candidate) => ({
    candidate,
    score: scoreCandidate(candidate, history, context.local_date),
    suggestedFormat: formatFor(candidate),
  }));
  return { context, skipped, setAside, ranked: rankCandidates(scored) };
}

function findCandidate(eventKey, dateIso, tz, env) {
  const { context, candidates } = candidatesForDate(dateIso, tz, env);
  const hit = candidates.find((c) => c.eventKey === eventKey);
  return { context, candidate: hit || null };
}

const fail = (error) => {
  if (error instanceof OrbitXValidationError) {
    return { status: 422, body: { ok: false, error: "Generated output failed validation.", problems: error.problems } };
  }
  if (error instanceof OrbitXAiError || error instanceof OrbitXStoreError || error instanceof OrbitXChannelStoreError) {
    return { status: error.status, body: { ok: false, error: error.message } };
  }
  return { status: 502, body: { ok: false, error: "Orbit X request failed." } };
};

/* ── The channel, seen from the desk (Dev Update 6.1) ─────────────────────── */

/** A live engine candidate for a type's sample render, or null. Samples use
 *  today's real facts; only the interpretive copy is a labelled placeholder. */
function liveSampleCandidate(formatId, dateIso, env) {
  try {
    const readingType = FORMATS[formatId]?.readingType;
    if (readingType) return readingForDate(readingType, dateIso, env).candidate;
    if (formatId === "something_changed") return candidatesForDate(dateIso, null, env).candidates[0] || null;
    const topic = EVERGREEN_TOPICS.find((t) => t.format === formatId);
    return topic ? evergreenCandidate(topic) : null;
  } catch { return null; }
}

function typeSummary(row) {
  const u = usability(row);
  const checked = validatePostTypeSpec(row.spec, { allowRetiredFamilyVersion: true });
  const layout = checked.ok ? renderFingerprint(checked.spec).layout : [];
  return {
    id: row.id, label: typeLabel(row), type_key: row.type_key, version: row.version, name: row.name,
    description: row.description, status: row.status, source: row.source, proposal_notes: row.proposal_notes,
    spec: row.spec, proposed_at: row.proposed_at, approved_at: row.approved_at, approved_by: row.approved_by,
    decided_at: row.decided_at, decision_reason: row.decision_reason,
    usable: u.usable, unusableReason: row.status === "approved" && !u.usable ? u.reason : null,
    layout,
  };
}

function runSummary(run) {
  return {
    id: run.id, slot_date: run.slot_date, mode: run.mode, state: run.state, format: run.format,
    family: run.family, post_type_label: run.post_type_label, autonomy: run.autonomy, post_id: run.post_id,
    error: run.error, created_at: run.created_at, finished_at: run.finished_at,
    media_id: run.graph?.mediaId || null, permalink: run.graph?.permalink || null,
    headline: run.generated?.headline || null,
    failedChecks: (run.checks || []).filter((c) => !c.passed && c.blocking).map((c) => ({ id: c.id, detail: c.detail })),
    plan: run.plan ? { formatId: run.plan.formatId, type: run.plan.type, hookStyle: run.plan.hookStyle,
      captionStructure: run.plan.captionStructure, considered: run.plan.considered || [],
      refusedByPolicy: run.plan.refusedByPolicy || [] } : null,
  };
}

async function handleChannelDeskRoute(method, route, searchParams, body, auth, { env, cstore, fetchImpl }) {
  if (route === "/api/orbit-x/channel" && method === "GET") {
    // The desk syncs the registry too, so built-ins appear for approval
    // before the cron has ever run. RLS lets an admin insert proposals only.
    const types = await syncRegistry(cstore);
    const [control, runs] = await Promise.all([cstore.getControl(), cstore.recentRuns({ limit: 30 })]);
    return { status: 200, body: { ok: true, status: channelStatusSummary(env), control,
      formats: CHANNEL_FORMATS, types: types.map(typeSummary), runs: runs.map(runSummary) } };
  }

  const eventsMatch = route.match(/^\/api\/orbit-x\/channel\/runs\/([0-9a-f-]{36})\/events$/);
  if (eventsMatch && method === "GET") {
    return { status: 200, body: { ok: true, events: await cstore.eventsForRun(eventsMatch[1]) } };
  }

  if (route === "/api/orbit-x/channel/pause" && method === "POST") {
    const control = await cstore.setControl({ paused: body?.paused === true,
      reason: body?.reason ? String(body.reason) : null, updatedBy: auth.ownerId });
    return { status: 200, body: { ok: true, control } };
  }

  if (route === "/api/orbit-x/post-types/propose" && method === "POST") {
    const existing = await cstore.listPostTypes();
    const { accepted, refused, usage } = await proposePostTypes({ env, fetchImpl, existing, count: 2 });
    const inserted = accepted.length ? await cstore.insertPostTypes(accepted) : [];
    return { status: 200, body: { ok: true, proposed: inserted.map(typeSummary), refused, usage } };
  }

  const sampleMatch = route.match(/^\/api\/orbit-x\/post-types\/([0-9a-f-]{36})\/sample$/);
  if (sampleMatch && method === "GET") {
    const row = await cstore.postTypeById(sampleMatch[1]);
    if (!row) return { status: 404, body: { ok: false, error: "No such post type." } };
    const formatId = String(searchParams.get("format") || row.spec?.formats?.[0] || "");
    if (!row.spec?.formats?.includes(formatId)) return { status: 400, body: { ok: false, error: "This type does not carry that format." } };
    const live = liveSampleCandidate(formatId, searchParams.get("date"), env);
    const { rendered } = renderTypeSample(row.spec, formatId, live);
    return { status: 200, body: { ok: true, label: typeLabel(row), format: formatId,
      facts: live ? "live engine facts" : "fixed fixture facts",
      notice: "SAMPLE: the facts are calculated; the interpretive lines are placeholders, never published.",
      slides: rendered.slides.map((slide) => slide.svg), warnings: rendered.warnings } };
  }

  const typeMatch = route.match(/^\/api\/orbit-x\/post-types\/([0-9a-f-]{36})$/);
  if (typeMatch && method === "PATCH") {
    const row = await cstore.postTypeById(typeMatch[1]);
    if (!row) return { status: 404, body: { ok: false, error: "No such post type." } };
    const to = String(body?.status || "");
    if (!(TYPE_TRANSITIONS[row.status] || []).includes(to)) {
      return { status: 409, body: { ok: false, error: `A ${row.status} post type cannot become ${to}.` } };
    }
    if (to === "approved") {
      // Approval binds to what the renderer draws TODAY. A version the
      // renderer has moved past cannot be approved; its successor can.
      const u = usability({ ...row, status: "approved" });
      if (!u.usable) return { status: 409, body: { ok: false, error: `This version cannot be approved: ${u.reason}.` } };
    }
    const saved = await cstore.updatePostType(row.id, { status: to,
      decision_reason: body?.reason ? String(body.reason).slice(0, 300) : null });
    return { status: 200, body: { ok: true, type: typeSummary(saved) } };
  }
  return null;
}

/**
 * @returns {Promise<{status:number, body:object}|null>} null = not ours
 */
export async function handleOrbitXRoute(method, route, searchParams, body, auth, deps = {}) {
  const env = deps.env || process.env;
  if (!orbitXEnabled(env)) return { status: 404, body: { ok: false, error: "Not found." } };
  if (!auth?.ownerId) return { status: 401, body: { ok: false, error: "Sign-in required." } };

  const store = deps.store || orbitXStore(auth, { fetchImpl: deps.fetchImpl || fetch });

  let admin;
  try { admin = await store.isAdmin(); }
  catch (error) { return fail(error); }
  if (!admin) return { status: 404, body: { ok: false, error: "Not found." } };

  const tz = searchParams?.get?.("tz") || body?.tz || null;

  try {
    if (route.startsWith("/api/orbit-x/channel") || route.startsWith("/api/orbit-x/post-types")) {
      const cstore = deps.channelStore || deskChannelStore(auth, { fetchImpl: deps.fetchImpl || fetch });
      const handled = await handleChannelDeskRoute(method, route, searchParams, body, auth,
        { env, cstore, fetchImpl: deps.fetchImpl || fetch });
      if (handled) return handled;
    }

    if (route === "/api/orbit-x/candidates" && method === "GET") {
      const { context, skipped, setAside, ranked } = await scoredCandidates(store, searchParams.get("date"), tz, env);
      // Duplicate flags for the list view, one query per shown key kept cheap
      // by asking only for the top of the ranking.
      const withCoverage = await Promise.all(ranked.slice(0, 30).map(async (entry) => ({
        ...entry,
        coverage: await store.coverageFor(entry.candidate.eventKey),
      })));
      return { status: 200, body: { ok: true,
        localDate: context.local_date, contextVersion: context.context_version,
        candidates: withCoverage, skipped, setAside, formats: FORMATS, template: TEMPLATE,
        // Dev Update 5.1: the design catalog and the current sky, so the desk
        // renders templates and the Sky Strip from engine data, never samples.
        ...designCatalog(),
        sky: stripPlanets(context.planets),
        moon: { phase_name: context.moon_phase_name, sign: context.moon?.sign || null,
          illumination_percent: context.illumination_percent, waxing: context.is_waxing === true },
        recommendedTemplates: Object.fromEntries(withCoverage.map((e) =>
          [e.candidate.eventKey, recommendTemplate(e.candidate.eventType, e.suggestedFormat)])),
        // A state, never an error: with no provider configured the desk runs
        // whole on manual drafting, and the UI hides Generate rather than
        // rendering a button that apologises.
        aiAvailable: aiConfig(env).configured } };
    }

    if (route === "/api/orbit-x/readings" && method === "GET") {
      const type = String(searchParams.get("type") || "daily");
      if (!READING_TYPES.includes(type)) return { status: 400, body: { ok: false, error: "Unknown reading type." } };
      const { context, candidate, period } = readingForDate(type, searchParams.get("date"), env);
      const coverage = await store.coverageFor(candidate.eventKey);
      return { status: 200, body: { ok: true, candidate, period, coverage,
        format: readingFormatFor(type), formats: FORMATS, ...designCatalog(),
        editorialTimezone: period.timezone, aiAvailable: aiConfig(env).configured,
        calculationMetadata: { context_version: context.context_version,
          local_date: context.local_date, period_start_utc: period.start_utc,
          period_end_utc: period.end_utc, end_exclusive: true } } };
    }

    if (route === "/api/orbit-x/manual" && method === "POST") {
      const formatId = String(body?.format || "");
      if (!FORMATS[formatId]) return { status: 400, body: { ok: false, error: "Unknown format." } };
      const { context, candidate } = candidateForDraft(formatId, String(body?.eventKey || ""), body?.date, tz, env);
      if (!candidate) return { status: 404, body: { ok: false, error: "No such candidate for that date." } };
      // No model, no key, no network: the scaffold is built from the verified
      // candidate plus trusted Atlas themes. Derived fields arrive
      // publishable; interpretive fields arrive EMPTY, with the guidance in
      // `suggestions` — UI material that can never reach stored copy.
      const { post: scaffold, suggestions } = FORMATS[formatId].readingType
        ? buildReadingScaffold(candidate, formatId)
        : buildScaffold(candidate, formatId, { themes: themesFor(candidate) });
      const post = validateGeneratedPost(scaffold, formatId, { requireComplete: false });
      return { status: 200, body: { ok: true, post, candidate, usage: null, manual: true,
        suggestions, completeness: draftCompleteness(post),
        recommendedTemplate: recommendTemplate(candidate.eventType, formatId),
        calculationMetadata: { context_version: context.context_version, local_date: context.local_date } } };
    }

    if (route === "/api/orbit-x/generate" && method === "POST") {
      const formatId = String(body?.format || "");
      if (!FORMATS[formatId]) return { status: 400, body: { ok: false, error: "Unknown format." } };
      const { context, candidate } = candidateForDraft(formatId, String(body?.eventKey || ""), body?.date, tz, env);
      if (!candidate) return { status: 404, body: { ok: false, error: "No such candidate for that date. The engine, not the browser, owns the facts." } };

      const history = await store.history({ limit: 20 });
      const recentTopics = history.map((row) => row.event_key);
      const packet = buildPacket(candidate, formatId, recentTopics, body?.instruction);
      const generated = await generateCopy({ system: systemPrompt(), packet, env, fetchImpl: deps.fetchImpl });
      // Readings carry structural metadata the model must not author: the
      // period key and label are engine facts, and theme/oneSentence are
      // mirrors of copy it already wrote. Grafted from the candidate before
      // validation, so the schema's match rules are structural, not hopeful.
      const post = validateGeneratedPost(
        attachReadingMetadata(parseModelJson(generated.text), candidate, formatId), formatId);

      const findings = [...auditCopy(post), ...verifyFactIntegrity(post, candidate.facts)];
      if (findings.length) {
        // Refused, and the candidate survives untouched — retry costs a click.
        return { status: 422, body: { ok: false, error: "Generated copy violated editorial rules.",
          findings, retryable: true } };
      }
      return { status: 200, body: { ok: true, post, candidate, usage: generated.usage,
        calculationMetadata: { context_version: context.context_version, local_date: context.local_date } } };
    }

    if (route === "/api/orbit-x/posts" && method === "POST") {
      const formatId = String(body?.format || "");
      if (!FORMATS[formatId]) return { status: 400, body: { ok: false, error: "Unknown format." } };
      const { context, candidate } = candidateForDraft(formatId, String(body?.eventKey || ""), body?.date, tz, env);
      if (!candidate) return { status: 404, body: { ok: false, error: "No such candidate for that date." } };

      // The copy is whatever the human left it as — but it re-passes the same
      // validation, audit, and fact-integrity gates the model's version did.
      // An edit that invents astronomy is refused exactly like a model that
      // did. requireComplete:false is the one draft liberty: interpretive
      // sections may still be empty here — approval closes that door.
      const post = validateGeneratedPost(body?.copy, formatId, { requireComplete: false });
      const findings = [...auditCopy(post), ...verifyFactIntegrity(post, candidate.facts)];
      if (findings.length) return { status: 422, body: { ok: false, error: "Copy violates editorial rules.", findings } };

      const coverage = await store.coverageFor(candidate.eventKey);
      if (coverage.length && body?.allowDuplicate !== true) {
        return { status: 409, body: { ok: false, error: "This event already has living coverage.",
          coverage, hint: "Pass allowDuplicate: true for a deliberate fresh treatment." } };
      }

      const history = await store.history({ limit: 100 });
      const score = scoreCandidate(candidate, history, context.local_date);
      const saved = await store.insert({
        event_key: candidate.eventKey,
        event_type: candidate.eventType,
        event_payload: candidate,               // verified packet, write-once
        calculation_metadata: { context_version: context.context_version, local_date: context.local_date,
          ...(candidate.facts?.period ? { editorial_timezone: candidate.facts.period.timezone,
            period_key: candidate.facts.period.key, period_start_utc: candidate.facts.period.start_utc,
            period_end_utc: candidate.facts.period.end_utc, end_exclusive: true } : {}) },
        editorial_score: score.totalScore,
        score_breakdown: score.scores,
        recommended_format: formatFor(candidate),
        selected_format: formatId,
        generated_copy: body?.generatedCopy ?? null,
        edited_copy: post,
        template: post.design?.template && TEMPLATES[post.design.template]?.version
          ? `${post.design.template}/${TEMPLATES[post.design.template].version}`
          : (post.design?.aspect === "portrait"
            ? `${ASPECTS.portrait.width}x${ASPECTS.portrait.height}` : `${TEMPLATE.width}x${TEMPLATE.height}`),
        reading_type: post.reading?.type || null,
        period_key: candidate.facts?.period?.key || null,
        period_start_at: candidate.facts?.period?.start_utc || null,
        period_end_at: candidate.facts?.period?.end_utc || null,
        template_family: post.design?.template && TEMPLATES[post.design.template]?.family ? post.design.template : null,
        template_version: post.design?.template && TEMPLATES[post.design.template]?.version
          ? TEMPLATES[post.design.template].version : null,
        status: "draft",
        editor_notes: String(body?.notes || "") || null,
        created_by: auth.ownerId,
      });
      return { status: 200, body: { ok: true, post: saved,
        completeness: draftCompleteness(post), advisories: adviseCopy(post) } };
    }

    if (route === "/api/orbit-x/posts" && method === "GET") {
      const list = await store.history({ status: searchParams.get("status"), limit: searchParams.get("limit") });
      return { status: 200, body: { ok: true, posts: list } };
    }

    const idMatch = route.match(/^\/api\/orbit-x\/posts\/([0-9a-f-]{36})$/);
    if (idMatch && method === "GET") {
      const row = await store.byId(idMatch[1]);
      return row ? { status: 200, body: { ok: true, post: row } }
                 : { status: 404, body: { ok: false, error: "No such draft." } };
    }
    if (idMatch && method === "PATCH") {
      const row = await store.byId(idMatch[1]);
      if (!row) return { status: 404, body: { ok: false, error: "No such draft." } };
      const fields = {};

      if (body?.copy !== undefined) {
        const post = validateGeneratedPost(body.copy, row.selected_format, { requireComplete: false });
        const findings = [...auditCopy(post), ...verifyFactIntegrity(post, row.event_payload?.facts)];
        if (findings.length) return { status: 422, body: { ok: false, error: "Copy violates editorial rules.", findings } };
        fields.edited_copy = post;
        if (post.design?.template && TEMPLATES[post.design.template]?.family) {
          fields.template = `${post.design.template}/${TEMPLATES[post.design.template].version}`;
          fields.template_family = post.design.template;
          fields.template_version = TEMPLATES[post.design.template].version;
        }
      }
      if (body?.notes !== undefined) fields.editor_notes = String(body.notes).slice(0, 4000) || null;

      if (body?.status !== undefined) {
        const to = String(body.status);
        // The approval quality gate (Dev Update 5.1): an unfinished draft —
        // empty symbolic layer, empty reflection — can live as a draft
        // forever, but it cannot become approved. The check runs against the
        // copy this very request leaves in place.
        if (to === "approved") {
          const effective = fields.edited_copy || row.edited_copy;
          const completeness = draftCompleteness(effective);
          if (!completeness.complete) {
            return { status: 422, body: { ok: false,
              error: "This draft is incomplete.", missing: completeness.missing } };
          }
        }
        // V1's whole lifecycle. Export does NOT mean published, and nothing
        // here can ever write "published" — that state belongs to a publisher
        // that does not exist yet.
        const allowed = { draft: ["approved", "rejected"], approved: ["exported", "rejected"], rejected: ["draft"], exported: [] };
        if (!(allowed[row.status] || []).includes(to)) {
          return { status: 409, body: { ok: false, error: `A ${row.status} post cannot become ${to}.` } };
        }
        fields.status = to;
        if (to === "approved") fields.approved_at = new Date().toISOString();
        if (to === "exported") fields.exported_at = new Date().toISOString();
        if (to === "rejected") fields.rejection_reason = String(body?.rejectionReason || "other").slice(0, 200);
      }

      const saved = await store.update(idMatch[1], fields);
      return { status: 200, body: { ok: true, post: saved } };
    }
  } catch (error) {
    return fail(error);
  }

  return null;
}
