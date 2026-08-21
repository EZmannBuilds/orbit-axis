// Orbit Axis API v1 :: contract, validation, and security tests.
//
// This is the contract a future iOS client will depend on, so the tests treat
// the envelope shape and the error codes as promises rather than implementation
// details. If one of these fails, a client has been broken.
//
// Nothing here contacts a network, a database, or a model.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { handleApiV1, ROUTE_TABLE, isAllowedOrigin, createLimiters } from "../lib/api/v1/router.js";
import { ERROR_CODES, ApiError } from "../lib/api/v1/errors/codes.js";
import { requestId, SAFE_INBOUND_ID } from "../lib/api/request-id.js";
import { createMemoryRateLimiter } from "../lib/api/rate-limit.js";
import { safeRepositoryUrl } from "../lib/api/v1/handlers/platform.js";
import { CONTRACT_VERSION } from "@ezmannbuilds/orbit-axis-engine";

// Synthetic birth data. Not a real person's, and deliberately not the owner's.
const BIRTH = Object.freeze({
  birthDate: "1990-06-15",
  birthTime: "14:30",
  birthTimeKnown: true,
  timezone: "America/Chicago",
  latitude: 41.8781,
  longitude: -87.6298,
});

function mockReq({ method = "GET", url = "/api/v1/health", headers = {}, body, raw } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { ...(body !== undefined || raw !== undefined ? { "content-type": "application/json" } : {}), ...headers };
  req.socket = { remoteAddress: "127.0.0.1" };
  req.destroy = () => req.emit("close");
  const payload = raw !== undefined ? raw : (body !== undefined ? JSON.stringify(body) : null);
  setImmediate(() => {
    if (payload !== null) req.emit("data", Buffer.from(payload));
    req.emit("end");
  });
  return req;
}

// Each call gets fresh limiters. The module-level limiters are shared per
// instance by design, which is correct in production and useless in a test
// suite — without isolation these tests would exhaust the calculation budget
// and start asserting against RATE_LIMITED instead of what they mean to check.
const call = (opts) => handleApiV1(
  mockReq(opts),
  (opts.url || "/api/v1/health").split("?")[0],
  { limiters: createLimiters() },
);

// ── envelope contract ───────────────────────────────────────────────────────

test("a successful response uses the standard envelope", async () => {
  const r = await call({ url: "/api/v1/health" });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ["data", "error", "meta"]);
  assert.equal(r.body.error, null);
  assert.ok(r.body.data);
  assert.equal(r.body.meta.contractVersion, CONTRACT_VERSION);
  assert.ok(r.body.meta.requestId);
  assert.ok(r.body.meta.applicationVersion);
  assert.ok(r.body.meta.engineVersion);
});

test("a failure response uses the standard envelope with a stable code", async () => {
  const r = await call({ method: "POST", url: "/api/v1/charts/natal", body: { birthDate: "nope" } });
  assert.equal(r.status, 400);
  assert.equal(r.body.data, null);
  assert.equal(r.body.error.code, "INVALID_DATE");
  assert.ok(r.body.error.message);
  assert.equal(r.body.meta.contractVersion, CONTRACT_VERSION);
  assert.ok(r.body.meta.requestId, "an error must still be quotable by request id");
});

test("exactly one of data and error is populated, always", async () => {
  for (const opts of [
    { url: "/api/v1/health" },
    { url: "/api/v1/nope" },
    { method: "POST", url: "/api/v1/charts/natal", body: BIRTH },
    { method: "POST", url: "/api/v1/charts/natal", body: {} },
  ]) {
    const r = await call(opts);
    assert.notEqual(r.body.data === null, r.body.error === null,
      `${opts.url}: exactly one of data/error must be null`);
  }
});

test("every response carries JSON content type and a request id header", async () => {
  const r = await call({ url: "/api/v1/version" });
  assert.match(r.headers["Content-Type"], /application\/json/);
  assert.equal(r.headers["X-Request-Id"], r.body.meta.requestId);
  assert.equal(r.headers["Cache-Control"], "no-store");
});

test("no v1 response is ever HTML", async () => {
  const r = await call({ url: "/api/v1/does-not-exist" });
  assert.equal(r.status, 404);
  assert.match(r.headers["Content-Type"], /application\/json/);
  assert.equal(typeof r.body, "object");
});

test("current sky exposes the canonical local-day contract through API v1", async () => {
  const r = await call({
    url: "/api/v1/sky/current?tz=America%2FChicago&at=2026-07-28T01%3A30%3A00Z",
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.context_version, "current-sky-context-v1");
  assert.equal(r.body.data.calculated_at_utc, "2026-07-28T01:30:00.000Z");
  assert.equal(r.body.data.user_timezone, "America/Chicago");
  assert.equal(r.body.data.timezone_source, "request");
  assert.equal(r.body.data.timezone_fallback, false);
  assert.equal(r.body.data.local_date, "2026-07-27");
  assert.ok(r.body.data.moon_phase_name);
  assert.equal(typeof r.body.data.moon_phase_fraction, "number");
  assert.equal(typeof r.body.data.illumination_percent, "number");
  assert.equal(typeof r.body.data.is_waxing, "boolean");
  assert.ok(r.body.data.next_full_moon.instant_utc);
  assert.ok(r.body.data.next_new_moon.instant_utc);
  assert.equal(r.body.data.source.calculation, "orbit-axis-engine");
});

test("current sky labels UTC fallback and rejects an invalid requested timezone", async () => {
  const fallback = await call({
    url: "/api/v1/sky/current?at=2026-07-28T01%3A30%3A00Z",
  });
  assert.equal(fallback.status, 200);
  assert.equal(fallback.body.data.user_timezone, "UTC");
  assert.equal(fallback.body.data.timezone_source, "utc_fallback");
  assert.equal(fallback.body.data.timezone_fallback, true);

  const invalid = await call({
    url: "/api/v1/sky/current?tz=Definitely%2FNot_A_Zone",
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "INVALID_TIMEZONE");
  assert.equal(invalid.body.error.details.field, "tz");
});

test("a well-formed inbound request id is honoured; a hostile one is not", async () => {
  const good = await call({ url: "/api/v1/health", headers: { "x-request-id": "client-abc-123" } });
  assert.equal(good.body.meta.requestId, "client-abc-123");
  for (const hostile of ["a b", "x".repeat(200), "id\r\nInjected: yes", "<script>", "short"]) {
    const generated = requestId({ headers: { "x-request-id": hostile } });
    assert.notEqual(generated, hostile, `${JSON.stringify(hostile)} must not be echoed`);
    assert.match(generated, /^[a-f0-9]{24}$/);
  }
});

test("request ids cannot carry a header-injection payload", () => {
  assert.ok(!SAFE_INBOUND_ID.test("a\r\nX-Evil: 1"));
  assert.ok(!SAFE_INBOUND_ID.test("a\nb"));
  assert.ok(SAFE_INBOUND_ID.test("abc12345"));
});

// ── platform endpoints ──────────────────────────────────────────────────────

test("health reports capability without leaking configuration", async () => {
  const r = await call({ url: "/api/v1/health" });
  const d = r.body.data;
  assert.ok(["ok", "degraded"].includes(d.status));
  assert.equal(typeof d.runtime.ephemerisAvailable, "boolean");
  const text = JSON.stringify(d);
  for (const forbidden of ["supabase.co", "SUPABASE", "/Users/", "service_role", "postgres://", "swetest"]) {
    assert.ok(!text.includes(forbidden), `health leaked ${forbidden}`);
  }
});

test("version works even with no git metadata available", async () => {
  const r = await call({ url: "/api/v1/version" });
  assert.equal(r.status, 200);
  assert.ok(r.body.data.applicationVersion);
  assert.ok("commit" in r.body.data.build, "build identity must be present even when null");
});

test("source reports AGPL and both public repositories", async () => {
  const r = await call({ url: "/api/v1/source" });
  const d = r.body.data;
  assert.equal(d.application.license, "AGPL-3.0-or-later");
  assert.equal(d.engine.license, "AGPL-3.0-or-later");
  assert.equal(d.application.repositoryUrl, "https://github.com/EZmannBuilds/orbit-axis");
  assert.equal(d.engine.repositoryUrl, "https://github.com/EZmannBuilds/orbit-axis-engine");
  assert.equal(d.application.repositoryStatus, "published");
  assert.equal(d.engine.repositoryStatus, "published");
  assert.ok(d.thirdParty.some((t) => t.name === "Swiss Ephemeris"));
  assert.match(d.thirdParty.find((t) => t.name === "Swiss Ephemeris").license, /AGPL option/i);
});

test("source and version report the same running component versions", async () => {
  const [sourceResponse, versionResponse] = await Promise.all([
    call({ url: "/api/v1/source" }),
    call({ url: "/api/v1/version" }),
  ]);
  const source = sourceResponse.body.data;
  const version = versionResponse.body.data;
  assert.equal(source.application.version, version.applicationVersion);
  assert.equal(source.engine.version, version.engineVersion);
  assert.equal(source.thirdParty.find((t) => t.name === "Swiss Ephemeris").version, version.ephemerisVersion);
});

test("only https URLs on known code hosts are accepted as source URLs", () => {
  assert.ok(safeRepositoryUrl("https://github.com/EZmannBuilds/orbit"));
  for (const bad of [
    "http://github.com/x/y", "https://evil.example/x", "javascript:alert(1)",
    "ftp://github.com/x", "", null, undefined, "not a url",
  ]) {
    assert.equal(safeRepositoryUrl(bad), null, `${bad} must be rejected`);
  }
});

// ── calculation endpoints ───────────────────────────────────────────────────

test("natal returns a complete chart with metadata", async () => {
  const r = await call({ method: "POST", url: "/api/v1/charts/natal", body: BIRTH });
  assert.equal(r.status, 200);
  const d = r.body.data;
  assert.equal(Object.keys(d.chart.planets).length, 10);
  assert.equal(d.chart.houses.length, 12);
  assert.ok(d.chart.angles.ascendant);
  assert.equal(d.metadata.contractVersion, CONTRACT_VERSION);
  assert.equal(d.metadata.zodiacType, "tropical");
  assert.ok(d.metadata.ephemerisVersion);
});

test("natal is deterministic", async () => {
  const a = await call({ method: "POST", url: "/api/v1/charts/natal", body: BIRTH });
  const b = await call({ method: "POST", url: "/api/v1/charts/natal", body: BIRTH });
  assert.deepEqual(a.body.data.chart, b.body.data.chart);
});

test("unknown birth time withholds houses and says so", async () => {
  const r = await call({
    method: "POST", url: "/api/v1/charts/natal",
    body: { ...BIRTH, birthTimeKnown: false },
  });
  assert.equal(r.status, 200);
  const d = r.body.data;
  assert.equal(d.chart.houses.length, 0, "houses require a birth time");
  // The angles container is kept with null members rather than being nulled
  // wholesale: a stable response shape means a client never has to null-check
  // the container before reading a field.
  assert.equal(d.chart.angles.ascendant, null, "no Rising sign without a birth time");
  assert.equal(d.chart.angles.midheaven, null, "no Midheaven without a birth time");
  assert.ok(d.limitations.some((l) => l.code === "BIRTH_TIME_UNKNOWN"),
    "the response must state that houses and angles are unavailable");
});

test("transits return sky, aspects, and applying/separating motion", async () => {
  const r = await call({
    method: "POST", url: "/api/v1/charts/transits",
    body: { ...BIRTH, at: "2026-07-21T12:00:00Z" },
  });
  assert.equal(r.status, 200);
  const d = r.body.data;
  assert.equal(d.at, "2026-07-21T12:00:00.000Z");
  assert.ok(d.sky.snapshotHash);
  for (const t of d.transits) {
    assert.ok(["applying", "separating", "exact"].includes(t.motion));
    assert.ok(t.orb >= 0);
  }
});

test("synastry compares two charts and refuses to score compatibility", async () => {
  const r = await call({
    method: "POST", url: "/api/v1/charts/synastry",
    body: { chartA: BIRTH, chartB: { ...BIRTH, birthDate: "1986-11-02", birthTime: "07:15" } },
  });
  assert.equal(r.status, 200);
  const d = r.body.data;
  assert.ok(d.aspects.length > 0);
  assert.equal(d.summary.total, d.summary.easy + d.summary.challenging + d.summary.intense);
  assert.ok(!("score" in d.summary), "the API must not score compatibility");
  assert.ok(d.limitations.some((l) => l.code === "SYNASTRY_SCOPE"),
    "the response must state that this is not a compatibility measurement");
});

test("synastry names which chart was invalid", async () => {
  const r = await call({
    method: "POST", url: "/api/v1/charts/synastry",
    body: { chartA: BIRTH, chartB: { ...BIRTH, latitude: 999 } },
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, "INVALID_COORDINATES");
  assert.equal(r.body.error.details.field, "chartB.latitude");
});

test("evidence is deterministic and declares it is not AI-generated", async () => {
  const body = { ...BIRTH, at: "2026-07-21T12:00:00Z", question: "How is the current sky affecting me?" };
  const a = await call({ method: "POST", url: "/api/v1/readings/evidence", body });
  const b = await call({ method: "POST", url: "/api/v1/readings/evidence", body });
  assert.equal(a.status, 200);
  assert.equal(a.body.data.generatedBy, "deterministic-engine");
  assert.equal(a.body.data.aiAssisted, false, "no model was used, and the payload must say so");
  assert.ok(a.body.data.evidence.length > 0);
  assert.deepEqual(a.body.data.evidence, b.body.data.evidence, "evidence must be deterministic");
});

// ── validation ──────────────────────────────────────────────────────────────

const NATAL = "/api/v1/charts/natal";

test("impossible and malformed dates are rejected, never repaired", async () => {
  for (const [birthDate, code] of [
    ["2005-02-30", "INVALID_DATE"], ["2005-13-01", "INVALID_DATE"],
    ["not-a-date", "INVALID_DATE"], ["1990-6-15", "INVALID_DATE"],
    ["1500-01-01", "INVALID_DATE"], ["", "INVALID_DATE"],
  ]) {
    const r = await call({ method: "POST", url: NATAL, body: { ...BIRTH, birthDate } });
    assert.equal(r.body.error.code, code, `${birthDate} should be ${code}`);
    assert.equal(r.status, 400);
  }
});

test("malformed times are rejected", async () => {
  for (const birthTime of ["25:00", "12:60", "noon", "1430", ""]) {
    const r = await call({ method: "POST", url: NATAL, body: { ...BIRTH, birthTime } });
    assert.equal(r.body.error.code, "INVALID_TIME", `${birthTime} should be rejected`);
  }
});

test("unknown time zones are rejected", async () => {
  for (const timezone of ["Mars/Olympus", "", "GMT+25", 42]) {
    const r = await call({ method: "POST", url: NATAL, body: { ...BIRTH, timezone } });
    assert.equal(r.body.error.code, "INVALID_TIMEZONE");
  }
});

test("out-of-range coordinates are rejected, never clamped", async () => {
  for (const patch of [
    { latitude: 91 }, { latitude: -91 }, { longitude: 181 }, { longitude: -181 },
    { latitude: "41.8" }, { latitude: NaN }, { longitude: Infinity },
  ]) {
    const r = await call({ method: "POST", url: NATAL, body: { ...BIRTH, ...patch } });
    assert.equal(r.body.error.code, "INVALID_COORDINATES", `${JSON.stringify(patch)} should be rejected`);
  }
});

test("house systems and zodiac types use allow-lists", async () => {
  const bad = await call({ method: "POST", url: NATAL, body: { ...BIRTH, houseSystem: "vedic-special" } });
  assert.equal(bad.body.error.code, "UNSUPPORTED_HOUSE_SYSTEM");
  const sidereal = await call({ method: "POST", url: NATAL, body: { ...BIRTH, zodiacType: "sidereal" } });
  assert.equal(sidereal.body.error.code, "UNSUPPORTED_ZODIAC_TYPE",
    "requesting sidereal must fail loudly, not silently return tropical");
  const ok = await call({ method: "POST", url: NATAL, body: { ...BIRTH, houseSystem: "whole-sign" } });
  assert.equal(ok.status, 200);
});

test("invalid JSON, empty bodies, and non-objects are rejected", async () => {
  assert.equal((await call({ method: "POST", url: NATAL, raw: "{not json" })).body.error.code, "INVALID_JSON");
  assert.equal((await call({ method: "POST", url: NATAL, raw: "" })).body.error.code, "INVALID_JSON");
  assert.equal((await call({ method: "POST", url: NATAL, raw: "[1,2,3]" })).body.error.code, "INVALID_INPUT");
});

test("an oversized body is refused with 413", async () => {
  const r = await call({ method: "POST", url: NATAL, raw: JSON.stringify({ pad: "x".repeat(100_000) }) });
  assert.equal(r.status, 413);
  assert.equal(r.body.error.code, "REQUEST_TOO_LARGE");
});

test("an invalid transit instant is rejected", async () => {
  for (const at of ["not-a-time", "1200-01-01T00:00:00Z", 42]) {
    const r = await call({ method: "POST", url: "/api/v1/charts/transits", body: { ...BIRTH, at } });
    assert.equal(r.body.error.code, "INVALID_DATE", `${at} should be rejected`);
  }
});

// ── security ────────────────────────────────────────────────────────────────

test("wrong methods are refused with an Allow header", async () => {
  const r = await call({ method: "DELETE", url: "/api/v1/health" });
  assert.equal(r.status, 405);
  assert.equal(r.body.error.code, "METHOD_NOT_ALLOWED");
  assert.ok(r.headers.Allow);
});

test("a non-JSON content type is refused", async () => {
  const r = await call({
    method: "POST", url: NATAL,
    headers: { "content-type": "text/plain" }, raw: JSON.stringify(BIRTH),
  });
  assert.equal(r.status, 415);
  assert.equal(r.body.error.code, "UNSUPPORTED_MEDIA_TYPE");
});

test("command-injection strings in input are rejected as invalid, not executed", async () => {
  const injections = [
    "1990-06-15; rm -rf /", "$(whoami)", "`id`", "../../etc/passwd",
    "1990-06-15 && curl evil.example", "1990-06-15|cat /etc/passwd",
  ];
  for (const value of injections) {
    const r = await call({ method: "POST", url: NATAL, body: { ...BIRTH, birthDate: value } });
    assert.equal(r.status, 400, `${value} must be rejected`);
    assert.equal(r.body.error.code, "INVALID_DATE");
  }
});

test("an executable path cannot be supplied by a client", async () => {
  const r = await call({
    method: "POST", url: NATAL,
    body: { ...BIRTH, executable: "/bin/sh", ephemerisPath: "/tmp/evil", binary: "/bin/sh" },
  });
  // Unknown fields are ignored entirely — the runtime comes from the manifest.
  assert.equal(r.status, 200);
  assert.ok(!JSON.stringify(r.body).includes("/bin/sh"));
});

test("a client-supplied user id is never reflected or trusted", async () => {
  const r = await call({
    method: "POST", url: NATAL,
    body: { ...BIRTH, userId: "someone-else", owner_id: "admin", role: "service_role" },
  });
  assert.equal(r.status, 200);
  const text = JSON.stringify(r.body);
  assert.ok(!text.includes("someone-else"));
  assert.ok(!text.includes("service_role"));
});

test("no error response contains a stack trace or filesystem path", async () => {
  for (const opts of [
    { method: "POST", url: NATAL, raw: "{bad" },
    { method: "POST", url: NATAL, body: { ...BIRTH, latitude: 999 } },
    { method: "DELETE", url: "/api/v1/health" },
    { url: "/api/v1/nope" },
  ]) {
    const text = JSON.stringify((await call(opts)).body);
    assert.doesNotMatch(text, /\/Users\/|at Object\.|node:internal|\.js:\d+/, `leak in ${opts.url}`);
  }
});

test("error details never echo the offending value", async () => {
  const r = await call({ method: "POST", url: NATAL, body: { ...BIRTH, birthDate: "2005-02-30" } });
  const text = JSON.stringify(r.body);
  assert.ok(!text.includes("2005-02-30"), "a birth date must not be echoed into an error");
  assert.equal(r.body.error.details.field, "birthDate", "the field name is enough");
});

test("no successful response echoes the full birth input beyond what was asked for", async () => {
  const r = await call({ method: "POST", url: NATAL, body: BIRTH });
  // Echoing the submitted input back is intentional and useful, but it must be
  // the validated subset, not arbitrary client fields.
  assert.deepEqual(Object.keys(r.body.data.input).sort(),
    ["birthDate", "birthTime", "birthTimeKnown", "houseSystem", "timezone", "zodiacType"]);
});

// ── rate limiting ───────────────────────────────────────────────────────────

test("the rate limiter admits then refuses, and is honest about its scope", () => {
  let clock = 0;
  const limiter = createMemoryRateLimiter({ limit: 3, windowMs: 1000, now: () => clock });
  for (let i = 0; i < 3; i++) assert.equal(limiter.check("k").allowed, true, `call ${i + 1}`);
  const refused = limiter.check("k");
  assert.equal(refused.allowed, false);
  assert.ok(refused.retryAfterSeconds >= 1);
  clock = 1001;
  assert.equal(limiter.check("k").allowed, true, "the window should reset");

  const g = limiter.describeGuarantees();
  assert.equal(g.distributed, false, "it must not claim distributed enforcement");
  assert.match(g.caveat, /best-effort/i);
});

test("rate-limit buckets are pruned so memory cannot grow without bound", () => {
  let clock = 0;
  const limiter = createMemoryRateLimiter({ limit: 5, windowMs: 100, now: () => clock });
  for (let i = 0; i < 50; i++) limiter.check(`key-${i}`);
  assert.equal(limiter.size(), 50);
  clock = 1000;
  assert.equal(limiter.prune(), 0);
});

test("rate-limit keys do not contain a raw IP address", async () => {
  const { rateLimitKey } = await import("../lib/api/rate-limit.js");
  const key = await rateLimitKey({ headers: { "x-forwarded-for": "203.0.113.42" }, socket: {} });
  assert.ok(!key.includes("203.0.113.42"), "a raw IP is personal data and must be hashed");
  assert.match(key, /^ip:[a-f0-9]{16}$/);
});

// ── CORS ────────────────────────────────────────────────────────────────────

test("CORS allows our own origins and refuses everyone else", () => {
  const env = { ORBIT_ALLOWED_ORIGINS: "https://orbit.example" };
  for (const good of [
    "http://localhost:3001", "http://127.0.0.1:3031",
    "https://orbit-axis.vercel.app", "https://orbit-axis-abc123-team.vercel.app",
    "https://orbit.example",
  ]) assert.ok(isAllowedOrigin(good, env), `${good} should be allowed`);

  for (const bad of [
    "https://evil.example", "http://orbit-axis.vercel.app",
    "https://notorbit-axis.vercel.app", "https://orbit-axis.vercel.app.evil.com",
    "null", "", undefined,
  ]) assert.ok(!isAllowedOrigin(bad, env), `${bad} must be refused`);
});

test("a disallowed origin gets no Access-Control-Allow-Origin header", async () => {
  const r = await call({ url: "/api/v1/health", headers: { origin: "https://evil.example" } });
  assert.equal(r.headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(r.headers.Vary, "Origin");
});

test("preflight is answered for an allowed origin", async () => {
  const r = await call({ method: "OPTIONS", url: NATAL, headers: { origin: "http://localhost:3001" } });
  assert.equal(r.status, 204);
  assert.equal(r.headers["Access-Control-Allow-Origin"], "http://localhost:3001");
});

// ── route table and codes ───────────────────────────────────────────────────

test("the documented route table matches what is served", async () => {
  assert.equal(ROUTE_TABLE.length, 10);
  for (const r of ROUTE_TABLE) {
    assert.match(r.path, /^\/api\/v1\//);
  }

  // The interesting property is not the count but which routes are public.
  // Every calculation route must stay reachable without an account; every
  // account route must not be reachable without one.
  const accountRoutes = ROUTE_TABLE.filter((r) => r.path.startsWith("/api/v1/account"));
  assert.deepEqual(
    accountRoutes.map((r) => `${r.method} ${r.path}`).sort(),
    ["DELETE /api/v1/account", "GET /api/v1/account/export"],
    "the account surface is deletion and export, and nothing else",
  );
  for (const r of accountRoutes) {
    assert.equal(r.access, "authenticated",
      `${r.path} touches one person's own data and must require a verified session`);
  }

  // Stated the other way round as well, so a future route added under
  // /api/v1/account without an `authenticated: true` flag fails here rather
  // than shipping open.
  for (const r of ROUTE_TABLE.filter((r) => r.access === "public")) {
    assert.ok(!r.path.startsWith("/api/v1/account"),
      "no account route may be public");
  }
});

test("the router declines non-v1 paths instead of claiming them", async () => {
  assert.equal(await handleApiV1(mockReq({ url: "/api/health" }), "/api/health"), null);
  assert.equal(await handleApiV1(mockReq({ url: "/" }), "/"), null);
});

test("every error code maps to a sensible HTTP status", () => {
  for (const [code, def] of Object.entries(ERROR_CODES)) {
    assert.ok(def.status >= 400 && def.status < 600, `${code} has status ${def.status}`);
    assert.ok(def.message.length > 0);
    assert.doesNotMatch(def.message, /\/Users\/|undefined|null/, `${code} message looks unfinished`);
  }
});

test("an unknown error code degrades to INTERNAL_ERROR rather than leaking", () => {
  const e = new ApiError("NOT_A_REAL_CODE");
  assert.equal(e.code, "INTERNAL_ERROR");
  assert.equal(e.status, 500);
});

// ── Backward compatibility ──────────────────────────────────────────────────
// v1 is ADDITIVE. Nothing was renamed, moved, or removed to make room for it,
// because the web app is a live client of the existing routes and a versioned
// API is worth nothing if shipping it breaks the app it was extracted from.
//
// The two layers answer different questions. Legacy routes are authenticated
// and stateful — they read saved charts, sessions, and settings. v1 routes are
// public and stateless. Neither is a rename of the other, so a redirect would
// be wrong, and both are kept.

test("v1 does not shadow any existing application route", async () => {
  // Every path the browser actually calls must still reach legacy routing.
  const inUse = [
    "/api/health", "/api/charts", "/api/chart/now", "/api/sky/current",
    "/api/moon/current", "/api/fortune/today", "/api/ask", "/api/symbols",
    "/api/auth/session", "/api/settings/detail", "/api/local-llm/status",
  ];
  for (const route of inUse) {
    assert.equal(
      await handleApiV1(mockReq({ url: route }), route), null,
      `${route} must fall through to the existing handler, not be claimed by v1`,
    );
  }
});

test("legacy and v1 calculations come from one engine, not two implementations", async () => {
  // The legacy path imports the engine through lib/astro/natal.js, a re-export
  // shim. If that ever became a real second implementation the two layers could
  // return different charts for the same birth data — the exact class of bug
  // that made extracting the engine worthwhile.
  const legacy = await import("../lib/astro/natal.js");
  const engine = await import("@ezmannbuilds/orbit-axis-engine");
  assert.equal(legacy.computeNatalChart, engine.computeNatalChart,
    "lib/astro/natal.js must re-export the engine function, not redefine it");
});

test("v1 owns only the /api/v1 namespace", () => {
  for (const route of ROUTE_TABLE) {
    assert.ok(route.path.startsWith("/api/v1/"), `${route.path} escapes the v1 namespace`);
  }
});
