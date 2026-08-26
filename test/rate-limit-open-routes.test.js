// Orbit Axis :: rate limiting on the open calculation routes (Dev Update 6.0).
//
// /api/chart and /api/chart/now spawn the Swiss Ephemeris subprocess, and every
// /api/tarot/* path answers without an account. Until this update they had no
// limiter at all, which made them a free compute endpoint with Orbit paying for
// it — the one thing a public beta must not ship.
//
// These tests RUN the limiter rather than reading the source. The two failures
// that matter are opposite and equally bad: a limiter that never refuses, and a
// limiter that refuses an ordinary person loading the page.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../lib/local-llm/config.js";
import { createMemoryRateLimiter, RATE_LIMITS, rateLimitKey } from "../lib/api/rate-limit.js";

const SERVER = readFileSync(join(REPO_ROOT, "lib", "server", "create-app.js"), "utf8");

/* ── The routes are actually covered ──────────────────────────────────────── */

test("the expensive open routes are inside the limiter's route set", () => {
  const fn = SERVER.slice(SERVER.indexOf("function isRateLimitedComputeRoute"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  for (const route of ["/api/chart", "/api/chart/now", "/api/events", "/api/tarot/", "/api/analytics/event"]) {
    assert.ok(body.includes(`"${route}"`), `${route} must be rate limited`);
  }
});

test("the limiter runs before routing, not inside one handler", () => {
  // Placed once in the pipeline so a new sibling route cannot be added without
  // it. If this moves into an individual handler, the next route added is
  // unprotected and nobody notices.
  const guard = SERVER.indexOf("if (await refuseIfRateLimited(req, res, route)) return;");
  assert.ok(guard > 0, "the guard must exist in the request pipeline");
  assert.ok(guard < SERVER.indexOf('if (route === "/api/chart"'),
    "it must run before the routes it protects");
});

test("the refusal is a 429 with a Retry-After header and a consistent body", () => {
  const fn = SERVER.slice(SERVER.indexOf("async function refuseIfRateLimited"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /json\(res, 429/);
  assert.match(body, /"Retry-After"/);
  assert.match(body, /code: "rate_limited"/);
  assert.match(body, /retry_after_seconds/);
});

/* ── It genuinely refuses ─────────────────────────────────────────────────── */

test("a caller past the budget is refused, with a usable retry hint", () => {
  let clock = 1_000_000;
  const limiter = createMemoryRateLimiter({ limit: 30, windowMs: 60_000, now: () => clock });

  for (let i = 0; i < 30; i += 1) {
    assert.equal(limiter.check("ip:abc").allowed, true, `request ${i + 1} should be allowed`);
  }
  const refused = limiter.check("ip:abc");
  assert.equal(refused.allowed, false, "the 31st request in the window must be refused");
  assert.ok(refused.retryAfterSeconds >= 1 && refused.retryAfterSeconds <= 60,
    "a refusal must say when to come back, in seconds a client can act on");

  // And the window really does reopen, rather than locking someone out.
  clock += 60_001;
  assert.equal(limiter.check("ip:abc").allowed, true);
});

test("one noisy caller cannot exhaust another caller's budget", () => {
  const limiter = createMemoryRateLimiter({ limit: 5, windowMs: 60_000 });
  for (let i = 0; i < 6; i += 1) limiter.check("ip:noisy");
  assert.equal(limiter.check("ip:noisy").allowed, false);
  assert.equal(limiter.check("ip:someone-else").allowed, true,
    "buckets are per caller; a shared bucket would let one client deny the app to everyone");
});

test("ordinary page loads are nowhere near the ceiling", () => {
  // The realistic worst case for one person: the app boots and asks for the
  // sky, the events, and the daily card, and they reload a few times. If a
  // handful of reloads could trip this, the limiter would be a bug.
  const limiter = createMemoryRateLimiter(RATE_LIMITS.calculation);
  const perLoad = ["/api/chart/now", "/api/events", "/api/tarot/daily"];
  for (let load = 0; load < 8; load += 1) {
    for (const _route of perLoad) {
      assert.equal(limiter.check("ip:ordinary").allowed, true,
        "eight page loads in a minute is a person, not an attack");
    }
  }
});

test("the key is a hashed peer address, never a raw one", async () => {
  // The bucket key lives in memory and can reach diagnostics. A raw IP there is
  // personal data, and the privacy page promises none is stored.
  const key = await rateLimitKey({ headers: { "x-forwarded-for": "203.0.113.9, 70.41.3.18" }, socket: {} });
  assert.match(key, /^ip:[0-9a-f]{16}$/);
  assert.ok(!key.includes("203.0.113.9"));

  // An authenticated caller is limited as an account instead, so people sharing
  // an address are not limited as one caller.
  assert.equal(await rateLimitKey({ headers: {} }, { userId: "abc" }), "user:abc");
});

test("memory cannot grow without bound", () => {
  let clock = 0;
  const limiter = createMemoryRateLimiter({ limit: 5, windowMs: 1000, now: () => clock });
  for (let i = 0; i < 500; i += 1) limiter.check(`ip:${i}`);
  assert.equal(limiter.size(), 500);
  clock += 2000;
  limiter.prune();
  assert.equal(limiter.size(), 0, "expired buckets must be reclaimed");
});

/* ── The honesty requirement ──────────────────────────────────────────────── */

test("the limiter describes its own ceiling rather than implying strength", () => {
  // This is per-instance in-memory on a serverless platform. Describing it as
  // real enforcement would be the actual danger: someone would stop worrying.
  const guarantees = createMemoryRateLimiter(RATE_LIMITS.calculation).describeGuarantees();
  assert.equal(guarantees.distributed, false);
  assert.equal(guarantees.scope, "per function instance");
  assert.match(guarantees.caveat, /best-effort/i);
  assert.match(guarantees.caveat, /instance count/i);
});

test("the code says out loud that this is not distributed enforcement", () => {
  const fn = SERVER.slice(SERVER.indexOf("// ── Rate limiting for the open calculation routes"));
  const preamble = fn.slice(0, fn.indexOf("const legacyComputeLimiter"));
  assert.match(preamble, /PER-INSTANCE/);
  // Comment markers and line wrapping are stripped before matching, so an
  // assertion about what the code SAYS cannot fail on how it is formatted.
  const prose = preamble.replace(/^\s*\/\/ ?/gm, " ").replace(/\s+/g, " ");
  assert.match(prose, /NOT protection against a determined distributed attacker/i);
});
