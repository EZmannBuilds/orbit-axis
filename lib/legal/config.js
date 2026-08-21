// Orbit Axis :: public contact and legal configuration.
//
// Legal pages need facts Orbit cannot invent: who publishes the app, where to
// reach a human, which law governs the Terms, and the minimum age. None of
// those are engineering decisions, and a plausible-looking placeholder is worse
// than an obvious gap — a fake support address is a promise the product cannot
// keep, and an invented jurisdiction is a legal claim nobody made.
//
// So every value here is configuration, every value is validated, and anything
// missing is reported as a RELEASE BLOCKER rather than filled in. The pages
// render an honest "not yet published" state instead of a dead mailto link.

/** Values that must be set before Orbit Axis can be offered publicly. */
export const REQUIRED_BEFORE_PUBLIC = Object.freeze([
  "ORBIT_SUPPORT_EMAIL",
  "ORBIT_LEGAL_ENTITY",
  "ORBIT_GOVERNING_JURISDICTION",
  "ORBIT_MINIMUM_AGE",
]);

// Deliberately strict, and deliberately not a full RFC 5322 implementation:
// this is validating a value the owner typed into configuration, not parsing
// arbitrary input, and a wrong-looking address should fail rather than ship.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Public-source locations are repository facts, not deployment secrets or
// owner policy decisions. Keep canonical, working defaults in source so a new
// deployment cannot accidentally hide the corresponding-source path merely
// because an environment variable was omitted. Validated overrides remain
// available for a future repository move.
export const DEFAULT_SOURCE_URLS = Object.freeze({
  application: "https://github.com/EZmannBuilds/orbit-axis",
  engine: "https://github.com/EZmannBuilds/orbit-axis-engine",
});

/** Only https on a known code host. An unvalidated URL here is a link Orbit vouches for. */
export function safeSourceUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let url;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol !== "https:") return null;
  const allowed = new Set(["github.com", "gitlab.com", "codeberg.org", "git.sr.ht"]);
  if (!allowed.has(url.hostname)) return null;
  return url.toString();
}

/** Resolve the two public repositories with the same names and precedence everywhere. */
export function sourceRepositoryUrls(env = process.env) {
  return {
    application: safeSourceUrl(
      env.ORBIT_SOURCE_APP_URL || env.ORBIT_SOURCE_URL || DEFAULT_SOURCE_URLS.application,
    ),
    engine: safeSourceUrl(
      env.ORBIT_SOURCE_ENGINE_URL || env.ORBIT_ENGINE_SOURCE_URL || DEFAULT_SOURCE_URLS.engine,
    ),
  };
}

function cleanEmail(value) {
  const email = String(value || "").trim();
  return EMAIL.test(email) ? email : null;
}

function cleanAge(value) {
  const raw = String(value || "").trim();
  // Digits only. parseInt("16.5") silently yields 16, which would publish a
  // minimum age the owner never wrote — the failure mode this validator exists
  // to prevent.
  if (!/^\d+$/.test(raw)) return null;
  const age = Number.parseInt(raw, 10);
  // A minimum age outside this range is a typo, not a policy. Refusing it is
  // better than publishing "you must be 1 year old" or "130".
  if (!Number.isInteger(age) || age < 13 || age > 21) return null;
  return age;
}

function cleanText(value, max = 120) {
  const text = String(value || "").trim();
  if (!text || text.length > max) return null;
  return text;
}

/**
 * The public-facing legal configuration, and what is still missing.
 *
 * @returns {{
 *   supportEmail: string|null,
 *   legalEntity: string|null,
 *   jurisdiction: string|null,
 *   minimumAge: number|null,
 *   sourceUrls: { application: string|null, engine: string|null },
 *   missing: string[],
 *   readyForPublicRelease: boolean
 * }}
 */
export function legalConfig(env = process.env) {
  const sourceUrls = sourceRepositoryUrls(env);
  const config = {
    supportEmail: cleanEmail(env.ORBIT_SUPPORT_EMAIL),
    legalEntity: cleanText(env.ORBIT_LEGAL_ENTITY),
    jurisdiction: cleanText(env.ORBIT_GOVERNING_JURISDICTION),
    minimumAge: cleanAge(env.ORBIT_MINIMUM_AGE),
    sourceUrls,
  };

  const missing = [];
  if (!config.supportEmail) missing.push("ORBIT_SUPPORT_EMAIL");
  if (!config.legalEntity) missing.push("ORBIT_LEGAL_ENTITY");
  if (!config.jurisdiction) missing.push("ORBIT_GOVERNING_JURISDICTION");
  if (!config.minimumAge) missing.push("ORBIT_MINIMUM_AGE");

  return {
    ...config,
    missing,
    // Publishing with any of these unset would mean shipping a legal page that
    // states something nobody decided.
    readyForPublicRelease: missing.length === 0,
  };
}

/**
 * The shape the browser receives.
 *
 * Carries no environment variable names and no internal detail — a public page
 * needs the values, not a map of the configuration that produced them.
 */
export function publicLegalConfig(env = process.env) {
  const config = legalConfig(env);
  return {
    supportEmail: config.supportEmail,
    legalEntity: config.legalEntity,
    jurisdiction: config.jurisdiction,
    minimumAge: config.minimumAge,
    source: {
      application: config.sourceUrls.application,
      engine: config.sourceUrls.engine,
      published: Boolean(config.sourceUrls.application && config.sourceUrls.engine),
    },
    // A single flag the pages use to decide between real values and an honest
    // "still being finalised" state. The list of what is missing stays server
    // side: it is useful to the owner, not to a visitor.
    complete: config.readyForPublicRelease,
  };
}
