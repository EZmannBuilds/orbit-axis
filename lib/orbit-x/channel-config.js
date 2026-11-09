// Orbit X :: automatic channel configuration (Dev Update 6.1).
//
// EVERY SWITCH DEFAULTS OFF AND NONE OF THEM GUESSES. Like lib/features.js,
// a flag is on only for the exact string "true"; "1", "yes", "TRUE " and an
// empty value are all off.
//
//   ORBIT_X_ENABLED=true            Orbit X exists at all (unchanged).
//   ORBIT_X_AUTOPUBLISH=true        The channel runs in REVIEW mode (the
//                                   default since 2026-11-09): it keeps the
//                                   next 7 editorial days generated, checked
//                                   and rendered as "ready for review" drafts.
//                                   Nothing publishes until a person approves
//                                   a post and gives it a publish time.
//   ORBIT_X_AUTOPUBLISH_LIVE=true   AUTO mode: Green posts approve themselves
//                                   at the default publish time. Yellow posts
//                                   still wait for a person, always.
//
// THE KILL SWITCH IS THE ONE DELIBERATE EXCEPTION, and it fails the other way:
// ORBIT_X_KILL_SWITCH set to ANY non-empty value stops all generation and
// publishing, because the direction nobody wants for a kill switch is "typed
// it slightly wrong in a hurry and it kept posting". Delete the variable (or
// empty it) to resume. An environment change on Vercel needs a redeploy to
// reach a running deployment, so the desk also has a Pause control stored in
// the database, which the channel reads before every call to Meta and which
// takes effect on the very next call.

import { editorialTimezone } from "./readings.js";
import { resolveRotation } from "./rotation.js";
import { graphConfig } from "./publisher.js";
import { aiConfig } from "./ai.js";

export const CHANNEL_ENV_VARS = Object.freeze([
  "ORBIT_X_AUTOPUBLISH", "ORBIT_X_AUTOPUBLISH_LIVE", "ORBIT_X_KILL_SWITCH", "CRON_SECRET",
  "ORBIT_X_IG_API", "ORBIT_X_IG_USER_ID", "ORBIT_X_IG_ACCESS_TOKEN", "ORBIT_X_GRAPH_API_VERSION",
  "ORBIT_X_IG_TOKEN_EXPIRES_AT", "ORBIT_X_CHANNEL_ROTATION", "ORBIT_X_PUBLISH_TIME",
  "ORBIT_X_DESIGN_PROPOSALS",
]);

/** The channel keeps this many editorial days generated ahead, today first. */
export const LOOKAHEAD_DAYS = 7;

/** The default publish time per day, in the editorial timezone. */
export const DEFAULT_PUBLISH_TIME = "08:30";

/** "HH:MM", 24-hour, or the default. Anything else is reported, not guessed. */
export function publishTime(value) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || "").trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

/** The one event kinds the channel may post on their day. Only engine-exact
 *  events: the Sun ingress dates come from a season table and the Mercury
 *  stations from an approximate one (lib/sky.js), so neither is a fact the
 *  channel may publish without a person. They join when the engine exposes
 *  exact ingress and station instants. */
export const CHANNEL_EVENT_KINDS = Object.freeze(["full_moon", "new_moon"]);

/** Vercel gives a function 30 seconds (vercel.json). A tick stops starting new
 *  steps well before that and resumes on the next cron invocation, which runs
 *  every 15 minutes, so a scheduled post goes out within 15 minutes of its
 *  time. */
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
  const rawTime = String(env.ORBIT_X_PUBLISH_TIME || "").trim();
  const time = rawTime ? publishTime(rawTime) : DEFAULT_PUBLISH_TIME;
  if (rawTime && !time) rotationProblems.push(`ORBIT_X_PUBLISH_TIME "${rawTime}" is not HH:MM; ${DEFAULT_PUBLISH_TIME} used`);

  let tokenExpiresAt = null;
  const rawExpiry = String(env.ORBIT_X_IG_TOKEN_EXPIRES_AT || "").trim();
  if (rawExpiry && Number.isFinite(Date.parse(rawExpiry))) tokenExpiresAt = new Date(Date.parse(rawExpiry)).toISOString();

  return Object.freeze({
    enabled: channelEnabled(env),
    live,
    mode: live ? "auto" : "review",
    publishTime: time || DEFAULT_PUBLISH_TIME,
    lookaheadDays: LOOKAHEAD_DAYS,
    killSwitch: killSwitchEngaged(env),
    cronSecretSet: String(env.CRON_SECRET || "").length >= 16,
    timezone: editorialTimezone(env.ORBIT_X_EDITORIAL_TIMEZONE),
    rotation,
    rotationIgnored: Object.freeze([...rotationProblems, ...ignored]),
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
    enabled: c.enabled, mode: c.mode, live: c.live, killSwitch: c.killSwitch,
    cronSecretSet: c.cronSecretSet, timezone: c.timezone, aiConfigured: c.aiConfigured,
    graph: c.graph, graphConfigured: c.graphConfigured, graphProblems: c.graphProblems,
    tokenExpiresAt: c.tokenExpiresAt, designProposals: c.designProposals,
    publishTime: c.publishTime, lookaheadDays: c.lookaheadDays,
    rotation: c.rotation, rotationIgnored: c.rotationIgnored, eventKinds: c.eventKinds,
  };
}
