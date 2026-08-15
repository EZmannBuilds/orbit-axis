// Orbit Axis :: version-one feature flags.
//
// Tarot, Learn, and News are built but not finished. They are not part of
// version one, and shipping a half-built surface teaches people that Orbit's
// navigation contains things that do not work — which is a worse first
// impression than a smaller app that works everywhere you touch it.
//
// The code is PRESERVED, not deleted. Every panel, stylesheet, and handler
// stays exactly where it is; only production visibility changes. Deleting the
// work would mean rebuilding it, and the work is not the problem — its
// readiness is.
//
// THE DEFAULT IS OFF, AND THE DEFAULT IS WHAT SHIPS
//
// A missing variable, an empty string, a typo, a value nobody thought about:
// all of them resolve to disabled. In production nothing turns these on at all,
// whatever the environment says — a stray variable in a dashboard should not be
// able to expose an unfinished feature to real users. That asymmetry is
// deliberate: the cost of a feature being wrongly off is that someone in
// development sets a flag; the cost of it being wrongly on is that a stranger
// finds a broken page.

import { resolveEnvironment } from "./env/environment.js";

/**
 * The registry. `id` matches the workspace id in the client's WORKSPACES list
 * and the `panel-<id>` element, so there is one name for a feature everywhere.
 */
export const FEATURES = Object.freeze({
  learn: { id: "learn", env: "ORBIT_FEATURE_LEARN", label: "Learn" },
  news: { id: "news", env: "ORBIT_FEATURE_NEWS", label: "News" },
});

/**
 * TAROT GRADUATED OUT OF THIS REGISTRY.
 *
 * It was here because it was a hidden placeholder: a panel of disabled modes
 * and a "coming soon" heading. It is now a finished surface — a stable daily
 * card, one- and three-card spreads, reversals, saving, owner-scoped history,
 * export, deletion, and an authored deck with recorded provenance — so the
 * flag it was hiding behind has done its job and been removed rather than
 * quietly flipped.
 *
 * What still gates it is CONTENT, not readiness: deckStatus() refuses an
 * empty, incomplete, or unreviewed deck wherever it runs. That check is the
 * real gate now, and it is the honest one — the question was never "is the
 * code finished" but "is there a deck worth showing".
 */

export const FEATURE_IDS = Object.freeze(Object.keys(FEATURES));

/** Only these count as "on". Anything else — including "1", "yes", "on", */
/** "TRUE " with a space — is off, because a flag that guesses is a flag  */
/** that eventually guesses wrong in the direction nobody wanted.         */
const TRUTHY = new Set(["true", "enabled"]);

/**
 * Is this feature enabled in this environment?
 *
 * @param {string} name  a key of FEATURES
 * @param {object} [env] the environment to read (injectable for tests)
 */
export function featureEnabled(name, env = process.env) {
  const feature = FEATURES[name];
  if (!feature) return false;                       // unknown feature is never on

  // Production is absolute. No environment variable can turn an unfinished
  // feature on for real users; enabling one is a code change and a release,
  // which is the correct amount of ceremony for "show this to everybody".
  if (isProduction(env)) return false;

  const raw = env[feature.env];
  if (typeof raw !== "string") return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}

/**
 * Production means the deployed production environment — not "deployed", and
 * not "not local". A Vercel preview is deliberately allowed to enable these so
 * the work can be reviewed before it ships.
 *
 * This defers to the application's own environment resolver rather than
 * re-deriving the answer from raw variables. Two pieces of code that both
 * decide "is this production?" will eventually disagree, and the one that
 * disagrees quietly is this one — a feature flag nobody is watching.
 *
 * Note what that means for an unset environment: it resolves to `local`, so
 * flags CAN be set there. That is correct rather than lax. A real deployment
 * always carries VERCEL_ENV, and the startup guard refuses to run a deployed
 * instance without an explicit environment, so "nothing is set" genuinely means
 * a developer's machine.
 */
function isProduction(env) {
  // resolveEnvironment takes an OPTIONS object, not a bare environment. Passing
  // the environment directly silently falls back to process.env and answers
  // "local" for everything — which is how a production gate ends up open.
  // loadEnvFiles is off so this reads only what it was given.
  return resolveEnvironment({ env, loadEnvFiles: false }).isProduction === true;
}

/** @returns {Record<string, boolean>} every feature and whether it is on. */
export function featureFlags(env = process.env) {
  const out = {};
  for (const name of FEATURE_IDS) out[name] = featureEnabled(name, env);
  return out;
}

/** The ids a client may route to and show in navigation. */
export function enabledFeatureIds(env = process.env) {
  return FEATURE_IDS.filter((name) => featureEnabled(name, env));
}

/**
 * Is this workspace id gated behind a flag that is currently off?
 *
 * Used by the router. A workspace with no flag — Home, Me, Ask Orbit — is never
 * gated, so this answers false for anything not in the registry rather than
 * accidentally hiding the core app if a name is misspelled.
 */
export function workspaceBlocked(id, env = process.env) {
  if (!FEATURE_IDS.includes(id)) return false;
  return !featureEnabled(id, env);
}
