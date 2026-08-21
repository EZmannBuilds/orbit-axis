// Orbit Axis :: AGPL source-availability posture (Dev Update 6.0).
//
// Orbit uses the Swiss Ephemeris under its AGPL option, which is what makes
// Orbit itself AGPL and obliges it to offer network users the complete
// corresponding source. That obligation is met by a set of artifacts — licence
// files, upstream notices, a /source page, and two public repository links —
// any one of which could quietly disappear in a refactor.
//
// These tests run the audit against the REAL repository, so a regression fails
// here rather than in front of a user. They deliberately assert posture and
// availability, NOT legal compliance: no test can determine that, and none of
// these claims to.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../lib/local-llm/config.js";
import { auditSourcePosture, describeSourcePostureScope } from "../lib/legal/source-posture.js";
import { legalConfig, REQUIRED_BEFORE_PUBLIC } from "../lib/legal/config.js";

const CONFIGURED = {
  ORBIT_SOURCE_APP_URL: "https://github.com/EZmannBuilds/orbit-axis",
  ORBIT_SOURCE_ENGINE_URL: "https://github.com/EZmannBuilds/orbit-axis-engine",
};

const audit = (env = CONFIGURED, extra = {}) =>
  auditSourcePosture({ root: REPO_ROOT, env, ...extra });

/* ── The repository as it stands ──────────────────────────────────────────── */

test("this repository satisfies the AGPL source-offer checks", () => {
  const result = audit();
  assert.deepEqual(result.findings, [],
    `AGPL posture regressed: ${result.findings.map((f) => f.message).join("; ")}`);
  assert.equal(result.ok, true);
});

test("the audit is honest about what it cannot establish", () => {
  const scope = describeSourcePostureScope();
  assert.equal(scope.legalAdvice, false);
  assert.match(scope.doesNotCheck, /legal compliance/i);
});

/* ── Each artifact is genuinely load-bearing ──────────────────────────────── */

test("a missing or non-AGPL licence is a blocker", () => {
  // Proved against a directory that has no LICENSE, rather than by deleting the
  // real one.
  const result = auditSourcePosture({ root: join(REPO_ROOT, "lib"), env: CONFIGURED });
  const codes = result.findings.map((f) => f.code);
  assert.ok(codes.includes("license_missing"));
  assert.ok(codes.includes("notice_missing"));
  assert.ok(codes.includes("third_party_missing"));
  assert.ok(codes.includes("source_page_missing"));
  assert.equal(result.ok, false);
});

test("invalid repository-link overrides are blockers where Orbit is reachable", () => {
  // This is the regression that matters most: without a link, the AGPL offer
  // silently degrades into "email the founder", which is what the source page
  // used to say and what this whole update exists to end.
  const result = audit({
    ORBIT_SOURCE_APP_URL: "not-a-public-repository",
    ORBIT_SOURCE_ENGINE_URL: "not-a-public-repository",
  });
  const codes = result.findings.map((f) => f.code);
  assert.ok(codes.includes("source_url_app"));
  assert.ok(codes.includes("source_url_engine"));
  assert.equal(result.ok, false);
});

test("a local checkout is warned, not blocked, about invalid link overrides", () => {
  const result = audit({
    ORBIT_SOURCE_APP_URL: "not-a-public-repository",
    ORBIT_SOURCE_ENGINE_URL: "not-a-public-repository",
  }, { requireSourceUrls: false });
  const urlFindings = result.findings.filter((f) => f.code.startsWith("source_url_"));
  assert.equal(urlFindings.length, 2);
  for (const finding of urlFindings) assert.equal(finding.level, "WARNING");
  assert.equal(result.ok, true, "a developer's machine is not a public deployment");
});

test("a manifest still calling the licence unresolved is a blocker", () => {
  const result = audit(CONFIGURED, {
    manifest: { source: { licenceStatus: "UNRESOLVED. No licence has been selected." } },
  });
  assert.ok(result.findings.some((f) => f.code === "manifest_unresolved"));
});

test("the shipped manifest records the AGPL option, not an open question", () => {
  const manifest = JSON.parse(readFileSync(
    join(REPO_ROOT, "vendor", "orbit-axis-engine", "src", "adapters", "swiss-ephemeris", "manifest.json"), "utf8"));
  const status = manifest.source.licenceStatus;
  assert.match(status, /AGPL/i);
  assert.ok(!/unresolved/i.test(status),
    "the manifest must not contradict the licensing record");
  // The dual-licence fact itself stays stated: which option Orbit takes is only
  // meaningful next to the fact that there were two.
  assert.match(manifest.source.licence, /dual-licensed/i);
});

/* ── The source page ──────────────────────────────────────────────────────── */

test("the source page no longer claims publication is pending", () => {
  const page = readFileSync(join(REPO_ROOT, "public", "source.html"), "utf8");
  assert.ok(!/publication is pending/i.test(page),
    "both repositories are public; a stale pending notice turns a working offer into a request form");
  assert.ok(!/neither has been made public/i.test(page));
  // And it still names the licence that entitles a visitor to the source.
  assert.match(page, /AGPL/);
  assert.match(page, /Swiss Ephemeris/);
});

test("the source page states which of the two Swiss Ephemeris options Orbit uses", () => {
  const page = readFileSync(join(REPO_ROOT, "public", "source.html"), "utf8");
  assert.match(page, /uses the AGPL option/i);
});

test("the source page ships working links without depending on runtime configuration", () => {
  const page = readFileSync(join(REPO_ROOT, "public", "source.html"), "utf8");
  assert.match(page, /href="https:\/\/github\.com\/EZmannBuilds\/orbit-axis"/);
  assert.match(page, /href="https:\/\/github\.com\/EZmannBuilds\/orbit-axis-engine"/);
  const client = readFileSync(join(REPO_ROOT, "public", "legal.js"), "utf8");
  assert.match(client, /keep those working static links/i);
});

/* ── The licensing record ─────────────────────────────────────────────────── */

test("the licensing document records the AGPL route rather than an open question", () => {
  const doc = readFileSync(join(REPO_ROOT, "docs", "deployment", "swiss-ephemeris-licensing.md"), "utf8");
  assert.ok(!/^# Swiss Ephemeris licensing — UNRESOLVED/m.test(doc));
  assert.ok(!/Status: unresolved/i.test(doc));
  assert.match(doc, /AGPL option/i);
  // It must keep saying what it is not. A record that started claiming legal
  // certainty would be worse than the stale one it replaced.
  // Whitespace-tolerant: this is prose, and a line wrap must not fail an
  // assertion about what the document says.
  assert.match(doc, /not\s+legal\s+advice/i);
  assert.match(doc, /Professional License/,
    "the paid option must stay documented as an available future decision");
});

/* ── Public legal configuration ───────────────────────────────────────────── */

test("the four public legal values are still required, and still refused when absent", () => {
  const empty = legalConfig({});
  assert.deepEqual(empty.missing, [...REQUIRED_BEFORE_PUBLIC]);
  assert.equal(empty.readyForPublicRelease, false);
  // Nothing is invented to fill the gap.
  assert.equal(empty.supportEmail, null);
  assert.equal(empty.legalEntity, null);

  const complete = legalConfig({
    ORBIT_SUPPORT_EMAIL: "hello@example.com",
    ORBIT_LEGAL_ENTITY: "Example Publisher",
    ORBIT_GOVERNING_JURISDICTION: "Illinois, USA",
    ORBIT_MINIMUM_AGE: "16",
  });
  assert.deepEqual(complete.missing, []);
  assert.equal(complete.readyForPublicRelease, true);
});
