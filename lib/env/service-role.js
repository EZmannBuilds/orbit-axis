// Orbit Axis :: narrow service-role authorization (Dev Update 1.2).
//
// THE PROBLEM THIS SOLVES
//
// Deleting an account requires the Supabase Admin API, which requires the
// service-role key. The approved shared-database mode
// (lib/env/shared-preview.js) refuses to start when that key is present,
// because a key that bypasses row-level security sitting in the same
// environment as unreviewed code is how a whole user table gets read.
//
// Both rules are correct, and together they mean account deletion cannot run in
// production today. That is a real blocker, not a bug in either rule.
//
// THE SHAPE OF THE FIX
//
// The wrong fix is to delete the refusal. It guards Preview — where unreviewed
// code runs — as well as Production, and a guard removed for one environment is
// a guard removed.
//
// So the refusal stays absolute for Preview and becomes CONDITIONAL for
// Production, on an authorization that is:
//
//   - Purpose-named. It authorizes account deletion. Not "the service-role key
//     is allowed now" — one operation, written out, so a second use of the key
//     is a second decision rather than a free ride on this one.
//   - Project-pinned, by a SEPARATE variable that must independently agree with
//     SUPABASE_URL and with the known production project. A value copied into
//     the wrong project's environment fails closed.
//   - Production-only, and only where Vercel itself agrees this is production.
//   - Refused entirely in local and test, where a service-role key against the
//     hosted project has no legitimate use at all.
//
// Every condition is checked, every refusal explains which one failed, and no
// message ever contains the key.

import { PRODUCTION_PROJECT_REF, projectRefFromUrl, isLocalHost, hostFromUrl }
  from "./known-targets.js";

/**
 * The purposes a service-role key may be authorized for.
 *
 * A set rather than a string because the next purpose — if there ever is one —
 * should be added here, deliberately, in a reviewed change, rather than by
 * someone widening a comparison at the call site. This is that change:
 * "billing-webhook" was added when Stripe entitlement writes were built.
 *
 * WHY BILLING NEEDS IT. account_entitlements grants `authenticated` select and
 * nothing else, on purpose — a policy that let a browser write would let a
 * signed-in browser promote itself. A Stripe webhook has no user session at
 * all: the request comes from Stripe, so there is no session for a policy to be
 * written against, and the service role is the only way to write the row.
 */
export const SERVICE_ROLE_PURPOSES = Object.freeze(["account-deletion", "billing-webhook"]);

export const PURPOSE_VAR = "ORBIT_PRODUCTION_SERVICE_ROLE_PURPOSE";
export const PROJECT_VAR = "ORBIT_PRODUCTION_SERVICE_ROLE_PROJECT_REF";

/**
 * May this process use the service-role key for `purpose`?
 *
 * Returns a verdict rather than a boolean so a refusal can say which condition
 * failed. `authorized` is true only when every condition holds.
 *
 * @param {string} purpose  one of SERVICE_ROLE_PURPOSES
 * @param {object} env
 * @param {{ environment?: string, isVercel?: boolean, vercelEnv?: string,
 *           isDeployed?: boolean }} context
 */
export function serviceRoleVerdict(purpose, env = process.env, context = {}) {
  const declared = String(env[PURPOSE_VAR] || "").trim();
  const requested = declared.length > 0;
  const refuse = (reason) => ({ requested, authorized: false, reason, purpose });

  if (!SERVICE_ROLE_PURPOSES.includes(purpose)) {
    return refuse(`"${purpose}" is not a purpose Orbit authorizes`);
  }
  if (!requested) {
    return refuse(`no service-role purpose was authorized (${PURPOSE_VAR} is unset)`);
  }
  // Exact match, case-sensitively, against each authorized purpose. A value
  // this consequential should be copied, not remembered; an approximate match
  // is indistinguishable from a guess.
  //
  // The variable became a LIST when billing arrived. It held one purpose while
  // account deletion was the only one, and comparing the whole string meant
  // authorizing deletion silently de-authorized everything else — with two real
  // purposes that is no longer a safe default, it is an outage waiting for
  // whichever one is written second.
  //
  // Every property that mattered is kept: each entry is still matched exactly,
  // unknown names are still refused, and an unset variable still authorizes
  // nothing. What changed is that naming one purpose no longer forbids the rest.
  const authorizedNames = declared.split(",").map((name) => name.trim()).filter(Boolean);
  if (!authorizedNames.includes(purpose)) {
    return refuse(`${PURPOSE_VAR} authorizes "${declared}", not "${purpose}"`);
  }
  // A typo in the list is a misconfiguration, not a wildcard. Refusing here
  // means a mis-set variable fails loudly instead of quietly authorizing only
  // the entries that happen to be spelled right.
  const unknown = authorizedNames.filter((name) => !SERVICE_ROLE_PURPOSES.includes(name));
  if (unknown.length) {
    return refuse(`${PURPOSE_VAR} names ${unknown.map((n) => `"${n}"`).join(", ")}, which Orbit does not authorize`);
  }

  const environment = String(context.environment || "").toLowerCase();
  if (environment !== "production") {
    return refuse(`service-role authorization is for production only, not "${environment || "unknown"}"`);
  }
  // If we are on Vercel at all, Vercel must agree this is production. This
  // catches ORBIT_ENVIRONMENT=production set on a Preview deployment, where the
  // variable would be lying about where it is running.
  if (context.isVercel && String(context.vercelEnv || "").toLowerCase() !== "production") {
    return refuse(`Vercel reports "${context.vercelEnv || "unknown"}", not production`);
  }

  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return refuse("SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  const url = String(env.SUPABASE_URL || "").trim();
  if (!url) return refuse("SUPABASE_URL is not set");
  const host = hostFromUrl(url);
  if (!host) return refuse("SUPABASE_URL is not a valid URL");
  if (isLocalHost(host)) {
    return refuse("service-role authorization is for the hosted project, not localhost");
  }
  const urlRef = projectRefFromUrl(url);
  if (!urlRef) return refuse("SUPABASE_URL does not contain a Supabase project reference");

  // The separate pin. Reading the ref out of the URL and trusting it would make
  // this circular — the point is that a second, independently written value has
  // to agree.
  const pinned = String(env[PROJECT_VAR] || "").trim();
  if (!pinned) return refuse(`${PROJECT_VAR} is not set`);
  if (pinned !== urlRef) {
    return refuse(`${PROJECT_VAR} does not match the project in SUPABASE_URL`);
  }
  if (urlRef !== PRODUCTION_PROJECT_REF) {
    return refuse("service-role authorization names the Orbit production project only");
  }

  return { requested: true, authorized: true, reason: null, purpose, projectRef: urlRef };
}

/**
 * Lines for a startup banner. Blunt on purpose: a production process holding a
 * key that bypasses row-level security is a fact somebody must be able to see
 * in the logs, not something to discover during an incident.
 */
export function serviceRoleWarnings(purpose) {
  return [
    `PRODUCTION HOLDS A SERVICE-ROLE KEY, authorized for: ${purpose}.`,
    "That key bypasses row-level security for every table.",
    "It is server-only and must never reach a client bundle or a Preview.",
    "No other operation may use it without its own authorized purpose.",
  ];
}
