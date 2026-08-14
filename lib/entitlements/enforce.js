// Orbit Axis :: enforcement (Dev Update 3.0).
//
// THIS UPDATE SHIPS DARK, AND THAT IS THE POINT.
//
// Every account today has what the tier table calls Researcher: there are no
// limits anywhere in the application. Turning enforcement on at the same moment
// it is written would take things away from existing users before any of them
// can buy them back — there is no billing until Dev Update 3.10.
//
// So enforcement is real, tested, and OFF. `ORBIT_ENTITLEMENTS_ENFORCED=true`
// switches it on, and that is a deliberate act taken together with launching an
// offer, not a side effect of deploying this code.
//
// THE SWITCH IS NOT THE AUTHORIZATION
//
// Worth being precise, because these are easy to conflate:
//
//   lib/entitlements/service.js  decides what a person MAY do. Deny by default,
//                                always, switch or no switch.
//   this file                    decides whether the application ACTS on that
//                                decision yet.
//
// The evaluator is never bypassed or stubbed — while dark, its answers are
// computed and simply not enforced. That way the day the switch flips, nothing
// runs for the first time.

import { UNLIMITED } from "./plans.js";
import { capabilityFor } from "./service.js";

/** Only these count as on, matching lib/features.js. A flag that guesses is a
 *  flag that eventually guesses wrong in the direction nobody wanted. */
const TRUTHY = new Set(["true", "enabled"]);

/**
 * Is entitlement enforcement switched on in this environment?
 *
 * Default OFF. A missing variable, an empty string, "1", "yes", a typo — all
 * of them leave the application behaving exactly as it does today.
 */
export function entitlementsEnforced(env = process.env) {
  const raw = env.ORBIT_ENTITLEMENTS_ENFORCED;
  if (typeof raw !== "string") return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}

/**
 * A refusal, in the shape the API already uses for errors.
 *
 * `code` is stable and machine-readable so the interface can offer the right
 * upgrade prompt; `error` is the sentence a person reads. Neither names a
 * price — prices are not decided, and an API that hardcodes one is an API that
 * lies the day it changes.
 */
export function upgradeRequired(capability, message) {
  return {
    status: 403,
    body: {
      ok: false,
      error: message,
      code: "upgrade_required",
      capability,
    },
  };
}

/**
 * Refuse an action the caller's plan does not include.
 *
 * Returns null when the action is permitted OR when enforcement is dark, so the
 * call site reads the same in both cases:
 *
 *     const refusal = await refuseUnless(auth, "chart.compatibility", "…");
 *     if (refusal) return json(res, refusal.status, refusal.body);
 *
 * @param {object} auth
 * @param {string} capability  a BOOLEAN capability
 * @param {string} message     what the person reads
 * @param {object} [env]
 */
export async function refuseUnless(auth, capability, message, env = process.env) {
  const allowed = await capabilityFor(auth, capability);
  if (allowed === true) return null;
  if (!entitlementsEnforced(env)) return null;    // dark: decided, not acted on
  return upgradeRequired(capability, message);
}

/**
 * Is there room for one more, under a numeric limit?
 *
 * Counting is the caller's job because only it knows what it is counting and
 * how to count it cheaply.
 *
 * @param {object} auth
 * @param {string} capability  a NUMERIC capability, e.g. "chart.saved.limit"
 * @param {number} current     how many exist now
 * @param {object} [env]
 */
export async function refuseIfAtLimit(auth, capability, current, message, env = process.env) {
  const limit = await capabilityFor(auth, capability);
  if (limit === UNLIMITED) return null;
  if (typeof limit !== "number") return null;     // not a limit; nothing to enforce
  if (current < limit) return null;
  if (!entitlementsEnforced(env)) return null;

  // The limit and the count are included because "you have reached your limit"
  // without saying what it is forces a person to guess.
  const refusal = upgradeRequired(capability, message);
  return { status: refusal.status, body: { ...refusal.body, limit, current } };
}

/**
 * Narrow a requested range to what the plan includes.
 *
 * CLAMPING, NOT REFUSING, and the distinction is a product decision rather than
 * a technical one. Refusing to create an eleventh chart is honest: the thing
 * would not exist. Refusing to READ your own past readings is not — a 403 on
 * your own history reads as a bug, and people report it as one.
 *
 * So a free account asking for a year of readings gets seven days and a marker
 * saying so, which the interface can turn into an honest explanation.
 *
 * Returns `{ days, clamped }`. While dark, `clamped` is always false and the
 * requested window is returned untouched.
 *
 * @param {object} auth
 * @param {number|null} requestedDays  null means "everything"
 * @param {object} [env]
 */
export async function clampHistoryWindow(auth, requestedDays, env = process.env) {
  const allowed = await capabilityFor(auth, "history.window.days");
  if (allowed === UNLIMITED || typeof allowed !== "number") {
    return { days: requestedDays, clamped: false };
  }
  if (!entitlementsEnforced(env)) {
    return { days: requestedDays, clamped: false };
  }
  if (requestedDays === null || requestedDays > allowed) {
    return { days: allowed, clamped: true };
  }
  return { days: requestedDays, clamped: false };
}
