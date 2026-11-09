// Orbit X :: automatic channel configuration (Dev Update 6.1).
//
// EVERY SWITCH DEFAULTS OFF AND NONE OF THEM GUESSES. Like lib/features.js,
// a flag is on only for the exact string "true"; "1", "yes", "TRUE " and an
// empty value are all off. Turning the channel all the way on takes three
// separate decisions, in this order:
//
//   ORBIT_X_ENABLED=true             Orbit X exists at all (unchanged).
//   ORBIT_X_AUTOPUBLISH=true         The channel runs, in DRY RUN: it plans,
//                                    writes, checks, renders and logs, and
//                                    stores the result as a desk draft. It
//                                    never calls Meta.
//   ORBIT_X_AUTOPUBLISH_LIVE=true    The channel publishes Green posts.
//   ORBIT_X_AUTOPUBLISH_YELLOW=true  ...and Yellow posts, after the stricter
//                                    Yellow checks. Independent of LIVE: in
//                                    dry run it shows what Yellow would do.
//
// THE KILL SWITCH IS THE ONE DELIBERATE EXCEPTION, and it fails the other way:
// ORBIT_X_KILL_SWITCH set to ANY non-empty value stops all publishing, because
// the direction nobody wants for a kill switch is "typed it slightly wrong in
// a hurry and it kept posting". Delete the variable (or empty it) to resume.
// An environment change on Vercel needs a redeploy to reach a running
// deployment, so the desk also has a Pause control stored in the database,
// which the channel reads before every call to Meta and which takes effect on
// the very next call.

import { editorialTimezone } from "./readings.js";
import { resolveRotation } from "./rotation.js";
import { graphConfig } from "./publisher.js";
import { aiConfig } from "./ai.js";

export const CHANNEL_ENV_VARS = Object.freeze([
  "ORBIT_X_AUTOPUBLISH", "ORBIT_X_AUTOPUBLISH_LIVE", "ORBIT_X_AUTOPUBLISH_YELLOW",
  "ORBIT_X_KILL_SWITCH", "CRON_SECRET",
  "ORBIT_X_IG_API", "ORBIT_X_IG_USER_ID", "ORBIT_X_IG_ACCESS_TOKEN", "ORBIT_X_GRAPH_API_VERSION",
  "ORBIT_X_IG_TOKEN_EXPIRES_AT", "ORBIT_X_CHANNEL_ROTATION", "ORBIT_X_DRY_RUN_UPLOAD",
  "ORBIT_X_DESIGN_PROPOSALS",
]);

/** The one event kinds the channel may post on their day. Only engine-exact
 *  events: the Sun ingress dates come from a season table and the Mercury
 *  stations from an approximate one (lib/sky.js), so neither is a fact the
 *  channel may publish without a person. They join when the engine exposes
 *  exact ingress and station instants. */
export const CHANNEL_EVENT_KINDS = Object.freeze(["full_moon", "new_moon"]);

/** Vercel gives a function 30 seconds (vercel.json). A tick stops starting new
 *  steps well before that and resumes on the next cron invocation. */
export const TICK_BUDGET_MS = 24_000;

export function killSwitchEngaged(env = process.env) {
  return String(env.ORBIT_X_KILL_SWITCH ?? "").trim() !== "";
}

export function channelEnabled(env = process.env) {
  return env.ORBIT_X_ENABLED === "true" && env.ORBIT_X_AUTOPUBLISH === "true";
}

/**
 * Everything the channel needs to know, with no secret values in it.
 */
export function channelConfig(env = process.env) {
  let rotationOverride = null;
  const rotationProblems = [];
  if (String(env.ORBIT_X_CHANNEL_ROTATION || "").trim()) {
    try { rotationOverride = JSON.parse(env.ORBIT_X_CHANNEL_ROTATION); }
    catch { rotationProblems.push("ORBIT_X_CHANNEL_ROTATION is not valid JSON; defaults used"); }
  }
  const { rotation, ignored } = resolveRotation(rotationOverride);
  const live = env.ORBIT_X_AUTOPUBLISH_LIVE === "true";
  const graph = graphConfig(env);

  let tokenExpiresAt = null;
  const rawExpiry = String(env.ORBIT_X_IG_TOKEN_EXPIRES_AT || "").trim();
  if (rawExpiry && Number.isFinite(Date.parse(rawExpiry))) tokenExpiresAt = new Date(Date.parse(rawExpiry)).toISOString();

  return Object.freeze({
    enabled: channelEnabled(env),
    live,
    mode: live ? "live" : "dry_run",
    yellow: env.ORBIT_X_AUTOPUBLISH_YELLOW === "true",
    killSwitch: killSwitchEngaged(env),
    cronSecretSet: String(env.CRON_SECRET || "").length >= 16,
    timezone: editorialTimezone(env.ORBIT_X_EDITORIAL_TIMEZONE),
    rotation,
    rotationIgnored: Object.freeze([...rotationProblems, ...ignored]),
    dryRunUpload: env.ORBIT_X_DRY_RUN_UPLOAD === "true",
    designProposals: env.ORBIT_X_DESIGN_PROPOSALS === "true",
    aiConfigured: aiConfig(env).configured,
    graph: graph.summary,
    graphConfigured: graph.configured,
    graphProblems: graph.problems,
    tokenExpiresAt,
    eventKinds: CHANNEL_EVENT_KINDS,
  });
}

/** What the desk shows. Names and states only, never values. */
export function channelStatusSummary(env = process.env) {
  const c = channelConfig(env);
  return {
    enabled: c.enabled, mode: c.mode, live: c.live, yellow: c.yellow, killSwitch: c.killSwitch,
    cronSecretSet: c.cronSecretSet, timezone: c.timezone, aiConfigured: c.aiConfigured,
    graph: c.graph, graphConfigured: c.graphConfigured, graphProblems: c.graphProblems,
    tokenExpiresAt: c.tokenExpiresAt, dryRunUpload: c.dryRunUpload, designProposals: c.designProposals,
    rotation: c.rotation, rotationIgnored: c.rotationIgnored, eventKinds: c.eventKinds,
  };
}
