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
import {
  DEFAULT_SOURCE_URLS, legalConfig, REQUIRED_BEFORE_PUBLIC, sourceRepositoryUrls,
} from "../lib/legal/config.js";

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

/* ── Canonical source URLs, and what a default may and may not do ──────────── */
//
// Added while reconciling two concurrent implementations of this update. The
// question they disagreed on is worth pinning: repository URLs now have
// canonical defaults in source, and that is a deliberate exception to Orbit's
// rule that it never invents facts. These tests draw the line the exception
// stops at.

test("orbit-axis is the canonical application repository", () => {
  // The older EZmannBuilds/orbit URL still redirects, but a redirect is not a
  // canonical name. Everything that advertises the source says the same thing.
  assert.equal(DEFAULT_SOURCE_URLS.application, "https://github.com/EZmannBuilds/orbit-axis");
  assert.equal(DEFAULT_SOURCE_URLS.engine, "https://github.com/EZmannBuilds/orbit-axis-engine");

  const page = readFileSync(join(REPO_ROOT, "public", "source.html"), "utf8");
  assert.match(page, /href="https:\/\/github\.com\/EZmannBuilds\/orbit-axis"/);
  assert.match(page, /href="https:\/\/github\.com\/EZmannBuilds\/orbit-axis-engine"/);

  const doc = readFileSync(join(REPO_ROOT, "docs", "deployment", "swiss-ephemeris-licensing.md"), "utf8");
  assert.match(doc, /github\.com\/EZmannBuilds\/orbit-axis\b/);
});

test("configuration still wins over the canonical default", () => {
  // A default exists so a deployment cannot accidentally hide the
  // corresponding-source path. It must not become a hardcoded value that
  // outranks configuration — that would make the two source offers disagree the
  // moment the repository moved, which is the exact divergence this update fixed
  // between lib/legal/config.js and the v1 source endpoint.
  const moved = sourceRepositoryUrls({
    ORBIT_SOURCE_APP_URL: "https://gitlab.com/example/moved",
    ORBIT_SOURCE_ENGINE_URL: "https://codeberg.org/example/moved-engine",
  });
  assert.equal(moved.application, "https://gitlab.com/example/moved");
  assert.equal(moved.engine, "https://codeberg.org/example/moved-engine");

  // And with nothing configured, the canonical repositories answer.
  const defaulted = sourceRepositoryUrls({});
  assert.equal(defaulted.application, DEFAULT_SOURCE_URLS.application);
  assert.equal(defaulted.engine, DEFAULT_SOURCE_URLS.engine);

  // An override that is not a valid public repository is refused rather than
  // echoed — the endpoint may only advertise a link Orbit vouches for.
  const bogus = sourceRepositoryUrls({ ORBIT_SOURCE_APP_URL: "javascript:alert(1)" });
  assert.equal(bogus.application, null);
});

test("both source offers resolve the repositories the same way", () => {
  // /source (the page) and /api/v1/source (the machine-readable offer) were
  // reading DIFFERENT environment variable names, so configuring publication
  // could satisfy one and leave the other reporting pending. One resolver now
  // serves both, and both accept the same alternate names.
  const platform = readFileSync(join(REPO_ROOT, "lib", "api", "v1", "handlers", "platform.js"), "utf8");
  assert.match(platform, /sourceRepositoryUrls/,
    "the v1 source endpoint must use the shared resolver, not its own copy");

  const alternates = sourceRepositoryUrls({
    ORBIT_SOURCE_URL: "https://github.com/example/app-alternate",
    ORBIT_ENGINE_SOURCE_URL: "https://github.com/example/engine-alternate",
  });
  assert.equal(alternates.application, "https://github.com/example/app-alternate");
  assert.equal(alternates.engine, "https://github.com/example/engine-alternate");
});

test("the source page keeps a working link when configuration says nothing", () => {
  // The page ships real hrefs so it works with no JavaScript and no
  // configuration. legal.js overwrites them when configuration resolves a
  // value, and leaves them alone when it does not — a pending state here would
  // be a lie now that the repositories are public.
  const client = readFileSync(join(REPO_ROOT, "public", "legal.js"), "utf8");
  const guard = client.indexOf('key === "sourceApp" || key === "sourceEngine"');
  const unresolved = client.indexOf("if (!resolved)");
  assert.ok(unresolved >= 0 && guard > unresolved,
    "the static link is preserved only on the unresolved path");
  assert.match(client, /el\.href = resolved/,
    "a resolved configuration value must still be written to the link");
});

test("a canonical default must not leak into the four owner decisions", () => {
  // The exception is repository URLs, and only repository URLs. A support
  // address, publisher, jurisdiction or minimum age invented by Orbit would be a
  // promise nobody made — that rule is unchanged and is asserted here so a
  // future "sensible default" cannot quietly extend to them.
  const config = legalConfig({});
  assert.equal(config.supportEmail, null);
  assert.equal(config.legalEntity, null);
  assert.equal(config.jurisdiction, null);
  assert.equal(config.minimumAge, null);
  assert.equal(config.readyForPublicRelease, false);
  // But the source offer still resolves, because that is a repository fact.
  assert.equal(config.sourceUrls.application, DEFAULT_SOURCE_URLS.application);
});
