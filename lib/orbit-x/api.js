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

import { createCurrentSkyContext } from "../astro/current-sky-context.js";
import { upcomingEvents } from "../sky.js";
import { buildCandidates, formatFor } from "./candidates.js";
import { scoreCandidate, rankCandidates } from "./scoring.js";
import { FORMATS, TEMPLATE } from "./formats.js";
import { buildPacket, systemPrompt } from "./prompts.js";
import { aiConfig, generateCopy, OrbitXAiError } from "./ai.js";
import { manualScaffold, parseModelJson, validateGeneratedPost, OrbitXValidationError } from "./schemas.js";
import { auditCopy, verifyFactIntegrity } from "./editorial.js";
import { orbitXStore, OrbitXStoreError } from "./store.js";

/** The server-controlled gate. String-equal on purpose: an accidental "1" or
 *  "yes" in an environment stays OFF. */
export function orbitXEnabled(env = process.env) {
  return env.ORBIT_X_ENABLED === "true";
}

function candidatesForDate(dateIso, tz) {
  const at = dateIso ? new Date(`${dateIso}T12:00:00.000Z`) : new Date();
  const context = createCurrentSkyContext({ at, timezoneName: tz || null, timezoneSource: "request" });
  const events = upcomingEvents(new Date(`${context.local_date}T12:00:00.000Z`), 12, { currentSkyContext: context });
  const { candidates, skipped } = buildCandidates(events, context);
  return { context, candidates, skipped };
}

async function scoredCandidates(store, dateIso, tz) {
  const { context, candidates, skipped } = candidatesForDate(dateIso, tz);
  const history = await store.history({ limit: 100 });
  const scored = candidates.map((candidate) => ({
    candidate,
    score: scoreCandidate(candidate, history, context.local_date),
    suggestedFormat: formatFor(candidate),
  }));
  return { context, skipped, ranked: rankCandidates(scored) };
}

function findCandidate(eventKey, dateIso, tz) {
  const { context, candidates } = candidatesForDate(dateIso, tz);
  const hit = candidates.find((c) => c.eventKey === eventKey);
  return { context, candidate: hit || null };
}

const fail = (error) => {
  if (error instanceof OrbitXValidationError) {
    return { status: 422, body: { ok: false, error: "Generated output failed validation.", problems: error.problems } };
  }
  if (error instanceof OrbitXAiError || error instanceof OrbitXStoreError) {
    return { status: error.status, body: { ok: false, error: error.message } };
  }
  return { status: 502, body: { ok: false, error: "Orbit X request failed." } };
};

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
    if (route === "/api/orbit-x/candidates" && method === "GET") {
      const { context, skipped, ranked } = await scoredCandidates(store, searchParams.get("date"), tz);
      // Duplicate flags for the list view, one query per shown key kept cheap
      // by asking only for the top of the ranking.
      const withCoverage = await Promise.all(ranked.slice(0, 30).map(async (entry) => ({
        ...entry,
        coverage: await store.coverageFor(entry.candidate.eventKey),
      })));
      return { status: 200, body: { ok: true,
        localDate: context.local_date, contextVersion: context.context_version,
        candidates: withCoverage, skipped, formats: FORMATS, template: TEMPLATE,
        // A state, never an error: with no provider configured the desk runs
        // whole on manual drafting, and the UI hides Generate rather than
        // rendering a button that apologises.
        aiAvailable: aiConfig(env).configured } };
    }

    if (route === "/api/orbit-x/manual" && method === "POST") {
      const formatId = String(body?.format || "");
      if (!FORMATS[formatId]) return { status: 400, body: { ok: false, error: "Unknown format." } };
      const { context, candidate } = findCandidate(String(body?.eventKey || ""), body?.date, tz);
      if (!candidate) return { status: 404, body: { ok: false, error: "No such candidate for that date." } };
      // No model, no key, no network: the scaffold is built from the verified
      // candidate alone and passes the same gates a generated draft must.
      const post = manualScaffold(candidate, formatId);
      return { status: 200, body: { ok: true, post, candidate, usage: null, manual: true,
        calculationMetadata: { context_version: context.context_version, local_date: context.local_date } } };
    }

    if (route === "/api/orbit-x/generate" && method === "POST") {
      const formatId = String(body?.format || "");
      if (!FORMATS[formatId]) return { status: 400, body: { ok: false, error: "Unknown format." } };
      const { context, candidate } = findCandidate(String(body?.eventKey || ""), body?.date, tz);
      if (!candidate) return { status: 404, body: { ok: false, error: "No such candidate for that date. The engine, not the browser, owns the facts." } };

      const history = await store.history({ limit: 20 });
      const recentTopics = history.map((row) => row.event_key);
      const packet = buildPacket(candidate, formatId, recentTopics, body?.instruction);
      const generated = await generateCopy({ system: systemPrompt(), packet, env, fetchImpl: deps.fetchImpl });
      const post = validateGeneratedPost(parseModelJson(generated.text), formatId);

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
      const { context, candidate } = findCandidate(String(body?.eventKey || ""), body?.date, tz);
      if (!candidate) return { status: 404, body: { ok: false, error: "No such candidate for that date." } };

      // The copy is whatever the human left it as — but it re-passes the same
      // validation, audit, and fact-integrity gates the model's version did.
      // An edit that invents astronomy is refused exactly like a model that did.
      const post = validateGeneratedPost(body?.copy, formatId);
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
        calculation_metadata: { context_version: context.context_version, local_date: context.local_date },
        editorial_score: score.totalScore,
        score_breakdown: score.scores,
        recommended_format: formatFor(candidate),
        selected_format: formatId,
        generated_copy: body?.generatedCopy ?? null,
        edited_copy: post,
        template: `${TEMPLATE.width}x${TEMPLATE.height}`,
        status: "draft",
        editor_notes: String(body?.notes || "") || null,
        created_by: auth.ownerId,
      });
      return { status: 200, body: { ok: true, post: saved } };
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
        const post = validateGeneratedPost(body.copy, row.selected_format);
        const findings = [...auditCopy(post), ...verifyFactIntegrity(post, row.event_payload?.facts)];
        if (findings.length) return { status: 422, body: { ok: false, error: "Copy violates editorial rules.", findings } };
        fields.edited_copy = post;
      }
      if (body?.notes !== undefined) fields.editor_notes = String(body.notes).slice(0, 4000) || null;

      if (body?.status !== undefined) {
        const to = String(body.status);
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
