// Orbit Axis :: AGPL source-availability posture.
//
// WHAT THIS IS, AND WHAT IT IS NOT
//
// Orbit uses the Swiss Ephemeris under its AGPL option, which makes Orbit
// itself AGPL and obliges it to offer network users the complete corresponding
// source. See docs/deployment/swiss-ephemeris-licensing.md for the record of
// that choice.
//
// This module checks that the ARTIFACTS implementing that offer are present and
// still say what the record says they say. It is a **posture and source
// availability check, not a legal certification** — no script can determine
// compliance, and nothing here claims to. What it can do is catch the
// regressions that would quietly break the offer:
//
//   - the AGPL licence file going missing or being replaced
//   - the source page losing its links, or reverting to a "pending" claim
//   - the repository URLs falling out of configuration, so the only route to
//     the source becomes emailing the founder
//   - upstream Swiss Ephemeris notices being dropped
//   - the engine manifest still describing the licence as unresolved
//
// Each finding names the artifact and what to do. Read-only and offline.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SOURCE_URLS, sourceRepositoryUrls } from "./config.js";

/** The phrase a licence file must contain to count as the AGPL. */
const AGPL_TITLE = "GNU AFFERO GENERAL PUBLIC LICENSE";

/** Language that would mean the source page is still claiming publication is pending. */
const PENDING_CLAIM = /publication is pending|has not been made public|neither has been made public/i;

function read(root, relative) {
  const full = join(root, relative);
  if (!existsSync(full)) return null;
  try { return readFileSync(full, "utf8"); } catch { return null; }
}

/**
 * Audit the AGPL source offer.
 *
 * @param {{ root: string, env?: object, manifest?: object, requireSourceUrls?: boolean }} options
 *   requireSourceUrls — true where the app is actually reachable by network users, which is
 *   where the AGPL offer has to resolve to a link. A local checkout has no such duty, so the
 *   same gap is reported as a warning there rather than training people to ignore blockers.
 * @returns {{ findings: Array<{level:string, code:string, message:string, action:string}>, ok: boolean, sourceUrls: {application:string|null, engine:string|null} }}
 */
export function auditSourcePosture({ root, env = process.env, manifest = null, requireSourceUrls = true } = {}) {
  const findings = [];
  const fail = (code, message, action) => findings.push({ level: "BLOCKER", code, message, action });
  const warn = (code, message, action) => findings.push({ level: "WARNING", code, message, action });

  // ── Orbit's own licence ───────────────────────────────────────────────────
  const license = read(root, "LICENSE");
  if (!license) {
    fail("license_missing", "LICENSE is missing from the repository root.",
      "Orbit is AGPL because Swiss Ephemeris is used under its AGPL option. Restore the AGPL-3.0 text.");
  } else if (!license.includes(AGPL_TITLE)) {
    fail("license_not_agpl", "LICENSE does not contain the GNU Affero General Public License text.",
      "The AGPL route recorded in docs/deployment/swiss-ephemeris-licensing.md requires the AGPL here.");
  }

  const engineLicense = read(root, join("vendor", "orbit-axis-engine", "LICENSE"));
  if (!engineLicense) {
    warn("engine_license_missing", "The vendored engine carries no LICENSE file.",
      "Re-run npm run engine:sync so the engine's AGPL licence travels with the code Orbit ships.");
  } else if (!engineLicense.includes(AGPL_TITLE)) {
    fail("engine_license_not_agpl", "The vendored engine's LICENSE is not the AGPL.",
      "The calculation engine must carry the same licence Orbit claims for it on /source.");
  }

  let pkg = null;
  try { pkg = JSON.parse(read(root, "package.json") || "{}"); } catch { pkg = null; }
  if (pkg && !/^AGPL-3\.0(-or-later)?$/.test(String(pkg.license || ""))) {
    fail("package_license", `package.json declares license "${pkg.license || "(none)"}", not AGPL-3.0-or-later.`,
      "The declared licence is what tooling and reviewers read first. Set it to AGPL-3.0-or-later.");
  }

  // ── Upstream notices ──────────────────────────────────────────────────────
  const notice = read(root, "NOTICE");
  if (!notice || !/affero|agpl/i.test(notice)) {
    fail("notice_missing", "NOTICE is missing or does not state the AGPL network-use position.",
      "Section 13 is the reason Orbit publishes source at all; NOTICE is where that is stated.");
  }

  const thirdParty = read(root, "THIRD_PARTY_NOTICES.md");
  if (!thirdParty) {
    fail("third_party_missing", "THIRD_PARTY_NOTICES.md is missing.",
      "Astrodienst's copyright notice for the Swiss Ephemeris must be preserved.");
  } else {
    if (!/swiss ephemeris/i.test(thirdParty)) {
      fail("third_party_no_swiss", "THIRD_PARTY_NOTICES.md does not mention the Swiss Ephemeris.",
        "Every astrology feature depends on it; its notice cannot be dropped.");
    }
    if (!/astrodienst/i.test(thirdParty)) {
      fail("third_party_no_copyright", "THIRD_PARTY_NOTICES.md does not carry the Astrodienst copyright.",
        "Preserve the upstream copyright line rather than summarising it away.");
    }
    if (!/agpl/i.test(thirdParty)) {
      fail("third_party_no_option", "THIRD_PARTY_NOTICES.md does not name which Swiss Ephemeris licence option Orbit uses.",
        "Swiss Ephemeris is dual-licensed. The notice must say Orbit uses the AGPL option.");
    }
  }

  // ── The human-readable source offer ───────────────────────────────────────
  const sourcePage = read(root, join("public", "source.html"));
  if (!sourcePage) {
    fail("source_page_missing", "public/source.html is missing.",
      "It is the human-readable source offer served at /source.");
  } else {
    if (!/agpl/i.test(sourcePage)) {
      fail("source_page_no_licence", "The source page does not name the AGPL.",
        "A network user must be able to see which licence entitles them to the source.");
    }
    if (PENDING_CLAIM.test(sourcePage)) {
      fail("source_page_pending", "The source page still claims repository publication is pending.",
        "Both repositories are public. A stale pending notice turns a working source offer into a "
        + "request form, which is the failure this check exists to catch.");
    }
    if (!/data-legal="sourceApp"/.test(sourcePage) || !/data-legal="sourceEngine"/.test(sourcePage)) {
      fail("source_page_no_slots", "The source page no longer carries both repository link slots.",
        "The application and engine repositories must each be linked from /source.");
    }
    for (const [component, url] of Object.entries(DEFAULT_SOURCE_URLS)) {
      if (!sourcePage.includes(`href="${url}"`)) {
        fail(`source_page_${component}_link`, `The source page does not contain the canonical ${component} repository link.`,
          "Restore the checked-in public source link so it works even if runtime configuration cannot load.");
      }
    }
  }

  // ── The links themselves ──────────────────────────────────────────────────
  const { application, engine } = sourceRepositoryUrls(env);
  const urlLevel = requireSourceUrls ? fail : warn;
  if (!application) {
    urlLevel("source_url_app", "The application source URL is not a valid public repository URL.",
      "Restore the checked-in canonical URL or set a valid https override on a known code host.");
  }
  if (!engine) {
    urlLevel("source_url_engine", "The engine source URL is not a valid public repository URL.",
      "Restore the checked-in canonical URL or set a valid https override on a known code host.");
  }

  // ── The engine's own licensing record ─────────────────────────────────────
  const status = String(manifest?.source?.licenceStatus || "");
  if (status && /unresolved|no licence has been selected/i.test(status)) {
    fail("manifest_unresolved", "The engine runtime manifest still describes Swiss Ephemeris licensing as unresolved.",
      "It contradicts docs/deployment/swiss-ephemeris-licensing.md, which records the AGPL option. "
      + "Update licenceStatus in the engine manifest (and re-run npm run engine:sync).");
  }

  return {
    findings,
    ok: findings.every((f) => f.level !== "BLOCKER"),
    sourceUrls: { application, engine },
  };
}

/**
 * What this audit can and cannot establish. Surfaced next to the findings so a
 * clean run is never mistaken for a compliance opinion.
 */
export function describeSourcePostureScope() {
  return {
    checks: "presence and consistency of the AGPL source-offer artifacts",
    doesNotCheck: "legal compliance, the adequacy of the offer in any jurisdiction, "
      + "or whether the published source actually corresponds to the deployed build",
    legalAdvice: false,
  };
}
