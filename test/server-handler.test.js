// Orbit Axis :: request-handler contract tests (Update 4.0.3).
//
// Two things are proved here.
//
// 1. IMPORT SAFETY. Importing the handler (or the Vercel entry point) must not
//    bind a port, contact Supabase or Ollama, run a migration, create a user,
//    seed data, or start a timer. This is checked in a child process with
//    listen() and fetch() replaced by traps, because an in-process check would
//    be defeated by module caching from other tests in the same file.
//
// 2. ROUTING AND STATIC DELIVERY. The root document, stylesheets, and modules
//    are served; a missing asset is a real 404, not a 200 page; an unknown API
//    path is a controlled JSON 404. Requests are driven through the handler
//    with mock req/res objects, so no port is bound by these tests either.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createOrbitApp } from "../lib/server/create-app.js";
import { resolveEnvironment } from "../lib/env/environment.js";
import { EnvironmentSafetyError } from "../lib/env/guard.js";
import { REPO_ROOT } from "../lib/local-llm/config.js";
import { sessionCookie, clearSessionCookie, isSecureRequest } from "../lib/auth/supabase-auth.js";
import { RATE_LIMITS } from "../lib/api/rate-limit.js";
import { PRODUCTION_PROJECT_REF } from "../lib/env/known-targets.js";

const LOCAL_URL = "http://127.0.0.1:55321";
const PROD_URL = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
const PREVIEW_REF = "previewprojectref0123";
const PREVIEW_URL = `https://${PREVIEW_REF}.supabase.co`;
const ANON = "anon-key-placeholder";

const info = (over = {}) => resolveEnvironment({ env: { ...over }, loadEnvFiles: false });
const localEnv = () => info({ ORBIT_ENVIRONMENT: "local", SUPABASE_URL: LOCAL_URL, SUPABASE_ANON_KEY: ANON });

test("both public preview routes enforce the calculation budget before reading a body", async () => {
  const handler = createOrbitApp({ env: localEnv() });
  for (const [index, url] of ["/api/chart/preview", "/api/fortune/preview"].entries()) {
    const peer = `192.0.2.${index + 40}`;
    // Empty GETs avoid real ephemeris work but pass through the same route
    // budget; the next POST must be refused before it waits for any body.
    for (let i = 0; i < RATE_LIMITS.calculation.limit; i += 1) {
      const res = await request(handler, { url, remoteAddress: peer });
      assert.notEqual(res.statusCode, 429);
    }
    const refused = await request(handler, { method: "POST", url, remoteAddress: peer });
    assert.equal(refused.statusCode, 429);
    assert.ok(Number(refused.headers["Retry-After"]) > 0);
  }
});

// ── mock request / response ──────────────────────────────────────────────────
// Enough of Node's http objects for the handler: it reads method, url, headers,
// and socket, writes a head, and ends. Bodies are only read for POST/PATCH.

function mockReq({ method = "GET", url = "/", headers = {}, remoteAddress = "127.0.0.1" } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.socket = { remoteAddress };
  return req;
}

function mockRes() {
  const res = {
    statusCode: null,
    headers: {},
    chunks: [],
    headersSent: false,
    writeHead(status, headers = {}) {
      res.statusCode = status;
      res.headers = { ...res.headers, ...headers };
      res.headersSent = true;
      return res;
    },
    write(chunk) { res.chunks.push(String(chunk)); return true; },
    end(chunk) { if (chunk) res.chunks.push(String(chunk)); res.finished = true; res.done?.(); return res; },
  };
  res.body = () => res.chunks.join("");
  res.settled = new Promise((resolve) => { res.done = resolve; });
  return res;
}

async function request(handler, options) {
  const req = mockReq(options);
  const res = mockRes();
  const call = handler(req, res);
  // GET requests never wait on a body; POSTs need the stream to end.
  if (options?.body !== undefined) {
    req.emit("data", JSON.stringify(options.body));
    req.emit("end");
  }
  await Promise.race([call, res.settled]);
  await res.settled;
  return res;
}

// ── 1. Import safety ─────────────────────────────────────────────────────────

// Runs `source` in a fresh Node process with listen() and fetch() trapped, and
// child_process.spawn/execFile trapped too, so any side effect during import
// fails loudly instead of silently succeeding.
function importInTrappedChild(specifier) {
  const script = `
    import http from "node:http";
    import https from "node:https";
    import net from "node:net";
    import cp from "node:child_process";

    const violations = [];
    const trap = (name) => (...args) => { violations.push(name); throw new Error("blocked: " + name); };

    http.Server.prototype.listen = trap("http.listen");
    https.Server.prototype.listen = trap("https.listen");
    net.Server.prototype.listen = trap("net.listen");
    globalThis.fetch = trap("fetch");
    cp.spawn = trap("spawn");
    cp.spawnSync = trap("spawnSync");
    cp.execFile = trap("execFile");
    cp.execFileSync = trap("execFileSync");

    const timers = [];
    const realSetInterval = globalThis.setInterval;
    globalThis.setInterval = (...a) => { violations.push("setInterval"); return realSetInterval(...a); };

    await import(${JSON.stringify(specifier)});

    if (violations.length) {
      console.error("VIOLATIONS:" + violations.join(","));
      process.exit(2);
    }
    console.log("CLEAN");
    process.exit(0);
  `;
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, ORBIT_ENVIRONMENT: "test", SUPABASE_URL: LOCAL_URL, SUPABASE_ANON_KEY: ANON },
  });
}

test("importing the request handler has no side effects", () => {
  const r = importInTrappedChild(join(REPO_ROOT, "lib/server/create-app.js"));
  assert.equal(r.status, 0, `import was not side-effect free: ${r.stderr || r.stdout}`);
  assert.match(r.stdout, /CLEAN/);
});

test("importing the Vercel function entry point has no side effects", () => {
  const r = importInTrappedChild(join(REPO_ROOT, "api/index.js"));
  assert.equal(r.status, 0, `import was not side-effect free: ${r.stderr || r.stdout}`);
  assert.match(r.stdout, /CLEAN/);
});

test("the Vercel entry point exports a function without creating the app at import", async () => {
  const mod = await import("../api/index.js");
  assert.equal(typeof mod.default, "function");
});

// ── 2. The environment guard runs before any side effect ─────────────────────

// assert.throws() does not hand back the error, and the guard's `code` is the
// part worth asserting on — the message is prose that may be reworded.
function caught(fn) {
  try { fn(); } catch (error) { return error; }
  return null;
}

test("createOrbitApp refuses an unsafe configuration before returning a handler", () => {
  // Local development aimed at hosted production: the Update 4.0.2 case.
  const unsafe = info({ ORBIT_ENVIRONMENT: "local", SUPABASE_URL: PROD_URL, SUPABASE_ANON_KEY: ANON });
  const err = caught(() => createOrbitApp({ env: unsafe }));
  assert.ok(err instanceof EnvironmentSafetyError, `expected an EnvironmentSafetyError, got ${err}`);
  assert.equal(err.code, "local_points_at_production");
});

test("createOrbitApp refuses a Vercel deployment aimed at localhost", () => {
  const unsafe = info({ VERCEL: "1", VERCEL_ENV: "preview", SUPABASE_URL: LOCAL_URL, SUPABASE_ANON_KEY: ANON });
  const err = caught(() => createOrbitApp({ env: unsafe }));
  assert.ok(err instanceof EnvironmentSafetyError, `expected an EnvironmentSafetyError, got ${err}`);
  assert.equal(err.code, "vercel_points_at_localhost");
});

test("a safe configuration produces a handler carrying its resolved environment", () => {
  const handler = createOrbitApp({ env: localEnv() });
  assert.equal(typeof handler, "function");
  assert.equal(handler.orbitEnvironment.environment, "local");
  assert.equal(handler.orbitEnvironment.databaseTarget, "local");
});

// ── 3. Static delivery ───────────────────────────────────────────────────────

test("the root path serves the frontend document", async () => {
  const res = await request(createOrbitApp({ env: localEnv() }), { url: "/" });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["Content-Type"], /text\/html/);
  assert.match(res.body(), /<html|<!doctype/i);
});

test("stylesheets and modules are served with correct content types", async () => {
  const handler = createOrbitApp({ env: localEnv() });
  const css = await request(handler, { url: "/styles/base.css" });
  assert.equal(css.statusCode, 200);
  assert.match(css.headers["Content-Type"], /text\/css/);

  const js = await request(handler, { url: "/app.js" });
  assert.equal(js.statusCode, 200);
  assert.match(js.headers["Content-Type"], /javascript/);
});

test("a missing static asset is a real 404, not the index page", async () => {
  const res = await request(createOrbitApp({ env: localEnv() }), { url: "/styles/does-not-exist.css" });
  assert.equal(res.statusCode, 404);
  assert.doesNotMatch(res.body(), /<html/i, "a missing asset must not be answered with the app shell");
});

test("static paths cannot escape the public directory", async () => {
  const handler = createOrbitApp({ env: localEnv() });
  for (const attempt of ["/../package.json", "/../../etc/passwd", "/%2e%2e/package.json"]) {
    const res = await request(handler, { url: attempt });
    assert.equal(res.statusCode, 404, `${attempt} must not resolve`);
    assert.doesNotMatch(res.body(), /"name":\s*"orbit"/, `${attempt} must not leak package.json`);
  }
});

test("every stylesheet and module referenced by the document is actually served", async () => {
  const handler = createOrbitApp({ env: localEnv() });
  const html = readFileSync(join(REPO_ROOT, "public", "index.html"), "utf8");
  const refs = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 0, "the document should reference at least one asset");
  for (const ref of new Set(refs)) {
    const res = await request(handler, { url: ref });
    assert.equal(res.statusCode, 200, `${ref} should be served`);
  }
});

// ── 4. API routing ───────────────────────────────────────────────────────────

test("a known API route reaches the handler", async () => {
  const res = await request(createOrbitApp({ env: localEnv() }), { url: "/api/health" });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body());
  assert.equal(body.ok, true);
  assert.equal(body.service, "orbit");
});

test("the health endpoint does not describe the environment or database", async () => {
  const res = await request(createOrbitApp({ env: localEnv() }), { url: "/api/health" });
  const body = JSON.parse(res.body());
  assert.deepEqual(Object.keys(body).sort(), ["ok", "service"]);
});

test("an unknown API path returns a controlled JSON 404", async () => {
  const res = await request(createOrbitApp({ env: localEnv() }), { url: "/api/definitely-not-a-route" });
  assert.equal(res.statusCode, 404);
  assert.match(res.headers["Content-Type"], /application\/json/);
  const body = JSON.parse(res.body());
  assert.equal(body.ok, false);
  assert.equal(body.error, "Unknown Orbit endpoint");
});

test("a deterministic astrology route still answers", async () => {
  const res = await request(createOrbitApp({ env: localEnv() }), { url: "/api/symbols?kind=zodiac_sign" });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body());
  assert.equal(body.ok, true);
  assert.equal(body.count, 12, "the twelve zodiac signs");
});

test("legacy sky routes preserve date fields and expose canonical lunar instants", async () => {
  const handler = createOrbitApp({ env: localEnv() });
  const chartRes = await request(handler, {
    url: "/api/chart/now?tz=America%2FChicago",
  });
  const eventsRes = await request(handler, {
    url: "/api/events?tz=America%2FChicago",
  });
  assert.equal(chartRes.statusCode, 200);
  assert.equal(eventsRes.statusCode, 200);

  const chart = JSON.parse(chartRes.body());
  const events = JSON.parse(eventsRes.body());
  const full = events.events.find((event) => event.kind === "full_moon");
  const nextNew = events.events.find((event) => event.kind === "new_moon");

  assert.equal(chart.moon.next_full_moon_utc, full.instant_utc);
  assert.equal(chart.moon.next_new_moon_utc, nextNew.instant_utc);
  assert.equal(chart.moon.next_full_moon, full.date);
  assert.equal(chart.moon.next_new_moon, nextNew.date);
  assert.equal(chart.local_date, events.local_date);
  assert.equal(chart.source.calculation, "orbit-axis-engine");
  assert.equal(events.source.calculation, "orbit-axis-engine");
});

test("OPTIONS preflight is answered without reaching a route", async () => {
  const res = await request(createOrbitApp({ env: localEnv() }), { method: "OPTIONS", url: "/api/ask" });
  assert.equal(res.statusCode, 204);
});

// ── 5. Development routes are off on a deployment ────────────────────────────

test("development routes are unavailable on a Vercel deployment", async () => {
  const deployed = info({
    VERCEL: "1", VERCEL_ENV: "preview", SUPABASE_URL: PREVIEW_URL,
    SUPABASE_ANON_KEY: ANON, ORBIT_PREVIEW_PROJECT_REFS: PREVIEW_REF,
  });
  const handler = createOrbitApp({ env: deployed });
  for (const route of ["/api/local-llm/status", "/api/local-llm/models", "/api/vault/project-notes", "/api/vault/edit-proposals"]) {
    const res = await request(handler, { url: route, remoteAddress: "10.0.0.5" });
    assert.equal(res.statusCode, 404, `${route} must not exist on a deployment`);
    const body = JSON.parse(res.body());
    assert.equal(body.error, "Unknown Orbit endpoint", `${route} must not hint that it exists`);
  }
});

test("development routes remain available locally", async () => {
  const handler = createOrbitApp({ env: localEnv() });
  const res = await request(handler, { url: "/api/vault/edit-proposals" });
  assert.notEqual(res.statusCode, 404, "the vault route should exist in local development");
});

// ── 6. Cookie security ───────────────────────────────────────────────────────

const session = { access_token: "a", refresh_token: "r", expires_in: 3600, user: { id: "u", email: "e@example.com" } };

test("a local HTTP session cookie is HttpOnly and SameSite but not Secure", () => {
  const cookie = sessionCookie(session, { req: mockReq(), env: localEnv() });
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.doesNotMatch(cookie, /Secure/, "a Secure cookie over http://localhost breaks local sign-in");
});

test("a deployed session cookie is always Secure", () => {
  const deployed = info({ VERCEL: "1", VERCEL_ENV: "production", SUPABASE_URL: PROD_URL, SUPABASE_ANON_KEY: ANON });
  const cookie = sessionCookie(session, { req: mockReq({ headers: { "x-forwarded-proto": "https" } }), env: deployed });
  assert.match(cookie, /Secure/);
  assert.match(cookie, /HttpOnly/);
});

test("a deployed cookie stays Secure even when the forwarded header is absent", () => {
  const deployed = info({ VERCEL: "1", VERCEL_ENV: "preview", SUPABASE_URL: PREVIEW_URL, SUPABASE_ANON_KEY: ANON, ORBIT_PREVIEW_PROJECT_REFS: PREVIEW_REF });
  const cookie = sessionCookie(session, { req: mockReq(), env: deployed });
  assert.match(cookie, /Secure/, "a stripped header must not be able to downgrade the cookie");
});

test("the sign-out cookie carries the same attributes as the session cookie", () => {
  const deployed = info({ VERCEL: "1", VERCEL_ENV: "production", SUPABASE_URL: PROD_URL, SUPABASE_ANON_KEY: ANON });
  const cleared = clearSessionCookie({ req: mockReq(), env: deployed });
  assert.match(cleared, /Secure/);
  assert.match(cleared, /HttpOnly/);
  assert.match(cleared, /Max-Age=0/);
});

test("a forged x-forwarded-proto is ignored off Vercel", () => {
  const forged = mockReq({ headers: { "x-forwarded-proto": "https" } });
  assert.equal(isSecureRequest(forged, localEnv()), false,
    "anyone can send this header to a local server; only a Vercel context may speak for the scheme");
});

test("a plain local request is not treated as secure", () => {
  assert.equal(isSecureRequest(mockReq(), localEnv()), false);
});
