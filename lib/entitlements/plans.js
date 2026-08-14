// Orbit Axis :: the capability matrix (Dev Update 3.0).
//
// WHAT A PLAN IS ALLOWED TO DO. One table, in source, versioned.
//
// NOT A FEATURE FLAG. lib/features.js answers "is this feature built?" from an
// environment variable, per deployment, and is hard-off in Production whatever
// the configuration says. This answers "is this PERSON allowed?" from a fact in
// the database, per account. The two must never share code: the moment they do,
// somebody grants a paid plan by setting a variable in a dashboard.
//
// WHY THE MATRIX IS VERSIONED
//
// Somebody who subscribes today buys the capabilities as they are defined
// today. If v2 moves Compatibility from Consumer to Researcher, a subscriber on
// v1 must not lose it because a constant changed. Their version is recorded on
// their entitlement row, so a change to their detriment becomes a visible
// migration decision instead of a silent one.
//
// Bumping the version is therefore not bookkeeping. Add a new entry to
// MATRICES; do not edit an existing one in a way that removes something.
//
// WHY SOME CAPABILITIES CAN NEVER BE SOLD
//
// Privacy, account recovery, personal-data export, account deletion, basic
// symbol literacy, and theme choice. Withholding any of them to extract money
// would mean holding a person's own data hostage. NEVER_PAID below is asserted
// against every plan by the test suite, including expired and cancelled ones.

/** The plans, weakest first. Order is meaningful — see atLeast(). */
export const PLANS = Object.freeze(["free", "consumer", "researcher"]);

/** The plan an account holds when it has no entitlement row, or when we cannot
 *  find out. Deny by default: the cost of being wrongly free is a support
 *  message; the cost of being wrongly paid is revenue and a broken promise. */
export const DEFAULT_PLAN = "free";

/** Capabilities that are true for every plan and every status, forever. */
export const NEVER_PAID = Object.freeze([
  "export.personal",
  "account.deletion",
  "account.recovery",
  "atlas.basic",
  "theme.choice",
]);

/** A limit meaning "no ceiling". Not Infinity: this value is JSON-serialised to
 *  the client, and JSON has no Infinity — it becomes null and reads as zero. */
export const UNLIMITED = -1;

// ── The matrices ────────────────────────────────────────────────────────────
//
// Boundaries mirror "Plans and Entitlements" in the vault, re-expressed against
// the surfaces Dev Update 1.13 actually ships (Today · Chart · Sky · Atlas ·
// You) rather than the navigation that note was written against.

const V1 = Object.freeze({
  free: Object.freeze({
    "chart.saved.limit": 1,
    "chart.compatibility": false,
    "chart.interpretation": "basic",
    "chart.avatar": false,
    "sky.positions.technical": "none",
    "history.window.days": 7,
    "atlas.depth": "basic",
    "reminders.personalised": false,
  }),
  consumer: Object.freeze({
    "chart.saved.limit": 10,
    "chart.compatibility": true,
    "chart.interpretation": "expanded",
    "chart.avatar": true,
    "sky.positions.technical": "partial",
    "history.window.days": UNLIMITED,
    "atlas.depth": "deeper",
    "reminders.personalised": true,
  }),
  researcher: Object.freeze({
    "chart.saved.limit": UNLIMITED,
    "chart.compatibility": true,
    "chart.interpretation": "advanced",
    "chart.avatar": true,
    "sky.positions.technical": "full",
    "history.window.days": UNLIMITED,
    "atlas.depth": "source-context",
    "reminders.personalised": true,
  }),
});

/** Every matrix ever shipped, by version. Append; do not rewrite. */
export const MATRICES = Object.freeze({ 1: V1 });

/** The version new entitlements are granted under. */
export const CURRENT_MATRIX_VERSION = 1;

/** Every capability name the matrix defines, plus the ones nobody pays for. */
export const CAPABILITIES = Object.freeze([
  ...Object.keys(V1.free),
  ...NEVER_PAID,
]);

// ── Reading it ──────────────────────────────────────────────────────────────

/**
 * The capability set for a plan, at a matrix version.
 *
 * Unknown plan or unknown version resolves to free at the current version —
 * the same deny-by-default posture as everything else here. A typo must not
 * produce a more generous answer than the truth.
 *
 * @param {string} plan
 * @param {number} [version]
 */
export function capabilities(plan, version = CURRENT_MATRIX_VERSION) {
  const matrix = MATRICES[version] || MATRICES[CURRENT_MATRIX_VERSION];
  const set = matrix[plan] || matrix[DEFAULT_PLAN];
  const never = Object.fromEntries(NEVER_PAID.map((name) => [name, true]));
  return Object.freeze({ ...set, ...never });
}

/**
 * The value of one capability for a plan.
 *
 * A capability the matrix does not define answers `false`, never `undefined` —
 * a caller writing `if (capability(...))` must not be handed something falsy by
 * accident and something truthy by typo.
 */
export function capability(plan, name, version = CURRENT_MATRIX_VERSION) {
  if (NEVER_PAID.includes(name)) return true;
  const value = capabilities(plan, version)[name];
  return value === undefined ? false : value;
}

/** Is `plan` at least `minimum`? Uses PLANS order. */
export function atLeast(plan, minimum) {
  const held = PLANS.indexOf(plan);
  const need = PLANS.indexOf(minimum);
  if (held < 0 || need < 0) return false;
  return held >= need;
}

/** Is this a plan name the system knows? */
export function isPlan(value) {
  return PLANS.includes(value);
}
